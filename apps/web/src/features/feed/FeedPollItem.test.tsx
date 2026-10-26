import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { Poll } from '../../api/models';
import { MotionSettingsProvider } from '../../core/motion/motion-settings';
import { FeedPollItem, type FeedPollItemProps } from './FeedPollItem';

const { cardRender } = vi.hoisted(() => ({ cardRender: vi.fn() }));

vi.mock('../../components/PollCard', async () => {
  const React = await import('react');
  return {
    PollCard: React.forwardRef<HTMLElement, { poll: Poll }>(function MockPollCard({ poll }, ref) {
      cardRender();
      return React.createElement('article', { ref }, poll.question);
    }),
  };
});

afterEach(() => vi.clearAllMocks());

const motionFlags = { reactionsMotion: false, entryMotion: false };

const poll: Poll = {
  id: 'poll-existing',
  author: { id: 'author-1', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null },
  question: 'Existing poll',
  imageUrl: null,
  options: [{ id: 'option-1', text: 'First', position: 0, votesCount: 1 }],
  votesCount: 1,
  commentsCount: 0,
  likesCount: 0,
  viewerHasLiked: false,
  allowVoteCancellation: false,
  createdAt: '2026-09-06T12:00:00.000Z',
  viewerVoteOptionId: null,
  endsAt: null,
};

function page(props: FeedPollItemProps) {
  return <MemoryRouter><MotionSettingsProvider flags={motionFlags}>
    <FeedPollItem {...props} />
  </MotionSettingsProvider></MemoryRouter>;
}

it('skips rendering existing poll cards when the feed appends a page', () => {
  const onVote = vi.fn();
  const props: FeedPollItemProps = { poll, contextKey: 'feed:guest:newest', indexInBatch: 0, onVote };
  const { rerender } = render(page(props));
  expect(cardRender).toHaveBeenCalledTimes(1);

  rerender(page({ ...props }));

  expect(cardRender).toHaveBeenCalledTimes(1);

  act(() => rerender(page({ ...props, isVoting: true })));
  expect(cardRender).toHaveBeenCalledTimes(2);
});
