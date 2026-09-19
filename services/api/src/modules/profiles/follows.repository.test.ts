import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

const { FollowRepositoryError, followUserRecord } = await import('./follows.repository.js');

test('self follow is rejected before a transaction or notification can be created', async () => {
  await assert.rejects(
    () => followUserRecord({ followerId: 'same-user', followeeId: 'same-user' }),
    (error: unknown) => error instanceof FollowRepositoryError && error.code === 'SELF_FOLLOW'
  );
});
