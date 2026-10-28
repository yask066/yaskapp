import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getNotificationMetrics, recordRateLimitResponse } from './notifications.metrics.js';

test('rate-limit responses count only throttled requests', () => {
  const before = getNotificationMetrics().rateLimitResponses;

  recordRateLimitResponse(200);
  assert.equal(getNotificationMetrics().rateLimitResponses, before);

  recordRateLimitResponse(429);
  assert.equal(getNotificationMetrics().rateLimitResponses, before + 1);
});
