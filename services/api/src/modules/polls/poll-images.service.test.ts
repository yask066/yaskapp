import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

const [{ db }, { enqueuePollImageForAccountDeletion }] = await Promise.all([
  import('../../config/database.js'),
  import('./poll-images.service.js')
]);

test('failed_upload_reopens_completed_deletion_and_requeues_cleanup', async (context) => {
  const statements: string[] = [];
  context.mock.method(db, 'connect', async () => ({
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('SELECT id, status FROM account_deletion_operations')) {
        return { rows: [{ id: 'operation-1', status: 'completed' }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  } as never));

  await enqueuePollImageForAccountDeletion('user-1', 'poll-images/user-1/image.webp');

  assert.ok(statements.some((sql) => sql.includes("SET status = 'pending', completed_at = NULL")));
  assert.ok(statements.some((sql) => sql.includes("step_key IN ('media', 'completion')")));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO account_deletion_media_manifest')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO account_deletion_events')));
  assert.equal(statements.at(-1), 'COMMIT');
});

test('late_upload_reopens_media_step_while_deletion_is_running', async (context) => {
  const statements: string[] = [];
  context.mock.method(db, 'connect', async () => ({
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('SELECT id, status FROM account_deletion_operations')) {
        return { rows: [{ id: 'operation-2', status: 'processing' }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {}
  } as never));

  await enqueuePollImageForAccountDeletion('user-2', 'poll-images/user-2/late.webp');

  assert.ok(statements.some((sql) => sql.includes("SET status = 'pending', completed_at = NULL")));
  assert.ok(statements.some((sql) => sql.includes("step_key IN ('media', 'completion')")));
  assert.ok(statements.some((sql) => sql.includes('lease_owner = NULL')));
});
