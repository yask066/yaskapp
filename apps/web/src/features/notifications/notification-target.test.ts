import { describe, expect, test } from 'vitest';
import { notificationHref } from './notification-target';
import type { NotificationItem } from '@yaskapp/shared';

const base: NotificationItem = {
  id: 'notification-1', type: 'poll_vote', actor: { id: 'user-1', username: 'member', displayName: 'Member', avatarUrl: null },
  targetType: 'poll', pollId: 'poll-1', commentId: null, payload: {}, readAt: null,
  createdAt: '2026-09-19T12:00:00.000Z', isTargetAvailable: true,
};

describe('notificationHref', () => {
  test('resolves poll, comment, and profile targets to canonical URLs', () => {
    expect(notificationHref(base)).toBe('/polls/poll-1');
    expect(notificationHref({ ...base, targetType: 'comment', type: 'comment', commentId: 'comment-1' })).toBe('/polls/poll-1?comment=comment-1');
    expect(notificationHref({ ...base, targetType: 'profile', type: 'follow', pollId: null })).toBe('/users/user-1');
  });

  test('returns null for unavailable or incomplete targets', () => {
    expect(notificationHref({ ...base, isTargetAvailable: false })).toBeNull();
    expect(notificationHref({ ...base, pollId: null })).toBeNull();
    expect(notificationHref({ ...base, targetType: 'profile', type: 'follow', actor: null, pollId: null })).toBeNull();
  });
});
