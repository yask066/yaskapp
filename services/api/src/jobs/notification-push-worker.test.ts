import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { db } from '../config/database.js';
import { deliverPendingPushNotifications, pushRetryDelaySeconds, shouldRetryPushJob } from './notification-push-worker.js';

test('push retries use bounded exponential backoff', () => {
  assert.equal(pushRetryDelaySeconds(1), 1);
  assert.equal(pushRetryDelaySeconds(4), 8);
  assert.equal(pushRetryDelaySeconds(20), 900);
});

test('push retry stops at max attempts', () => {
  assert.equal(shouldRetryPushJob(1, 8), true);
  assert.equal(shouldRetryPushJob(8, 8), false);
});

test('claimed_push_cannot_recreate_job_after_account_close', async (context: TestContext) => {
  let connectCount = 0;
  let providerCalls = 0;
  context.mock.method(db, 'connect', async () => {
    connectCount += 1;
    return {
      async query(sql: string) {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
        if (sql.includes('WITH claimed AS')) {
          return { rows: [{
            id: 'job-1', notificationId: 'notification-1', recipientUserId: 'deleted-user',
            type: 'poll_comment', pollId: 'poll-1', commentId: null, attempts: 1, maxAttempts: 8
          }] };
        }
        if (sql.includes('SELECT status, deleted_at FROM users')) {
          return { rows: [{ status: 'deleted', deleted_at: new Date() }] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      release() {}
    } as never;
  });
  context.mock.method(db, 'query', async (sql: string) => {
    assert.match(sql, /UPDATE notification_push_jobs SET status = 'failed'/);
    return { rows: [], rowCount: 1 };
  });

  const result = await deliverPendingPushNotifications({
    async send() { providerCalls += 1; return 'sent'; }
  });

  assert.deepEqual(result, { processed: 1, delivered: 0 });
  assert.equal(connectCount, 2);
  assert.equal(providerCalls, 0);
});
