import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { test } from 'node:test';

const databaseUrl = process.env.ACCOUNT_DELETION_JOURNAL_TEST_DATABASE_URL;
const integrationSkipReason = databaseUrl
  ? false
  : 'set ACCOUNT_DELETION_JOURNAL_TEST_DATABASE_URL to a dedicated migrated journal test database';

async function withJournalTestTransaction<T>(pool: Pick<Pool, 'connect'>, run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await run(client);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

test('journal_retention_test_transaction_pins_one_client', async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) { calls.push(sql); return { rows: [], rowCount: 0 }; },
    release() { calls.push('RELEASE'); }
  };
  const fakePool = { async connect() { calls.push('CONNECT'); return client; } };
  await withJournalTestTransaction(fakePool as never, async (connection) => {
    await connection.query('INSERT FIXTURE');
  });
  assert.deepEqual(calls, ['CONNECT', 'BEGIN', 'INSERT FIXTURE', 'ROLLBACK', 'RELEASE']);
});

test('runtime_role_cannot_update_or_delete_journal', { skip: integrationSkipReason }, async () => {
  const url = new URL(databaseUrl!);
  assert.match(url.pathname, /test/i, 'integration tests require a dedicated journal test database');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<{
      can_update: boolean;
      can_delete: boolean;
      can_retention_delete: boolean;
      runtime_can_prune: boolean;
      retention_can_prune: boolean;
    }>(`SELECT
        has_table_privilege('account_deletion_journal_runtime', 'public.account_deletion_journal_entries', 'UPDATE') AS can_update,
        has_table_privilege('account_deletion_journal_runtime', 'public.account_deletion_journal_entries', 'DELETE') AS can_delete,
        has_table_privilege('account_deletion_journal_retention', 'public.account_deletion_journal_entries', 'DELETE') AS can_retention_delete,
        has_function_privilege('account_deletion_journal_runtime', 'public.prune_completed_account_deletion_journal(text[])', 'EXECUTE') AS runtime_can_prune,
        has_function_privilege('account_deletion_journal_retention', 'public.prune_completed_account_deletion_journal(text[])', 'EXECUTE') AS retention_can_prune`);

    assert.deepEqual(result.rows[0], {
      can_update: false,
      can_delete: false,
      can_retention_delete: false,
      runtime_can_prune: false,
      retention_can_prune: true
    });
  } finally {
    await pool.end();
  }
});

test('journal_retention_expires_entries_at_day_35_and_keeps_younger_entries', { skip: integrationSkipReason }, async () => {
  const url = new URL(databaseUrl!);
  assert.match(url.pathname, /test/i, 'integration tests require a dedicated journal test database');
  const pool = new Pool({ connectionString: databaseUrl });
  const expiredOperationId = randomUUID();
  const youngerOperationId = randomUUID();
  const preparedOnlyOperationId = randomUUID();
  try {
    await withJournalTestTransaction(pool, async (client) => {
      for (const [operationId, expired] of [[expiredOperationId, true], [youngerOperationId, false]] as const) {
        const acceptedAtSql = expired ? "now() - interval '35 days'" : "now() - interval '34 days 23 hours'";
        const intentId = randomUUID();
        for (const state of ['prepared', 'accepted']) {
          await client.query(`INSERT INTO public.account_deletion_journal_entries
              (operation_id, intent_id, user_id, state, accepted_at, deadline_at, payload, hmac)
            VALUES ($1, $2, $3, $4, ${acceptedAtSql}, now(), '{}'::jsonb, 'test-signature')`,
          [operationId, intentId, randomUUID(), state]);
        }
      }
      await client.query(`INSERT INTO public.account_deletion_journal_entries
        (operation_id, intent_id, user_id, state, accepted_at, deadline_at, payload, hmac)
      VALUES ($1, $2, $3, 'prepared', now() - interval '35 days', now(), '{}'::jsonb, 'test-signature')`,
      [preparedOnlyOperationId, randomUUID(), randomUUID()]);

      const pruned = await client.query<{ deleted: string }>(
        'SELECT public.prune_completed_account_deletion_journal($1::text[]) AS deleted',
        [[expiredOperationId, youngerOperationId, preparedOnlyOperationId]]
      );
      assert.equal(Number(pruned.rows[0]?.deleted), 2);
      const remaining = await client.query<{ operation_id: string; state: string }>(
        `SELECT operation_id, state FROM public.account_deletion_journal_entries
         WHERE operation_id = ANY($1::text[]) ORDER BY operation_id, state`,
        [[expiredOperationId, youngerOperationId, preparedOnlyOperationId]]
      );
      assert.deepEqual(new Set(remaining.rows.map((row) => `${row.operation_id}:${row.state}`)), new Set([
        `${youngerOperationId}:accepted`,
        `${youngerOperationId}:prepared`,
        `${preparedOnlyOperationId}:prepared`
      ]));
    });
  } finally {
    await pool.end();
  }
});
