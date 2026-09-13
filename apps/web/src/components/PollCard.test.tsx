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

test('votes immediately when an available option is clicked', async () => {
  const onVote = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<PollCard poll={poll} viewerId="user-1" onVote={onVote} />);

  await user.click(screen.getByText('First'));

  expect(onVote).toHaveBeenCalledWith('poll-1', 'option-1');
});

test('does not render a separate vote button', () => {
  renderWithProviders(<PollCard poll={poll} viewerId="user-1" onVote={vi.fn()} />);

  expect(screen.queryByRole('button', { name: 'Vote for First' })).not.toBeInTheDocument();
});

test('shows result percentages before the viewer has voted', () => {
  renderWithProviders(<PollCard poll={poll} viewerId="user-1" onVote={vi.fn()} />);

  expect(screen.getByText('75%')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'First' })).toHaveAttribute('aria-valuenow', '75');
});

test('does not submit another vote after the viewer has voted', async () => {
  const onVote = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<PollCard poll={{ ...poll, viewerVoteOptionId: 'option-1' }} viewerId="user-1" onVote={onVote} />);

  await user.click(screen.getByText('Second'));

  expect(onVote).not.toHaveBeenCalled();
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

test('separates option labels from vote counts and marks the selected option', () => {
  renderWithProviders(<PollCard poll={{ ...poll, viewerVoteOptionId: 'option-1' }} viewerId="user-1" />);

  expect(screen.getByText('First')).toHaveClass('poll-option-label');
  expect(screen.getByText('3 votes')).toHaveClass('poll-option-votes');
  expect(screen.getByText('First').closest('.poll-option')).toHaveClass('is-selected');
  expect(screen.getByText('Second').closest('.poll-option')).not.toHaveClass('is-selected');
});

test('places the author delete action inside the overflow menu', async () => {
  const user = userEvent.setup();
  renderWithProviders(
    <PollCard poll={poll} viewerId="author-1" onDelete={vi.fn()} />,
  );

  expect(screen.getByRole('time')).toHaveClass('poll-card-time');
  expect(screen.queryByRole('menuitem', { name: 'Delete poll' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'More poll actions' }));

  expect(screen.getByRole('menuitem', { name: 'Delete poll' })).toHaveClass('poll-delete-action');
});

test('places vote cancellation inside the overflow menu', async () => {
  const onCancelVote = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(
    <PollCard poll={{ ...poll, viewerVoteOptionId: 'option-1' }} viewerId="user-1" onCancelVote={onCancelVote} />,
  );

  expect(screen.queryByRole('button', { name: 'Cancel vote' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'More poll actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Cancel vote' }));

  expect(onCancelVote).toHaveBeenCalledWith('poll-1');
  expect(screen.queryByRole('menuitem', { name: 'Cancel vote' })).not.toBeInTheDocument();
});

test('uses the current mobile Material icons for poll actions', () => {
  renderWithProviders(<PollCard poll={poll} viewerId="user-1" onLike={vi.fn()} onOpenComments={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'Like (2)' }).querySelector('[data-icon="favorite_border"]')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Comments (0)' }).querySelector('[data-icon="mode_comment_outlined"]')).toBeInTheDocument();
});

test('uses the selected mobile favorite icon for an already liked poll', () => {
  renderWithProviders(<PollCard poll={{ ...poll, viewerHasLiked: true }} viewerId="user-1" onLike={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'Like (2)' }).querySelector('[data-icon="favorite"]')).toBeInTheDocument();
});

test('renders the voted card with compact action counters', () => {
  renderWithProviders(
    <PollCard
      poll={{ ...poll, viewerVoteOptionId: 'option-1' }}
      viewerId="user-1"
      onLike={vi.fn()}
      onOpenComments={vi.fn()}
    />,
  );

  expect(screen.getByRole('button', { name: 'Like (2)' })).toHaveClass('poll-action-button');
  expect(screen.getByRole('button', { name: 'Like (2)' }).querySelector('.poll-action-count')).toHaveTextContent('2');
  expect(screen.getByRole('button', { name: 'Comments (0)' }).querySelector('.poll-action-count')).toHaveTextContent('0');
});

test('uses a drawn menu icon instead of a text glyph', () => {
  renderWithProviders(<PollCard poll={poll} viewerId="user-1" onLike={vi.fn()} onOpenComments={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'More poll actions' }).querySelector('[data-icon="more"]')).toBeInTheDocument();
});
