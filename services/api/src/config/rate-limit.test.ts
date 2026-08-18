import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { closeRedisConnection, redis } from './redis.js';
import { consumeRateLimit } from './rate-limit.js';

const keyPrefix = `test-rate-limit-${Date.now()}`;
const key = `ratelimit:${keyPrefix}:198.51.100.10`;

test('rate limiter blocks requests after the configured limit', async () => {
  await redis.del(key);

  const first = await consumeRateLimit(key, 2, 10_000);
  const second = await consumeRateLimit(key, 2, 10_000);
  const third = await consumeRateLimit(key, 2, 10_000);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.ok(third.retryAfterSeconds > 0);
});

after(async () => {
  await redis.del(key);
  await closeRedisConnection();
});
