import assert from 'node:assert/strict';
import test from 'node:test';

import type { NotificationItem } from '@yaskapp/shared';

import {
  buildNotificationCreatedEvent,
  createPostCommitNotificationPublisher,
  type NotificationEventPublisher
} from './notifications.events.js';

const item: NotificationItem = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'like',
  actor: {
    id: '22222222-2222-4222-8222-222222222222',
    username: 'alice',
    displayName: 'Alice',
    avatarUrl: null
  },
  targetType: 'comment',
  pollId: '33333333-3333-4333-8333-333333333333',
  commentId: '44444444-4444-4444-8444-444444444444',
  payload: { displayName: 'Alice', commentExcerpt: 'A safe excerpt' },
  readAt: null,
  createdAt: '2026-09-19T10:00:00.000Z',
  isTargetAvailable: true
};

test('buildNotificationCreatedEvent preserves the complete notification item', () => {
  assert.deepEqual(buildNotificationCreatedEvent(item, 7), {
    version: 1,
    type: 'notification.created',
    payload: { notification: item, unreadCount: 7 }
  });
});

test('post-commit publisher reads the authoritative item before publishing', async () => {
  const calls: Array<{ userId: string; event: unknown }> = [];
  const publish: NotificationEventPublisher = (userId, event) => {
    calls.push({ userId, event });
  };
  const publisher = createPostCommitNotificationPublisher({
    getNotification: async () => item,
    countUnread: async () => 3,
    publish
  });

  await publisher('recipient-id', item.id);

  assert.deepEqual(calls, [{
    userId: 'recipient-id',
    event: buildNotificationCreatedEvent(item, 3)
  }]);
});

test('post-commit publisher does not publish a missing or rolled-back notification', async () => {
  const calls: unknown[] = [];
  const publisher = createPostCommitNotificationPublisher({
    getNotification: async () => null,
    countUnread: async () => 1,
    publish: (_userId, event) => { calls.push(event); }
  });

  await publisher('recipient-id', item.id);
  assert.equal(calls.length, 0);
});

test('post-commit publisher never invokes the transport before its caller commits', async () => {
  const lifecycle: string[] = [];
  const publisher = createPostCommitNotificationPublisher({
    getNotification: async () => {
      lifecycle.push('read-after-commit');
      return item;
    },
    countUnread: async () => 1,
    publish: (_userId, _event) => {
      lifecycle.push('publish');
    }
  });

  lifecycle.push('commit');
  await publisher('recipient-id', item.id);
  assert.deepEqual(lifecycle, ['commit', 'read-after-commit', 'publish']);
});
