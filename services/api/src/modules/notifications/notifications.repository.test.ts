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
    actor_deleted_at: null,
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

test('notification mapping exposes canonical target type and strips unsafe payload fields', async () => {
  const { mapNotification } = await import('./notifications.repository.js');

  const notification = mapNotification({
    id: 'notification-2',
    type: 'comment',
    actor_id: 'actor-2',
    actor_username: 'bob',
    actor_display_name: 'Bob',
    actor_avatar_object_key: null,
    actor_deleted_at: null,
    poll_id: 'poll-2',
    comment_id: 'comment-2',
    payload: {
      displayName: 'Bob',
      pollQuestion: 'A public question',
      email: 'bob@example.com',
      storageObjectKey: 'private/key',
      commentBody: 'private comment text'
    },
    read_at: null,
    created_at: new Date('2026-08-29T10:00:00.000Z'),
    poll_deleted_at: null,
    comment_deleted_at: null
  });

  assert.equal(notification.targetType, 'comment');
  assert.deepEqual(notification.payload, { displayName: 'Bob', pollQuestion: 'A public question' });
});

test('notification mapping marks missing or deleted targets unavailable', async () => {
  const { mapNotification } = await import('./notifications.repository.js');
  const base = {
    id: 'notification-3',
    type: 'follow' as const,
    actor_id: 'actor-3',
    actor_username: 'carol',
    actor_display_name: 'Carol',
    actor_avatar_object_key: null,
    actor_deleted_at: null,
    poll_id: null,
    comment_id: null,
    payload: {},
    read_at: null,
    created_at: new Date('2026-08-29T10:00:00.000Z'),
    poll_deleted_at: null,
    comment_deleted_at: null
  };

  assert.equal(mapNotification({ ...base, actor_id: null, actor_username: null, actor_display_name: null }).isTargetAvailable, false);
  assert.equal(mapNotification({ ...base, actor_deleted_at: new Date() }).isTargetAvailable, false);
  assert.equal(mapNotification({ ...base, poll_id: 'poll-3', poll_deleted_at: new Date() }).isTargetAvailable, false);
  assert.equal(mapNotification({ ...base, comment_id: 'comment-3', comment_deleted_at: new Date() }).isTargetAvailable, false);
});

test('read mutations return exact idempotent responses and stay recipient-scoped', async () => {
  const { markNotificationRead, markAllNotificationsRead, getNotificationForRecipient } = await import('./notifications.repository.js');
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const executor = {
    async query<T>(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (sql.includes('WITH marked')) {
        return { rows: [{ read_at: new Date('2026-09-19T12:01:00.000Z'), updated_count: 2 }] } as { rows: T[] };
      }
      if (sql.includes('UPDATE notifications')) {
        return { rows: [{ notification_id: 'notification-4', read_at: new Date('2026-09-19T12:00:00.000Z') }] } as { rows: T[] };
      }
      if (sql.includes('COUNT(*)::text AS count')) {
        return { rows: [{ count: '2' }] } as { rows: T[] };
      }
      return { rows: [] } as { rows: T[] };
    }
  };

  assert.deepEqual(await markNotificationRead('notification-4', 'recipient-4', executor as never), {
    notificationId: 'notification-4',
    readAt: '2026-09-19T12:00:00.000Z',
    unreadCount: 2
  });
  assert.deepEqual(await markAllNotificationsRead('recipient-4', executor as never), {
    readAt: '2026-09-19T12:01:00.000Z',
    updatedCount: 2,
    unreadCount: 0
  });
  assert.equal(await getNotificationForRecipient('notification-4', 'recipient-4', executor as never), null);
  assert.match(calls[0]?.values?.join('|') ?? '', /notification-4\|recipient-4/);
  assert.match(calls[1]?.sql ?? '', /COUNT\(\*\)::text AS count/);
  assert.deepEqual(calls[1]?.values, ['recipient-4']);
});
