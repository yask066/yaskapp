import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { NotificationItem } from '@yaskapp/shared';
import { NotificationsPage } from './NotificationsPage';

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn().mockResolvedValue(undefined),
  loadMore: vi.fn().mockResolvedValue(undefined),
  markAllRead: vi.fn().mockResolvedValue(undefined),
  markRead: vi.fn().mockResolvedValue(undefined),
  clearPending: vi.fn(),
  pendingIds: [] as string[],
  load: { loading: false, loadingMore: false, hasLoaded: true, error: null as string | null },
}));

vi.mock('./notification-store', () => ({
  useNotifications: () => ({
    itemsById: Object.fromEntries(items.map((item) => [item.id, item])),
    ids: items.map((item) => item.id), pendingIds: mocks.pendingIds, unreadCount: 1,
    nextCursor: 'next-page', ...mocks.load,
    actions: mocks, realtimeStatus: 'connected',
  }),
}));

const items: NotificationItem[] = [
  { id: 'n-today', type: 'comment', actor: { id: 'u-1', username: 'alice', displayName: 'Alice', avatarUrl: null }, targetType: 'comment', pollId: 'p-1', commentId: 'c-1', payload: {}, readAt: null, createdAt: '2026-09-19T10:00:00.000Z', isTargetAvailable: true },
  { id: 'n-yesterday', type: 'follow', actor: { id: 'u-2', username: 'bob', displayName: 'Bob', avatarUrl: null }, targetType: 'profile', pollId: null, commentId: null, payload: {}, readAt: '2026-09-18T10:00:00.000Z', createdAt: '2026-09-18T10:00:00.000Z', isTargetAvailable: true },
];

beforeEach(() => { vi.useRealTimers(); vi.clearAllMocks(); mocks.pendingIds = []; mocks.load = { loading: false, loadingMore: false, hasLoaded: true, error: null }; });
afterEach(() => vi.useRealTimers());

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}{location.search}</output>;
}

function renderPage(initialEntry = '/notifications') {
  return render(<MemoryRouter initialEntries={[initialEntry]}><NotificationsPage /><CurrentLocation /></MemoryRouter>);
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

test('reserves one accessible notification loading area and reveals rows at 150 ms', async () => {
  vi.useFakeTimers();
  mocks.load = { loading: true, loadingMore: false, hasLoaded: false, error: null };
  renderPage();

  const status = document.querySelector<HTMLElement>('#main-content [role="status"]')!;
  const skeleton = status.querySelector('.content-skeleton');
  expect(status).toHaveAttribute('aria-busy', 'true');
  expect(skeleton).toBeInTheDocument();
  expect(status).not.toHaveClass('async-state--skeleton-visible');

  await act(async () => { await vi.advanceTimersByTimeAsync(149); });
  expect(status).not.toHaveClass('async-state--skeleton-visible');
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(status).toHaveClass('async-state--skeleton-visible');
  expect(document.querySelectorAll('#main-content [role="status"]')).toHaveLength(1);
});

test('keeps notification rows and announces load-more in its existing footer slot', () => {
  mocks.load = { loading: true, loadingMore: true, hasLoaded: true, error: null };
  renderPage();

  expect(screen.getByRole('link', { name: /Alice/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Loading more notifications' })).toBeDisabled();
  expect(document.querySelectorAll('#main-content [role="status"]')).toHaveLength(1);
  expect(document.querySelector('#main-content [role="status"]')).toHaveTextContent('Loading more notifications');
});

test('retries a failed notification load-more instead of refreshing the first page', async () => {
  mocks.load = { loading: false, loadingMore: false, hasLoaded: true, error: 'Unable to load more notifications.' };
  renderPage();

  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByRole('main')).toHaveFocus();
  expect(mocks.loadMore).toHaveBeenCalledOnce();
  expect(mocks.reconcile).not.toHaveBeenCalled();
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

test('keeps the unread filter in the route context so returning restores the selected list', async () => {
  const user = userEvent.setup();
  renderPage();

  await user.click(screen.getByRole('tab', { name: 'Unread' }));

  expect(screen.getByTestId('current-location')).toHaveTextContent('/notifications?filter=unread');
  expect(screen.getByRole('tab', { name: 'Unread' })).toHaveAttribute('aria-selected', 'true');
});
