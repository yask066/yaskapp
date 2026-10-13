import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/yaskapp_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';
const { reapplyAcceptedDeletions } = await import('./account-deletion.restore.js');

test('restore replay closes accounts and resets cleanup for repeatable worker processing', async () => {
  const statements: string[] = [];
  const database = {
    async connect() {
      return {
        async query(sql: string) {
          statements.push(sql);
          if (sql.includes('SELECT user_id FROM account_deletion_operations')) return { rows: [] };
          return { rows: [] };
        },
        release() {}
      };
    }
  } as never;
  const entry = {
    version: 1 as const,
    operationId: 'e15d4d2b-5358-45a7-b036-f3648d34b361',
    userId: '3ce3e770-fd0e-4e98-8472-0541d3e27cf1',
    acceptedAt: '2026-10-12T12:00:00.000Z',
    deadlineAt: '2026-10-13T12:00:00.000Z',
    hmac: 'verified-by-journal-reader'
  };

  assert.deepEqual(await reapplyAcceptedDeletions([entry], database), { reapplied: 1 });
  assert.ok(statements.some((sql) => sql.includes("status = 'deleted'")));
  assert.ok(statements.some((sql) => sql.includes("WHEN status <> 'deleted' OR deleted_at IS NULL THEN 1 ELSE 0 END")));
  assert.ok(statements.some((sql) => sql.includes("status = 'pending'")));
  assert.ok(statements.some((sql) => sql.includes('UPDATE account_deletion_media_manifest')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO account_deletion_media_manifest')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO account_deletion_events')));
  assert.equal(statements.filter((sql) => sql === 'COMMIT').length, 1);
});
