import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationItem } from '@yaskapp/shared';
import { NotificationProvider, useNotifications } from './notification-store';
import {
  initialNotificationState,
  notificationReducer,
  type NotificationStoreState,
} from './notification-store';

const { getUnreadCount, listNotifications, markNotificationRead, markAllNotificationsRead, session } = vi.hoisted(() => ({
  getUnreadCount: vi.fn(() => Promise.resolve({ unreadCount: 3 })),
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  session: { current: { status: 'authenticated' as 'authenticated' | 'anonymous', user: { id: 'user-1' } as { id: string } | null, sessionEpoch: 1 } },
}));
vi.mock('../../api/notifications', () => ({ getUnreadCount, listNotifications, markNotificationRead, markAllNotificationsRead }));

vi.mock('../../app/session-provider', () => ({ useSession: () => session.current }));

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'notification-1',
  type: 'follow',
  actor: { id: 'user-2', username: 'member', displayName: 'Member', avatarUrl: null },
  targetType: 'profile',
  pollId: null,
  commentId: null,
  payload: {},
  readAt: null,
  createdAt: '2026-09-19T12:00:00.000Z',
  isTargetAvailable: true,
  ...overrides,
});

const stateWith = (items: NotificationItem[], extra: Partial<NotificationStoreState> = {}): NotificationStoreState =>
  notificationReducer(initialNotificationState, { type: 'merge', items, unreadCount: items.filter((entry) => !entry.readAt).length, nextCursor: null, ...extra });

describe('notificationReducer', () => {
  it('distinguishes a load-more request from a refresh and clears it after completion', () => {
    const loadingMore = notificationReducer(initialNotificationState, { type: 'loading', value: true, loadingMore: true });
    expect(loadingMore.loading).toBe(true);
    expect(loadingMore.loadingMore).toBe(true);

    const refreshed = notificationReducer(loadingMore, { type: 'loading', value: true });
    expect(refreshed.loading).toBe(true);
    expect(refreshed.loadingMore).toBe(false);

    const complete = notificationReducer(loadingMore, { type: 'merge', items: [], unreadCount: 0, nextCursor: null });
    expect(complete.loadingMore).toBe(false);
  });

  it('merges duplicate items by id and keeps newest-first stable order', () => {
    const older = item({ id: 'a', createdAt: '2026-09-18T12:00:00.000Z' });
    const newer = item({ id: 'b', createdAt: '2026-09-19T12:00:00.000Z' });
    const result = notificationReducer(stateWith([older]), { type: 'merge', items: [older, newer, { ...older, payload: { label: 'updated' } }], unreadCount: 2, nextCursor: 'cursor' });

    expect(result.ids).toEqual(['b', 'a']);
    expect(result.itemsById.a.payload).toEqual({ label: 'updated' });
    expect(result.unreadCount).toBe(2);
    expect(result.nextCursor).toBe('cursor');
  });

  it('does not let a stale read event roll back a newer readAt or unread count', () => {
    const current = item({ readAt: '2026-09-19T12:05:00.000Z' });
    const state = stateWith([current], { unreadCount: 0 });
    const result = notificationReducer(state, { type: 'readEvent', notificationId: current.id, readAt: '2026-09-19T12:01:00.000Z', unreadCount: 1 });

    expect(result.itemsById[current.id].readAt).toBe(current.readAt);
    expect(result.unreadCount).toBe(0);
  });

  it('does not let a duplicate creation event restore an unread count after an authoritative read', () => {
    const current = item({ readAt: '2026-09-19T12:05:00.000Z' });
    const state = stateWith([current], { unreadCount: 0 });
    const result = notificationReducer(state, {
      type: 'createdEvent',
      item: { ...current, readAt: null },
      unreadCount: 1,
      atTop: true,
    });

    expect(result.itemsById[current.id].readAt).toBe(current.readAt);
    expect(result.unreadCount).toBe(0);
  });

  it('does not apply a delayed read-all event to notifications created afterward', () => {
    const later = item({ id: 'later', createdAt: '2026-09-19T12:20:00.000Z' });
    const state = stateWith([later], { unreadCount: 1 });
    const result = notificationReducer(state, {
      type: 'readAllEvent',
      readAt: '2026-09-19T12:10:00.000Z',
    });

    expect(result.itemsById.later.readAt).toBeNull();
    expect(result.unreadCount).toBe(1);
  });

  it('optimistically reads one item and can roll back the exact snapshot', () => {
    const current = item();
    const state = stateWith([current]);
    const optimistic = notificationReducer(state, { type: 'optimisticRead', notificationId: current.id, readAt: '2026-09-19T12:10:00.000Z' });
    expect(optimistic.itemsById[current.id].readAt).toBe('2026-09-19T12:10:00.000Z');
    expect(optimistic.unreadCount).toBe(0);

    const rolledBack = notificationReducer(optimistic, { type: 'rollback', snapshot: state });
    expect(rolledBack).toEqual(state);
  });

  it('optimistically reads all items while preserving cards and reconciles authoritative fields', () => {
    const first = item({ id: 'a' });
    const second = item({ id: 'b', createdAt: '2026-09-18T12:00:00.000Z' });
    const state = stateWith([first, second]);
    const optimistic = notificationReducer(state, { type: 'optimisticReadAll', readAt: '2026-09-19T12:10:00.000Z' });
    expect(optimistic.ids).toEqual(['a', 'b']);
    expect(optimistic.unreadCount).toBe(0);
    expect(optimistic.itemsById.a.readAt).toBe('2026-09-19T12:10:00.000Z');

    const reconciled = notificationReducer(optimistic, { type: 'reconcile', items: [item({ id: 'a', readAt: null, isTargetAvailable: false })], unreadCount: 1, nextCursor: 'next' });
    expect(reconciled.ids).toEqual(['a', 'b']);
    expect(reconciled.itemsById.a.readAt).toBeNull();
    expect(reconciled.itemsById.a.isTargetAvailable).toBe(false);
    expect(reconciled.unreadCount).toBe(1);
    expect(reconciled.nextCursor).toBe('next');
  });

  it('tracks new items as pending without duplicating them', () => {
    const current = item();
    const state = stateWith([current]);
    const next = item({ id: 'notification-2', createdAt: '2026-09-19T13:00:00.000Z' });
    const result = notificationReducer(state, { type: 'createdEvent', item: next, unreadCount: 2, atTop: false });
    const duplicate = notificationReducer(result, { type: 'createdEvent', item: next, unreadCount: 2, atTop: false });

    expect(result.ids).toEqual(['notification-2', 'notification-1']);
    expect(result.pendingIds).toEqual(['notification-2']);
    expect(duplicate.pendingIds).toEqual(['notification-2']);
  });
});

