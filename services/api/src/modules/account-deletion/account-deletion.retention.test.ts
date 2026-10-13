import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAccountDeletionRetentionRepository, createAccountDeletionRetentionService } from './account-deletion.retention.js';
import type { Database } from '../../config/database.js';

function fixture() {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const fakeDatabase = {
    async connect() {
      return {
        async query(sql: string, values: unknown[] = []) {
          queries.push({ sql, values });
          return { rows: [], rowCount: sql.trimStart().startsWith('DELETE') ? 1 : 0 };
        },
        release() {}
      };
    }
  } as unknown as Database;
  const repository = createAccountDeletionRetentionRepository(fakeDatabase);
  const service = createAccountDeletionRetentionService(repository);
  return { service, queries };
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

test('completed_journal_expires_day35', async () => {
  const { service, queries } = fixture();
  const now = new Date('2026-10-13T00:00:00.000Z');
  await service.cleanupDeletionRetention(now);
  const journal = queries.find((query) => query.sql.includes("WHERE status = 'completed'"));
  assert.ok(journal);
  assert.match(journal.sql, /accepted_at <= \$1::timestamptz - interval '35 days'/);
  assert.deepEqual(journal.values, [now]);
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
