import assert from 'node:assert/strict';
import { test } from 'node:test';

test('notifications repository exposes the Phase 1 persistence operations', async () => {
  const repository = await import('./notifications.repository.js');

  assert.equal(typeof repository.createNotification, 'function');
  assert.equal(typeof repository.listNotifications, 'function');
  assert.equal(typeof repository.markNotificationRead, 'function');
  assert.equal(typeof repository.markAllNotificationsRead, 'function');
});
