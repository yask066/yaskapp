import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigationType, useSearchParams } from 'react-router-dom';
import { NotificationCard } from './NotificationCard';
import { useNotifications } from './notification-store';
import { useListScrollState } from '../../core/scroll/useListScrollState';
import { useOptionalSession } from '../../app/session-provider';
import { AsyncState } from '../../components/AsyncState';

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
  const session = useOptionalSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter: Filter = searchParams.get('filter') === 'unread' ? 'unread' : 'all';
  const navigationType = useNavigationType();
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
  const notificationScroll = useListScrollState(
    { userId: session?.user?.id ?? null, route: '/notifications', list: 'notifications', query: '', filter, sort: '' },
    { itemIds: items.map((item) => item.id), restoreFocusOnPop: navigationType === 'POP' },
  );

  if (notifications.loading && !notifications.hasLoaded) {
    return <main id="main-content" className="notifications-page"><header className="page-heading"><div><p className="eyebrow">Inbox</p><h1>Notifications</h1></div></header><AsyncState state="loading" kind="notification" rows={3} /></main>;
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
          <button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => setSearchParams({}, { replace: true })}>All</button>
          <button type="button" role="tab" aria-selected={filter === 'unread'} onClick={() => setSearchParams({ filter: 'unread' }, { replace: true })}>Unread</button>
        </div>
      </div>
      {notifications.pendingIds.length > 0 ? <button className="notifications-pending" type="button" onClick={() => { notifications.actions.clearPending(); window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}>New notifications ({notifications.pendingIds.length})</button> : null}
      {items.length === 0 ? <p className="notifications-state">{filter === 'unread' ? 'You are all caught up.' : 'No notifications yet.'}</p> : <div className="notification-groups" ref={notificationScroll.listRef}>
        {(['Today', 'Yesterday', 'Earlier'] as Group[]).map((group) => {
          const groupItems = groups.get(group);
          if (!groupItems?.length) return null;
          return <section key={group} aria-labelledby={`notifications-${group}`}><h2 id={`notifications-${group}`}>{group}</h2><div className="notification-list">{groupItems.map((item) => <NotificationCard key={item.id} item={item} onRead={(id) => void notifications.actions.markRead(id)} />)}</div></section>;
        })}
      </div>}
      {notifications.error && notifications.hasLoaded ? <section className="notifications-state" role="alert"><p>{notifications.error}</p><button className="button" type="button" onClick={() => void (notifications.error === 'Unable to load more notifications.' ? notifications.actions.loadMore() : notifications.actions.reconcile())}>Retry</button></section> : null}
      {notifications.nextCursor ? <button className="button notifications-load-more" type="button" disabled={notifications.loading} aria-busy={notifications.loadingMore || undefined} aria-label={notifications.loadingMore ? 'Loading more notifications' : undefined} onClick={() => void notifications.actions.loadMore()}>{notifications.loadingMore ? <><span>Loading…</span><span className="sr-only" role="status">Loading more notifications…</span></> : 'Load more'}</button> : null}
      {notifications.loading && notifications.hasLoaded && !notifications.loadingMore ? <AsyncState state="refreshing" kind="notification" /> : null}
    </main>
  );
}
