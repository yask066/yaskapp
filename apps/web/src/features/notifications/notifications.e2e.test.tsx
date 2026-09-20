import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { NotificationItem } from '@yaskapp/shared';
import { NotificationCard } from './NotificationCard';
import { NotificationPreferencesPage } from './NotificationPreferencesPage';
import { commentScrollBehavior } from '../comments/comment-scroll';

const mocks = vi.hoisted(() => ({
  markRead: vi.fn().mockResolvedValue(undefined),
  getPreferences: vi.fn(),
  patchPreferences: vi.fn(),
}));

vi.mock('../../api/notifications', () => ({
  getNotificationPreferences: mocks.getPreferences,
  patchNotificationPreferences: mocks.patchPreferences,
}));

const base: NotificationItem = {
  id: 'n-1', type: 'poll_vote', actor: { id: 'u-1', username: 'alice', displayName: 'Alice', avatarUrl: null },
  targetType: 'poll', pollId: 'poll-1', commentId: null, payload: {}, readAt: null,
  createdAt: '2026-09-19T12:00:00.000Z', isTargetAvailable: true,
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPreferences.mockResolvedValue({
    poll_vote: { inApp: true, push: true }, comment: { inApp: false, push: true },
    comment_reply: { inApp: true, push: false }, like: { inApp: true, push: false }, follow: { inApp: false, push: true },
  });
  mocks.patchPreferences.mockResolvedValue({
    poll_vote: { inApp: false, push: true }, comment: { inApp: false, push: true },
    comment_reply: { inApp: true, push: false }, like: { inApp: true, push: false }, follow: { inApp: false, push: true },
  });
});

test.each([
  ['poll_vote', '/polls/poll-1'],
  ['comment', '/polls/poll-1?comment=comment-1'],
  ['comment_reply', '/polls/poll-1?comment=comment-1'],
  ['like-poll', '/polls/poll-1'],
  ['like-comment', '/polls/poll-1?comment=comment-1'],
  ['follow', '/users/u-1'],
] as const)('navigates %s notification and marks it read first', async (_name, expected) => {
  const user = userEvent.setup();
  const item = _name === 'follow'
    ? { ...base, type: 'follow' as const, targetType: 'profile' as const, pollId: null }
    : _name === 'comment' || _name === 'comment_reply' || _name === 'like-comment'
      ? { ...base, type: _name === 'comment_reply' ? 'comment_reply' as const : 'like' as const, targetType: 'comment' as const, commentId: 'comment-1' }
      : { ...base, type: _name === 'like-poll' ? 'like' as const : 'poll_vote' as const };
  render(<MemoryRouter><NotificationCard item={item} onRead={mocks.markRead} /><LocationProbe /></MemoryRouter>);
  await user.click(screen.getByRole('link'));
  expect(mocks.markRead).toHaveBeenCalledWith('n-1');
  expect(screen.getByTestId('location')).toHaveTextContent(expected);
});

test('unavailable target remains non-navigable and announces status', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><NotificationCard item={{ ...base, isTargetAvailable: false }} onRead={mocks.markRead} /><LocationProbe /></MemoryRouter>);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByText('This content is no longer available')).toHaveAttribute('role', 'status');
  await user.click(screen.getByRole('article'));
  expect(mocks.markRead).not.toHaveBeenCalled();
  expect(screen.getByTestId('location')).toHaveTextContent('/');
});

test('preferences page loads and patches only in-app switches', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><NotificationPreferencesPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Notification settings' })).toBeInTheDocument();
  expect(screen.getAllByRole('switch')).toHaveLength(5);
  await user.click(screen.getByRole('switch', { name: 'Poll votes' }));
  expect(mocks.patchPreferences).toHaveBeenCalledWith({ poll_vote: { inApp: false } });
  expect(screen.queryByText(/push/i)).not.toBeInTheDocument();
});

test('notification card exposes semantic unread state, full timestamp and keyboard activation', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><NotificationCard item={base} onRead={mocks.markRead} /></MemoryRouter>);
  const card = screen.getByRole('article');
  expect(card).toHaveAttribute('aria-label', expect.stringContaining('unread'));
  expect(screen.getByRole('time')).toHaveAttribute('title');
  screen.getByRole('link').focus();
  await user.keyboard('{Enter}');
  expect(mocks.markRead).toHaveBeenCalledWith('n-1');
});

test('comment deep links respect reduced motion preferences', () => {
  expect(commentScrollBehavior(true)).toBe('auto');
  expect(commentScrollBehavior(false)).toBe('smooth');
});
