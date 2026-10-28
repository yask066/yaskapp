import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSessionRevoked } from './auth.utils.js';

test('session version mismatch revokes authorization', async () => {
  const revoked = await isSessionRevoked('user-1', 3, {
    async query() { return { rows: [{ session_version: 4 }] }; }
  } as never);

  assert.equal(revoked, true);
});

test('missing account row is treated as a revoked session', async () => {
  const revoked = await isSessionRevoked('user-deleted', 3, {
    async query() { return { rows: [] }; }
  } as never);

  assert.equal(revoked, true);
});
