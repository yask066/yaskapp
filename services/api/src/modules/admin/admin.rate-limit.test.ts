import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ADMIN_MUTATION_RATE_LIMIT_OPTIONS } from './admin.rate-limit.js';

test('admin destructive operations use a user-scoped 30 requests per minute limit', () => {
  assert.deepEqual(ADMIN_MUTATION_RATE_LIMIT_OPTIONS, {
    keyPrefix: 'admin-mutation',
    keyBy: 'user',
    limit: 30,
    windowMs: 60_000,
    errorCode: 'rate_limit_exceeded'
  });
});
