import assert from 'node:assert/strict';
import { test } from 'node:test';

test('notifications repository exposes the Phase 1 persistence operations', async () => {
  const repository = await import('./notifications.repository.js');

  assert.equal(typeof repository.createNotification, 'function');
  assert.equal(typeof repository.listNotifications, 'function');
  assert.equal(typeof repository.markNotificationRead, 'function');
  assert.equal(typeof repository.markAllNotificationsRead, 'function');
});

test('notification actors expose a public avatar URL', async () => {
  const { mapNotification } = await import('./notifications.repository.js');

  const notification = mapNotification({
    id: 'notification-1',
    type: 'follow',
    actor_id: 'actor-1',
    actor_username: 'alice',
    actor_display_name: 'Alice',
    actor_avatar_object_key: 'avatars/actor-1/avatar.webp',
    poll_id: null,
    comment_id: null,
    payload: {},
    read_at: null,
    created_at: new Date('2026-08-29T10:00:00.000Z'),
    poll_deleted_at: null,
    comment_deleted_at: null
  });

  assert.equal(notification.actor?.avatarUrl, '/media/avatars/actor-1');
});
