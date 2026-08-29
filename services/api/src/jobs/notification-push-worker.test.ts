import assert from 'node:assert/strict';
import test from 'node:test';

import { pushRetryDelaySeconds, shouldRetryPushJob } from './notification-push-worker.js';

test('push retries use bounded exponential backoff', () => {
  assert.equal(pushRetryDelaySeconds(1), 1);
  assert.equal(pushRetryDelaySeconds(4), 8);
  assert.equal(pushRetryDelaySeconds(20), 900);
});

test('push retry stops at max attempts', () => {
  assert.equal(shouldRetryPushJob(1, 8), true);
  assert.equal(shouldRetryPushJob(8, 8), false);
});
