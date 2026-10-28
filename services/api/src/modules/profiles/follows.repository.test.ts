import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

const { db } = await import('../../config/database.js');
const { FollowRepositoryError, followUserRecord } = await import('./follows.repository.js');

test('self follow is rejected before a transaction or notification can be created', async () => {
  await assert.rejects(
    () => followUserRecord({ followerId: 'same-user', followeeId: 'same-user' }),
    (error: unknown) => error instanceof FollowRepositoryError && error.code === 'SELF_FOLLOW'
  );
});

test('closed_account_cannot_create_a_follow', async (context: TestContext) => {
  const statements: string[] = [];
  context.mock.method(db, 'connect', async () => ({
    async query(sql: string, parameters: unknown[]) {
      statements.push(sql);
      if (sql.includes('SELECT status, deleted_at FROM users')) {
        const userId = parameters[0];
        return { rows: [{ status: userId === 'closed-user' ? 'deleted' : 'active', deleted_at: userId === 'closed-user' ? new Date() : null }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  } as never));

  await assert.rejects(followUserRecord({ followerId: 'closed-user', followeeId: 'active-user' }), /account_not_active/);
  assert.ok(!statements.some((sql) => sql.includes('INSERT INTO follows')));
});
