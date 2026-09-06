import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { usePollMutations } from './usePollMutations';

const poll = {
  id: 'poll-1', author: { id: 'author-1', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null },
  question: 'Which option?', imageUrl: null,
  options: [{ id: 'option-1', text: 'First', position: 0, votesCount: 3 }, { id: 'option-2', text: 'Second', position: 1, votesCount: 0 }],
  votesCount: 3, commentsCount: 0, likesCount: 2, viewerHasLiked: false, allowVoteCancellation: true,
  createdAt: '2026-09-06T12:00:00.000Z', viewerVoteOptionId: null, endsAt: null,
};

const votedPoll = { ...poll, options: [{ ...poll.options[0], votesCount: 4 }, poll.options[1]], votesCount: 4, viewerVoteOptionId: 'option-1' };
const server = setupServer();

function VoteButton() {
  const { vote } = usePollMutations();
  return <button type="button" onClick={() => vote({ pollId: 'poll-1', optionId: 'option-1' })}>Vote</button>;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('replaces every cached poll with the authoritative poll returned after a vote', async () => {
  server.use(http.post('/polls/poll-1/votes', () => HttpResponse.json({ poll: votedPoll }, { status: 201 })));
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  queryClient.setQueryData(['polls', 'newest'], [poll]);
  queryClient.setQueryData(['polls', 'popular'], [poll]);
  queryClient.setQueryData(['poll', 'poll-1'], poll);
  const user = userEvent.setup();

  render(<QueryClientProvider client={queryClient}><VoteButton /></QueryClientProvider>);
  await user.click(screen.getByRole('button', { name: 'Vote' }));

  await waitFor(() => expect(queryClient.getQueryData<typeof poll[]>(['polls', 'newest'])?.[0]?.votesCount).toBe(4));
  expect(queryClient.getQueryData<typeof poll[]>(['polls', 'popular'])?.[0]).toEqual(votedPoll);
  expect(queryClient.getQueryData(['poll', 'poll-1'])).toEqual(votedPoll);
});