function ProviderProbe() {
  const notifications = useNotifications();
  return <><output data-testid="unread-count">{notifications.unreadCount}</output><output data-testid="notification-error">{notifications.error}</output><output data-testid="notification-ids">{notifications.ids.join(',')}</output><output data-testid="pending-ids">{notifications.pendingIds.join(',')}</output><output data-testid="loading-more">{String(notifications.loadingMore)}</output><button onClick={() => { void notifications.actions.reconcile(); void notifications.actions.reconcile(); }}>reconcile</button><button onClick={() => void notifications.actions.loadMore()}>load more</button><button onClick={() => { void notifications.actions.markRead('notification-1'); }}>read</button><button onClick={() => { void notifications.actions.markAllRead(); }}>read all</button><button onClick={() => notifications.actions.applyRealtime({ version: 1, type: 'notification.created', payload: { notification: item({ id: 'notification-new', createdAt: '2026-09-19T13:00:00.000Z' }), unreadCount: 4 } })}>new notification</button></>;
}

describe('NotificationProvider session lifecycle', () => {
  afterEach(() => {
    session.current = { status: 'authenticated', user: { id: 'user-1' }, sessionEpoch: 1 };
    getUnreadCount.mockClear();
    listNotifications.mockClear();
    markNotificationRead.mockClear();
    markAllNotificationsRead.mockClear();
  });

  it('loads only the unread count for an authenticated session', async () => {
    render(<NotificationProvider><ProviderProbe /></NotificationProvider>);

    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));
    expect(getUnreadCount).toHaveBeenCalledOnce();
    expect(listNotifications).not.toHaveBeenCalled();
  });

  it('buffers realtime arrivals while the open inbox is scrolled beyond the top threshold', async () => {
    const scrollTop = vi.spyOn(document.documentElement, 'scrollTop', 'get').mockReturnValue(40);
    render(<NotificationProvider><main className="notifications-page"><ProviderProbe /></main></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: 'new notification' }));

    expect(screen.getByTestId('notification-ids')).toHaveTextContent('notification-new');
    expect(screen.getByTestId('pending-ids')).toHaveTextContent('notification-new');
    scrollTop.mockRestore();
  });

  it('auto-inserts a realtime arrival at the 24-pixel inbox threshold', async () => {
    const scrollTop = vi.spyOn(document.documentElement, 'scrollTop', 'get').mockReturnValue(24);
    render(<NotificationProvider><main className="notifications-page"><ProviderProbe /></main></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: 'new notification' }));

    expect(screen.getByTestId('notification-ids')).toHaveTextContent('notification-new');
    expect(screen.getByTestId('pending-ids')).toBeEmptyDOMElement();
    scrollTop.mockRestore();
  });

  it('registers browser visibility reconciliation for the active notification session', async () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const view = render(<NotificationProvider><ProviderProbe /></NotificationProvider>);

    await waitFor(() => expect(addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function)));

    view.unmount();
    addEventListener.mockRestore();
  });

  it('resets state when the authenticated user changes', async () => {
    const view = render(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    session.current = { status: 'anonymous', user: null, sessionEpoch: 2 };
    view.rerender(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('0'));
  });

  it('coalesces simultaneous realtime reconciliation triggers into one request', async () => {
    let resolve: ((value: { items: NotificationItem[]; unreadCount: number; nextCursor: null }) => void) | undefined;
    listNotifications.mockImplementationOnce(() => new Promise((complete) => { resolve = complete; }));
    render(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: 'reconcile' }));
    await waitFor(() => expect(listNotifications).toHaveBeenCalledOnce());
    resolve?.({ items: [], unreadCount: 0, nextCursor: null });
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('0'));
  });

  it('marks only the cursor request as load-more', async () => {
    let finishLoadMore: ((value: { items: NotificationItem[]; unreadCount: number; nextCursor: null }) => void) | undefined;
    listNotifications
      .mockResolvedValueOnce({ items: [item()], unreadCount: 1, nextCursor: 'cursor' })
      .mockImplementationOnce(() => new Promise((resolve) => { finishLoadMore = resolve; }));
    render(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: 'reconcile' }));
    await waitFor(() => expect(screen.getByTestId('notification-ids')).toHaveTextContent('notification-1'));
    expect(screen.getByTestId('loading-more')).toHaveTextContent('false');

    fireEvent.click(screen.getByRole('button', { name: 'load more' }));
    await waitFor(() => expect(screen.getByTestId('loading-more')).toHaveTextContent('true'));
    finishLoadMore?.({ items: [], unreadCount: 1, nextCursor: null });
    await waitFor(() => expect(screen.getByTestId('loading-more')).toHaveTextContent('false'));
  });

  it('reconciles and exposes a contextual error when marking read is ambiguous', async () => {
    markNotificationRead.mockRejectedValueOnce(new Error('timeout'));
    listNotifications.mockResolvedValueOnce({ items: [], unreadCount: 0, nextCursor: null });
    render(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: 'read' }));

    await waitFor(() => expect(screen.getByTestId('notification-error')).toHaveTextContent('Unable to mark notification as read'));
    expect(listNotifications).toHaveBeenCalledOnce();
  });

  it('does not roll back a previous user snapshot after their read request fails', async () => {
    let rejectRead: ((reason?: unknown) => void) | undefined;
    listNotifications
      .mockResolvedValueOnce({ items: [item()], unreadCount: 1, nextCursor: null })
      .mockResolvedValueOnce({ items: [], unreadCount: 0, nextCursor: null });
    markNotificationRead.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
    const view = render(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: 'reconcile' }));
    await waitFor(() => expect(screen.getByTestId('notification-ids')).toHaveTextContent('notification-1'));
    fireEvent.click(screen.getByRole('button', { name: 'read' }));

    session.current = { status: 'authenticated', user: { id: 'user-2' }, sessionEpoch: 2 };
    view.rerender(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('notification-ids')).toBeEmptyDOMElement());
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    await act(async () => {
      rejectRead?.(new Error('late timeout'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(markNotificationRead).toHaveBeenCalledOnce();
    expect(screen.getByTestId('notification-ids')).toBeEmptyDOMElement();
    expect(screen.getByTestId('unread-count')).toHaveTextContent('3');
    expect(listNotifications).toHaveBeenCalledOnce();
  });

  it('ignores a successful read-all response from a previous user session', async () => {
    let resolveReadAll: ((value: { readAt: string; updatedCount: number; unreadCount: number }) => void) | undefined;
    markAllNotificationsRead.mockImplementationOnce(() => new Promise((resolve) => { resolveReadAll = resolve; }));
    const view = render(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    fireEvent.click(screen.getByRole('button', { name: 'read all' }));
    session.current = { status: 'authenticated', user: { id: 'user-2' }, sessionEpoch: 2 };
    view.rerender(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    await act(async () => {
      resolveReadAll?.({ readAt: '2026-09-19T12:30:00.000Z', updatedCount: 3, unreadCount: 0 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByTestId('notification-ids')).toBeEmptyDOMElement();
    expect(screen.getByTestId('unread-count')).toHaveTextContent('3');
  });
});
