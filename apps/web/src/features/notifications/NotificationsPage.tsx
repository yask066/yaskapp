import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { NotificationCard } from './NotificationCard';
import { useNotifications } from './notification-store';

type Filter = 'all' | 'unread';
type Group = 'Today' | 'Yesterday' | 'Earlier';

function groupFor(createdAt: string, now: Date): Group {
  const date = new Date(createdAt);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start - day) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return 'Earlier';
}

export function NotificationsPage() {
  const notifications = useNotifications();
  const [filter, setFilter] = useState<Filter>('all');
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (!notifications.hasLoaded && !notifications.loading && !notifications.error) void notifications.actions.reconcile();
  }, [notifications]);

  const items = useMemo(() => notifications.ids
    .map((id) => notifications.itemsById[id])
    .filter((item) => filter === 'all' || !item.readAt), [filter, notifications.ids, notifications.itemsById]);
  const groups = useMemo(() => {
    const result = new Map<Group, typeof items>();
    for (const item of items) {
      const group = groupFor(item.createdAt, now);
      result.set(group, [...(result.get(group) ?? []), item]);
    }
    return result;
  }, [items, now]);

  if (notifications.loading && !notifications.hasLoaded) {
    return <main id="main-content" className="notifications-page"><header className="page-heading"><div><p className="eyebrow">Inbox</p><h1>Notifications</h1></div></header><div className="notification-skeleton" aria-label="Loading notifications"><span /><span /><span /></div></main>;
  }

  if (notifications.error && !notifications.hasLoaded) {
    return <main id="main-content" className="notifications-page"><header className="page-heading"><div><p className="eyebrow">Inbox</p><h1>Notifications</h1></div></header><section className="notifications-state" role="alert"><p>{notifications.error}</p><button className="button" type="button" onClick={() => void notifications.actions.reconcile()}>Retry</button></section></main>;
  }

  return (
    <main id="main-content" className="notifications-page">
      <header className="page-heading">
        <div><p className="eyebrow">Inbox</p><h1>Notifications</h1></div>
        <div className="notifications-page__actions">
          <Link className="button button--quiet" to="/settings/notifications">Settings</Link>
          {notifications.unreadCount > 0 ? <button className="button" type="button" onClick={() => void notifications.actions.markAllRead()}>Mark all as read</button> : null}
        </div>
      </header>
      <div className="notifications-toolbar">
        <div className="segmented-tabs" role="tablist" aria-label="Notification filters">
          <button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          <button type="button" role="tab" aria-selected={filter === 'unread'} onClick={() => setFilter('unread')}>Unread</button>
        </div>
      </div>
      {notifications.pendingIds.length > 0 ? <button className="notifications-pending" type="button" onClick={() => { notifications.actions.clearPending(); window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}>New notifications ({notifications.pendingIds.length})</button> : null}
      {items.length === 0 ? <p className="notifications-state">{filter === 'unread' ? 'You are all caught up.' : 'No notifications yet.'}</p> : <div className="notification-groups">
        {(['Today', 'Yesterday', 'Earlier'] as Group[]).map((group) => {
          const groupItems = groups.get(group);
          if (!groupItems?.length) return null;
          return <section key={group} aria-labelledby={`notifications-${group}`}><h2 id={`notifications-${group}`}>{group}</h2><div className="notification-list">{groupItems.map((item) => <NotificationCard key={item.id} item={item} onRead={(id) => void notifications.actions.markRead(id)} />)}</div></section>;
        })}
      </div>}
      {notifications.error && notifications.hasLoaded ? <section className="notifications-state" role="alert"><p>{notifications.error}</p><button className="button" type="button" onClick={() => void notifications.actions.reconcile()}>Retry</button></section> : null}
      {notifications.nextCursor ? <button className="button notifications-load-more" type="button" disabled={notifications.loading} onClick={() => void notifications.actions.loadMore()}>{notifications.loading ? 'Loading…' : 'Load more'}</button> : null}
    </main>
  );
}
