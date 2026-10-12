import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

const [{ db }, { createAppeal }] = await Promise.all([
  import('../../config/database.js'),
  import('./appeals.repository.js')
]);

test('closed_account_cannot_create_an_appeal', async (context) => {
  const statements: string[] = [];
  context.mock.method(db, 'connect', async () => ({
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('SELECT status, deleted_at FROM users')) {
        return { rows: [{ status: 'deleted', deleted_at: new Date() }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  } as never));

  await assert.rejects(createAppeal({
    sanctionId: 'sanction-1', userId: 'closed-user', reason: 'Please review.',
    idempotencyKey: 'key-1', fingerprint: 'fingerprint-1'
  }), /account_not_active/);
  assert.ok(!statements.some((sql) => sql.includes('INSERT INTO appeals')));
});
