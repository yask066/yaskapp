import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { usePollMutations } from './usePollMutations';
import { listPolls } from '../../api/polls';
import type { Poll } from '../../api/models';
import { t02RacePoll, t02ResponseGate, t02MotionScrollRace } from '../../test-utils/t02-motion-scroll-fixture';

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
  queryClient.setQueryData(['user-polls', 'author-1'], [poll]);
  queryClient.setQueryData(['poll', 'poll-1'], poll);
  const user = userEvent.setup();

  render(<QueryClientProvider client={queryClient}><VoteButton /></QueryClientProvider>);
  await user.click(screen.getByRole('button', { name: 'Vote' }));

  await waitFor(() => expect(queryClient.getQueryData<typeof poll[]>(['polls', 'newest'])?.[0]?.votesCount).toBe(4));
  expect(queryClient.getQueryData<typeof poll[]>(['polls', 'popular'])?.[0]).toEqual(votedPoll);
  expect(queryClient.getQueryData<typeof poll[]>(['user-polls', 'author-1'])?.[0]).toEqual(votedPoll);
  expect(queryClient.getQueryData(['poll', 'poll-1'])).toEqual(votedPoll);
});

function RaceButtons() {
  const { vote, toggleLike } = usePollMutations();
  return <>
    <button onClick={() => vote({ pollId: t02MotionScrollRace.pollId, optionId: t02MotionScrollRace.optionId })}>Race vote</button>
    <button onClick={() => toggleLike({ pollId: t02MotionScrollRace.pollId, viewerHasLiked: false })}>Race like</button>
  </>;
}

// M02 inputs for M05: strict desired outcomes, never assertions of the old bug.
// Set M02_RUN_KNOWN_FAILURES=1 to see the raw failures; remove this modifier in M05.
const m05Regression = process.env.M02_RUN_KNOWN_FAILURES === '1' ? test : test.fails;
for (const reverse of [false, true]) {
  m05Regression(`M05 race_preserves_independent_fields${reverse ? '_reverse' : ''}`, async () => {
    const voteGate = t02ResponseGate<Poll>();
    const likeGate = t02ResponseGate<Poll>();
    const order: string[] = [];
    server.use(
      http.post(`/polls/${t02MotionScrollRace.pollId}/votes`, async () => {
        order.push('vote-start');
        const poll = await voteGate.response;
        order.push('vote-finish');
        return HttpResponse.json({ poll }, { status: 201 });
      }),
      http.post(`/polls/${t02MotionScrollRace.pollId}/likes`, async () => {
        order.push('like-start');
        const poll = await likeGate.response;
        order.push('like-finish');
        return HttpResponse.json({ poll }, { status: 201 });
      }),
    );
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const keys = [['polls', 'newest'], ['polls', 'popular'], ['user-polls', 't02-author'], ['poll', t02MotionScrollRace.pollId]];
    keys.forEach((key) => client.setQueryData(key, key[0] === 'poll' ? t02RacePoll() : [t02RacePoll()]));
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><RaceButtons /></QueryClientProvider>);
    try {
      await user.click(screen.getByRole('button', { name: reverse ? 'Race like' : 'Race vote' }));
      await waitFor(() => expect(order).toHaveLength(1));
      await user.click(screen.getByRole('button', { name: reverse ? 'Race vote' : 'Race like' }));
      await waitFor(() => expect(order).toHaveLength(2));
      (reverse ? voteGate : likeGate).release(t02RacePoll(reverse ? 'vote' : 'like'));
      await waitFor(() => expect(client.isMutating()).toBe(1));
      (reverse ? likeGate : voteGate).release(t02RacePoll(reverse ? 'like' : 'vote'));
      await waitFor(() => expect(client.isMutating()).toBe(0));
      expect(order).toEqual(t02MotionScrollRace.orders[reverse ? 'race_preserves_independent_fields_reverse' : 'race_preserves_independent_fields']);
      for (const key of keys) {
        const data = client.getQueryData<Poll | Poll[]>(key)!;
        expect(reactionFields(Array.isArray(data) ? data[0] : data)).toEqual(t02MotionScrollRace.expected);
      }
    } finally {
      voteGate.release(t02RacePoll('vote'));
      likeGate.release(t02RacePoll('like'));
      client.clear();
    }
  });
}

m05Regression('M05 stale_refetch preserves completed vote and like', async () => {
  const refetchGate = t02ResponseGate<Poll[]>();
  const started = t02ResponseGate<void>();
  server.use(
    http.get('/polls', async () => { started.release(); return HttpResponse.json({ items: await refetchGate.response }); }),
    http.post(`/polls/${t02MotionScrollRace.pollId}/votes`, () => HttpResponse.json({ poll: t02RacePoll('vote') }, { status: 201 })),
    http.post(`/polls/${t02MotionScrollRace.pollId}/likes`, () => HttpResponse.json({ poll: { ...t02RacePoll('vote'), ...t02MotionScrollRace.snapshots.like } }, { status: 201 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const key = ['polls', 'newest'];
  client.setQueryData(key, [t02RacePoll()]);
  const refetch = client.fetchQuery({ queryKey: key, queryFn: () => listPolls({ sort: 'newest' }) });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><RaceButtons /></QueryClientProvider>);
  try {
    await started.response;
    await user.click(screen.getByRole('button', { name: 'Race vote' }));
    await waitFor(() => expect(client.getQueryData<Poll[]>(key)![0].votesCount).toBe(10));
    await user.click(screen.getByRole('button', { name: 'Race like' }));
    await waitFor(() => expect(client.getQueryData<Poll[]>(key)![0].viewerHasLiked).toBe(true));
    refetchGate.release([t02RacePoll()]);
    await refetch;
    expect(reactionFields(client.getQueryData<Poll[]>(key)![0])).toEqual(t02MotionScrollRace.expected);
  } finally {
    refetchGate.release([t02RacePoll()]);
    await refetch;
    client.clear();
  }
});

function reactionFields(poll: Poll) {
  return { votesCount: poll.votesCount, optionVotes: poll.options.map((option) => option.votesCount), viewerVoteOptionId: poll.viewerVoteOptionId, likesCount: poll.likesCount, viewerHasLiked: poll.viewerHasLiked };
}
