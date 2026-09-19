import { Link } from 'react-router-dom';
import type { NotificationItem } from '@yaskapp/shared';
import { notificationHref } from './notification-target';

interface NotificationCardProps {
  item: NotificationItem;
  onRead: (id: string) => void;
}

function notificationCopy(item: NotificationItem): string {
  const actor = item.actor?.displayName ?? 'Someone';
  if (item.type === 'follow') return `${actor} followed you`;
  if (item.type === 'poll_vote') return `${actor} voted on your poll`;
  if (item.type === 'comment_reply') return `${actor} replied to your comment`;
  if (item.type === 'like') return `${actor} liked your content`;
  return `${actor} commented on your poll`;
}

function relativeTime(createdAt: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(createdAt)) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function NotificationCard({ item, onRead }: NotificationCardProps) {
  const href = notificationHref(item);
  const copy = notificationCopy(item);
  const content = (
    <>
      <span className="notification-card__copy">{copy}</span>
      <time className="notification-card__time" dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{relativeTime(item.createdAt)}</time>
    </>
  );

  return (
    <article className={`notification-card${item.readAt ? '' : ' notification-card--unread'}`} aria-label={item.readAt ? copy : `${copy}, unread`}>
      {href ? <Link to={href} onClick={() => onRead(item.id)}>{content}</Link> : <div className="notification-card__unavailable">{content}<span className="notification-card__status">This content is no longer available</span></div>}
    </article>
  );
}
