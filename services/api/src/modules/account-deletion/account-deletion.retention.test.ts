import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAccountDeletionRetentionRepository, createAccountDeletionRetentionService } from './account-deletion.retention.js';
import type { Database } from '../../config/database.js';

function fixture(
  operations = [
    { id: 'exactly-day-35', status: 'completed', accepted_at: new Date('2026-09-08T00:00:00.000Z') },
    { id: 'younger-than-day-35', status: 'completed', accepted_at: new Date('2026-09-08T00:00:00.001Z') },
    { id: 'unfinished', status: 'processing', accepted_at: new Date('2026-09-01T00:00:00.000Z') }
  ],
  onExternal = async (_now: Date, _ids: string[]) => undefined
) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const order: string[] = [];
  const fakeDatabase = {
    async connect() {
      return {
        async query(sql: string, values: unknown[] = []) {
          queries.push({ sql, values });
          order.push(sql);
          if (sql.includes('SELECT id FROM account_deletion_operations')) {
            const cutoff = new Date(new Date(String(values[0])).getTime() - 35 * 24 * 60 * 60 * 1000);
            const rows = operations.filter((operation) => operation.status === 'completed' && operation.accepted_at <= cutoff);
            return { rows, rowCount: rows.length };
          }
          return { rows: [], rowCount: sql.trimStart().startsWith('DELETE') ? 1 : 0 };
        },
        release() {}
      };
    }
  } as unknown as Database;
  const repository = createAccountDeletionRetentionRepository(fakeDatabase);
  const service = createAccountDeletionRetentionService(repository, async (now, ids) => {
    order.push('external_journal_cleanup');
    return onExternal(now, ids);
  });
  return { service, queries, order };
}

test('unfinished_task_never_expires', async () => {
  const { service, queries } = fixture();
  const now = new Date('2026-10-13T12:00:00.000Z');
  assert.deepEqual(await service.cleanupDeletionRetention(now), { deleted: 4 });
  const prepared = queries.find((query) => query.sql.includes('DELETE FROM account_deletion_operations operation'));
  assert.ok(prepared);
  assert.match(prepared.sql, /operation\.status = 'not_started'/);
  assert.match(prepared.sql, /NOT EXISTS[\s\S]*permission\.expires_at > \$1/);
  assert.doesNotMatch(prepared.sql, /processing|retrying|accepted_at/);
  assert.ok(queries.filter((query) => query.sql.startsWith('DELETE')).every((query) => query.values[0] === now));
});

test('completed_entry_expires_at_day_35', async () => {
  const retainedOperationIds: string[][] = [];
  const { service, queries } = fixture(undefined, async (_now, ids) => { retainedOperationIds.push(ids); });
  const now = new Date('2026-10-13T00:00:00.000Z');
  await service.cleanupDeletionRetention(now);
  const journal = queries.find((query) => query.sql.includes("WHERE status = 'completed'"));
  const candidates = queries.find((query) => query.sql.includes('SELECT id FROM account_deletion_operations'));
  assert.ok(candidates);
  assert.match(candidates.sql, /status = 'completed'/);
  assert.match(candidates.sql, /accepted_at <= \$1::timestamptz - interval '35 days'/);
  assert.deepEqual(retainedOperationIds, [['exactly-day-35']]);
  assert.ok(journal);
  assert.match(journal.sql, /accepted_at <= \$1::timestamptz - interval '35 days'/);
  assert.deepEqual(journal.values, [now]);
});

test('completed_entry_younger_than_35_days_is_retained', async () => {
  const candidates: string[][] = [];
  const now = new Date('2026-10-13T00:00:00.000Z');
  const cutoff = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
  const { service } = fixture([
    { id: 'young', status: 'completed', accepted_at: new Date(cutoff.getTime() + 1) }
  ], async (_now, ids) => { candidates.push(ids); });
  await service.cleanupDeletionRetention(now);
  assert.deepEqual(candidates, [[]]);
});

test('unfinished_entry_never_expires', async () => {
  const candidates: string[][] = [];
  const service = fixture([
    { id: 'unfinished', status: 'processing', accepted_at: new Date('2026-09-01T00:00:00.000Z') }
  ], async (_now, ids) => { candidates.push(ids); }).service;
  await service.cleanupDeletionRetention(new Date('2026-10-13T00:00:00.000Z'));
  assert.deepEqual(candidates, [[]]);
});

test('external_journal_is_pruned_before_database_receipt_retention', async () => {
  const { service, order } = fixture();
  await service.cleanupDeletionRetention(new Date('2026-10-13T00:00:00.000Z'));
  const externalIndex = order.indexOf('external_journal_cleanup');
  const preparedDeleteIndex = order.findIndex((sql) => sql.includes('DELETE FROM account_deletion_operations operation'));
  const completedDeleteIndex = order.findIndex((sql) => sql.trimStart().startsWith('DELETE') && sql.includes("WHERE status = 'completed'"));
  assert.ok(externalIndex >= 0);
  assert.ok(externalIndex < preparedDeleteIndex);
  assert.ok(externalIndex < completedDeleteIndex);
});

test('moderation_identifiers_expire_day30', async () => {
  const { service, queries } = fixture();
  await service.cleanupDeletionRetention(new Date('2026-10-13T00:00:00.000Z'));
  const moderation = queries.find((query) => query.sql.includes('account_deletion_moderation_identifiers'));
  assert.ok(moderation);
  assert.match(moderation.sql, /expires_at <= \$1/);
});

test('permission_hashes_expire_at_their_scope_expiry', async () => {
  const { service, queries } = fixture();
  await service.cleanupDeletionRetention(new Date('2026-10-13T00:00:00.000Z'));
  const permissions = queries.find((query) => query.sql.includes('DELETE FROM account_deletion_permissions'));
  assert.ok(permissions);
  assert.match(permissions.sql, /expires_at <= \$1/);
});
