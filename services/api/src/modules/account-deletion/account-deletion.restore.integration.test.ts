import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { test } from 'node:test';

import { createJournalEntry } from './account-deletion.journal.js';
import { createAccountDeletionWorkerRepository, DELETION_STEP_ORDER, processDeletionBatch } from './account-deletion.worker.js';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/yaskapp_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';
const { reapplyAcceptedDeletions } = await import('./account-deletion.restore.js');

const testDatabaseUrl = process.env.ACCOUNT_DELETION_TEST_DATABASE_URL;
const signingKey = 'integration-test-signing-key-is-not-secret';
process.env.ACCOUNT_DELETION_JOURNAL_HMAC_KEY = signingKey;

test('restore_old_backup_does_not_resurrect_account', { skip: !testDatabaseUrl }, async () => {
  const databaseUrl = new URL(testDatabaseUrl!);
  assert.match(databaseUrl.pathname, /test/i, 'integration tests require a dedicated test database');
  const pool = new Pool({ connectionString: testDatabaseUrl });
  const userId = randomUUID();
  const operationId = randomUUID();
  const now = new Date();
  const entry = createJournalEntry({
    operationId,
    userId,
    acceptedAt: new Date(now.getTime() - 60_000),
    deadlineAt: new Date(now.getTime() + 23 * 60 * 60_000)
  }, signingKey);
  try {
    // Simulate a pre-deletion backup where the operation and user are active.
    await pool.query(
      'INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)',
      [userId, `${operationId}@restore.test`, `restore_${operationId.slice(0, 8)}`, 'test-hash']
    );
    await pool.query(
      `INSERT INTO account_deletion_operations (id, user_id, status)
       VALUES ($1, $2, 'not_started')`,
      [operationId, userId]
    );

    assert.deepEqual(await reapplyAcceptedDeletions([entry], pool), { reapplied: 1 });
    const workerHandlers = Object.fromEntries(DELETION_STEP_ORDER.map((stepKey) => [stepKey, async () => ({ done: true })]));
    workerHandlers.completion = async () => {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      return { done: true };
    };
    const batchResult = await processDeletionBatch({ limit: 1, now: new Date() }, {
      repository: createAccountDeletionWorkerRepository(pool as never),
      handlers: workerHandlers
    });
    const workerCompleted = await pool.query<{ status: string }>(
      'SELECT status FROM account_deletion_operations WHERE id = $1', [operationId]
    );
    assert.deepEqual(batchResult, { processed: 1, completed: 1, retrying: 0 },
      `worker status: ${workerCompleted.rows[0]?.status ?? 'missing'}`);
    assert.equal(workerCompleted.rows[0]?.status, 'completed');

    const beforeReplay = await pool.query<{ status: string; completed_at: Date | null }>(
      'SELECT status, completed_at FROM account_deletion_operations WHERE id = $1', [operationId]
    );
    const stepsBeforeReplay = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM account_deletion_steps
       WHERE operation_id = $1 AND status = 'completed'`, [operationId]
    );
    const eventsBeforeReplay = await pool.query(
      `SELECT event_key, attempts, delivered_at, last_error_code
       FROM account_deletion_events WHERE operation_id = $1 ORDER BY event_key`, [operationId]
    );
    assert.equal(beforeReplay.rows[0]?.status, 'completed');
    assert.ok(beforeReplay.rows[0]?.completed_at);
    assert.equal(stepsBeforeReplay.rows[0]?.count, 7);

    assert.deepEqual(await reapplyAcceptedDeletions([entry], pool), { reapplied: 1 });

    const user = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [userId]);
    const operation = await pool.query<{ status: string; completed_at: Date | null }>(
      'SELECT status, completed_at FROM account_deletion_operations WHERE id = $1', [operationId]
    );
    const steps = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM account_deletion_steps
       WHERE operation_id = $1 AND status = 'completed'`,
      [operationId]
    );
    const events = await pool.query(
      `SELECT event_key, attempts, delivered_at, last_error_code
       FROM account_deletion_events WHERE operation_id = $1 ORDER BY event_key`, [operationId]
    );
    assert.equal(user.rows.length, 0);
    assert.equal(operation.rows[0]?.status, 'completed');
    assert.equal(operation.rows[0]?.completed_at?.getTime(), beforeReplay.rows[0]?.completed_at?.getTime());
    assert.equal(steps.rows[0]?.count, 7);
    assert.deepEqual(events.rows, eventsBeforeReplay.rows);
  } finally {
    await pool.query('DELETE FROM account_deletion_operations WHERE id = $1', [operationId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.end();
  }
});
