import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { NotificationItem } from '@yaskapp/shared';
import { NotificationsPage } from './NotificationsPage';

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn().mockResolvedValue(undefined),
  loadMore: vi.fn().mockResolvedValue(undefined),
  markAllRead: vi.fn().mockResolvedValue(undefined),
  markRead: vi.fn().mockResolvedValue(undefined),
  clearPending: vi.fn(),
  pendingIds: [] as string[],
}));

vi.mock('./notification-store', () => ({
  useNotifications: () => ({
    itemsById: Object.fromEntries(items.map((item) => [item.id, item])),
    ids: items.map((item) => item.id), pendingIds: mocks.pendingIds, unreadCount: 1,
    nextCursor: 'next-page', loading: false, error: null, hasLoaded: true,
    actions: mocks, realtimeStatus: 'connected',
  }),
}));

const items: NotificationItem[] = [
  { id: 'n-today', type: 'comment', actor: { id: 'u-1', username: 'alice', displayName: 'Alice', avatarUrl: null }, targetType: 'comment', pollId: 'p-1', commentId: 'c-1', payload: {}, readAt: null, createdAt: '2026-09-19T10:00:00.000Z', isTargetAvailable: true },
  { id: 'n-yesterday', type: 'follow', actor: { id: 'u-2', username: 'bob', displayName: 'Bob', avatarUrl: null }, targetType: 'profile', pollId: null, commentId: null, payload: {}, readAt: '2026-09-18T10:00:00.000Z', createdAt: '2026-09-18T10:00:00.000Z', isTargetAvailable: true },
];

beforeEach(() => { vi.clearAllMocks(); mocks.pendingIds = []; });

function renderPage() {
  return render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
}

test('renders notification filters, date groups and canonical card links without reading on open', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T12:00:00.000Z'));
  renderPage();

  expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Unread' })).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByText('Today')).toBeInTheDocument();
  expect(screen.getByText('Yesterday')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Alice/ })).toHaveAttribute('href', '/polls/p-1?comment=c-1');
  expect(mocks.markRead).not.toHaveBeenCalled();
  vi.useRealTimers();
});

test('filters unread notifications and marks all read only after explicit action', async () => {
  const user = userEvent.setup();
  renderPage();

  await user.click(screen.getByRole('tab', { name: 'Unread' }));
  expect(screen.getByRole('link', { name: /Alice/ })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Bob/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Mark all as read' }));
  expect(mocks.markAllRead).toHaveBeenCalledOnce();
  expect(mocks.markRead).not.toHaveBeenCalled();
});

test('shows retry, empty and load-more states', async () => {
  renderPage();
  expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Load more' }));
  expect(mocks.loadMore).toHaveBeenCalledOnce();
});

test('shows pending realtime notifications as a top banner', () => {
  mocks.pendingIds = ['pending-1', 'pending-2'];
  renderPage();
  expect(screen.getByRole('button', { name: 'New notifications (2)' })).toBeInTheDocument();
});
