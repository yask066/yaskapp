import type { NotificationItem } from '@yaskapp/shared';

export function notificationHref(item: NotificationItem): string | null {
  if (!item.isTargetAvailable) return null;
  if (item.targetType === 'profile') return item.actor ? `/users/${encodeURIComponent(item.actor.id)}` : null;
  if (!item.pollId) return null;
  if (item.targetType === 'comment') return item.commentId ? `/polls/${encodeURIComponent(item.pollId)}?comment=${encodeURIComponent(item.commentId)}` : null;
  return `/polls/${encodeURIComponent(item.pollId)}`;
}
