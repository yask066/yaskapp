import { render, screen, waitFor } from '@testing-library/react';
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
  session: { current: { status: 'authenticated' as 'authenticated' | 'anonymous', user: { id: 'user-1' } as { id: string } | null } },
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
  return <output data-testid="unread-count">{notifications.unreadCount}</output>;
}

describe('NotificationProvider session lifecycle', () => {
  afterEach(() => {
    session.current = { status: 'authenticated', user: { id: 'user-1' } };
    getUnreadCount.mockClear();
    listNotifications.mockClear();
  });

  it('loads only the unread count for an authenticated session', async () => {
    render(<NotificationProvider><ProviderProbe /></NotificationProvider>);

    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));
    expect(getUnreadCount).toHaveBeenCalledOnce();
    expect(listNotifications).not.toHaveBeenCalled();
  });

  it('resets state when the authenticated user changes', async () => {
    const view = render(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));

    session.current = { status: 'anonymous', user: null };
    view.rerender(<NotificationProvider><ProviderProbe /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('0'));
  });
});
