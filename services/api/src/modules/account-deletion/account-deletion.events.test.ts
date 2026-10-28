import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dispatchClaimedDeletionEvent } from './account-deletion.events.js';

test('Redis outage keeps account.deleted pending for retry', async () => {
  const actions: string[] = [];
  const delivered = await dispatchClaimedDeletionEvent({
    id: 'event-1',
    userId: 'user-1',
    operationId: 'operation-1'
  }, {
    async publish() { actions.push('publish'); throw new Error('redis unavailable'); },
    async markDelivered() { actions.push('delivered'); },
    async scheduleRetry() { actions.push('retry'); }
  });

  assert.equal(delivered, false);
  assert.deepEqual(actions, ['publish', 'retry']);
});

test('account.deleted is acknowledged only after the Redis publish succeeds', async () => {
  const actions: string[] = [];
  const delivered = await dispatchClaimedDeletionEvent({
    id: 'event-2',
    userId: 'user-2',
    operationId: 'operation-2'
  }, {
    async publish(event) { actions.push(`${event.type}:${event.payload.userId}:${event.payload.operationId}`); },
    async markDelivered() { actions.push('delivered'); },
    async scheduleRetry() { actions.push('retry'); }
  });

  assert.equal(delivered, true);
  assert.deepEqual(actions, ['account.deleted:user-2:operation-2', 'delivered']);
});
