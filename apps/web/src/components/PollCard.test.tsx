import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { renderWithProviders } from '../test/setup';
import { PollCard } from './PollCard';

const poll = {
  id: 'poll-1', author: { id: 'author-1', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null },
  question: 'Which option?', imageUrl: null,
  options: [{ id: 'option-1', text: 'First', position: 0, votesCount: 3 }, { id: 'option-2', text: 'Second', position: 1, votesCount: 1 }],
  votesCount: 4, commentsCount: 0, likesCount: 2, viewerHasLiked: false, allowVoteCancellation: true,
  createdAt: '2026-09-06T12:00:00.000Z', viewerVoteOptionId: null, endsAt: null,
};

test('submits the selected option from its own Vote button', async () => {
  const onVote = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<PollCard poll={poll} viewerId="user-1" onVote={onVote} />);

  await user.click(screen.getByRole('radio', { name: 'First (3)' }));
  await user.click(screen.getByRole('button', { name: 'Vote for First' }));

  expect(onVote).toHaveBeenCalledWith('poll-1', 'option-1');
});

test('marks the options container as width-constrained content', () => {
  renderWithProviders(<PollCard poll={poll} viewerId="user-1" />);

  expect(screen.getByRole('group', { name: 'Choose an option' })).toHaveClass('poll-options');
});

test('exposes result percentages as progress bars after voting', () => {
  renderWithProviders(<PollCard poll={{ ...poll, viewerVoteOptionId: 'option-1' }} viewerId="user-1" />);

  expect(screen.getByRole('progressbar', { name: 'First' })).toHaveAttribute('aria-valuenow', '75');
  expect(screen.getByRole('progressbar', { name: 'Second' })).toHaveAttribute('aria-valuenow', '25');
});
