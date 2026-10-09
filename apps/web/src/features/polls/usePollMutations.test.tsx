import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { MotionSettingsProvider } from '../../core/motion/motion-settings';
import { PollCard } from '../../components/PollCard';
import { usePollMutations } from './usePollMutations';
import { listPolls } from '../../api/polls';
import type { Poll } from '../../api/models';
import { t02RacePoll, t02ResponseGate, t02MotionScrollRace } from '../../test-utils/t02-motion-scroll-fixture';
import { fetchPollQuery } from './poll-state';

const poll = {
  stateRevisions: { votes: '0', likes: '0', comments: '0' },
  id: 'poll-1', author: { id: 'author-1', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null },
  question: 'Which option?', imageUrl: null,
  options: [{ id: 'option-1', text: 'First', position: 0, votesCount: 3 }, { id: 'option-2', text: 'Second', position: 1, votesCount: 0 }],
  votesCount: 3, commentsCount: 0, likesCount: 2, viewerHasLiked: false, allowVoteCancellation: true,
  createdAt: '2026-09-06T12:00:00.000Z', viewerVoteOptionId: null, endsAt: null,
};

const votedPoll = { ...poll, stateRevisions: { ...poll.stateRevisions, votes: '1' }, options: [{ ...poll.options[0], votesCount: 4 }, poll.options[1]], votesCount: 4, viewerVoteOptionId: 'option-1' };
const server = setupServer();

function VoteButton() {
  const { vote } = usePollMutations();
  return <button type="button" onClick={() => vote({ pollId: 'poll-1', optionId: 'option-1' })}>Vote</button>;
}

function RefusalButtons() {
  const mutations = usePollMutations();
  return <>
    <button onClick={() => mutations.vote({ pollId: 'poll-1', optionId: 'option-1' })}>Closed vote</button>
    <button onClick={() => mutations.vote({ pollId: 'poll-1', optionId: 'invalid-option' })}>Invalid option</button>
    <button onClick={() => mutations.deletePoll('poll-1')}>Delete</button>
    <output>{mutations.error}</output>
    <output>{mutations.isVoting('poll-1') ? 'Vote pending' : 'Vote idle'}</output>
  </>;
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
  expect(queryClient.getQueryData<typeof poll[]>(['polls', 'popular'])?.[0]).toMatchObject(votedPoll);
  expect(queryClient.getQueryData<typeof poll[]>(['user-polls', 'author-1'])?.[0]).toMatchObject(votedPoll);
  expect(queryClient.getQueryData(['poll', 'poll-1'])).toMatchObject(votedPoll);
});

test('keeps confirmed poll state and releases pending after closed-poll and invalid-option refusals', async () => {
  server.use(http.post('/polls/poll-1/votes', async ({ request }) => {
    const body = await request.json() as { optionId: string };
    return body.optionId === 'invalid-option'
      ? HttpResponse.json({ error: 'invalid_option', message: 'Choose a valid poll option.' }, { status: 400 })
      : HttpResponse.json({ error: 'poll_closed', message: 'This poll is closed.' }, { status: 409 });
  }));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(['polls', 'newest'], [poll]);
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><RefusalButtons /></QueryClientProvider>);

  await user.click(screen.getByRole('button', { name: 'Closed vote' }));
  expect(await screen.findByText('This poll is closed. Voting changes are no longer available.')).toBeInTheDocument();
  expect(await screen.findByText('Vote idle')).toBeInTheDocument();
  expect(client.getQueryData<typeof poll[]>(['polls', 'newest'])?.[0]).toMatchObject(poll);

  await user.click(screen.getByRole('button', { name: 'Invalid option' }));
  expect(await screen.findByText('Choose a valid poll option.')).toBeInTheDocument();
  expect(await screen.findByText('Vote idle')).toBeInTheDocument();
  expect(client.getQueryData<typeof poll[]>(['polls', 'newest'])?.[0]).toMatchObject(poll);
  client.clear();
});

test('reconciles an ambiguous vote failure with HTTP and releases pending without retrying the write', async () => {
  let writes = 0; let reads = 0;
  server.use(
    http.post('/polls/poll-1/votes', () => {
      writes += 1;
      return HttpResponse.json({ error: 'server_error' }, { status: 500 });
    }),
    http.get('/polls/poll-1', () => { reads += 1; return HttpResponse.json({ poll: votedPoll }); }),
  );
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(['polls'], [poll]);
  render(<QueryClientProvider client={client}><RefusalButtons /></QueryClientProvider>);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Closed vote' }));
  await waitFor(() => expect(client.getQueryData<Poll[]>(['polls'])?.[0].votesCount).toBe(4));
  expect(screen.getByText('Vote idle')).toBeInTheDocument();
  expect(writes).toBe(1); expect(reads).toBe(1);
  client.clear();
});

test('confirms an ambiguous delete failure by HTTP without repeating the delete', async () => {
  let writes = 0; let reads = 0;
  server.use(
    http.delete('/polls/poll-1', () => { writes += 1; return HttpResponse.json({ error: 'server_error' }, { status: 500 }); }),
    http.get('/polls/poll-1', () => { reads += 1; return HttpResponse.json({ error: 'not_found' }, { status: 404 }); }),
  );
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(['polls'], [poll]);
  render(<QueryClientProvider client={client}><RefusalButtons /></QueryClientProvider>);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(client.getQueryData(['polls'])).toEqual([]));
  expect(writes).toBe(1); expect(reads).toBe(1);
  client.clear();
});

function RaceButtons() {
  const { vote, toggleLike } = usePollMutations();
  return <>
    <button onClick={() => vote({ pollId: t02MotionScrollRace.pollId, optionId: t02MotionScrollRace.optionId })}>Race vote</button>
    <button onClick={() => toggleLike({ pollId: t02MotionScrollRace.pollId, viewerHasLiked: false })}>Race like</button>
  </>;
}

function PendingButtons() {
  const mutations = usePollMutations();
  return <>
    <button onClick={() => mutations.vote({ pollId: 'poll-a', optionId: 'a' })}>Vote A</button>
    <button onClick={() => mutations.toggleLike({ pollId: 'poll-a', viewerHasLiked: false })}>Like A</button>
    <button onClick={() => mutations.vote({ pollId: 'poll-b', optionId: 'b' })}>Vote B</button>
    <output>{mutations.isVoting('poll-a') ? 'A vote pending' : 'A vote ready'}</output>
    <output>{mutations.isLiking('poll-a') ? 'A like pending' : 'A like ready'}</output>
    <output>{mutations.isVoting('poll-b') ? 'B pending' : 'B ready'}</output>
  </>;
}

function ReactionPollCard() {
  const mutations = usePollMutations();
  const query = useQuery<Poll[]>({ queryKey: ['polls', 'newest'], queryFn: async () => [poll], staleTime: Infinity });
  const currentPoll = query.data?.[0];
  if (!currentPoll) return null;
  return <PollCard poll={currentPoll} viewerId="viewer-1" onLike={(pollId, viewerHasLiked) => mutations.toggleLike({ pollId, viewerHasLiked })} isLiking={mutations.isLiking(currentPoll.id)} />;
}

test('animating a local like preserves the single mutation request and announces only pending state', async () => {
  let writes = 0;
  const result = { ...poll, stateRevisions: { ...poll.stateRevisions, likes: '1' }, likesCount: 3, viewerHasLiked: true };
  server.use(http.post('/polls/poll-1/likes', () => {
    writes += 1;
    return HttpResponse.json({ poll: result }, { status: 201 });
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['polls', 'newest'], [poll]);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MotionSettingsProvider flags={{ reactionsMotion: true, entryMotion: false }}>
          <ReactionPollCard />
        </MotionSettingsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole('button', { name: 'Like (2)' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Like (3)' })).toHaveAttribute('aria-pressed', 'true'));

  expect(writes).toBe(1);
  expect(client.getQueryData<Poll[]>(['polls', 'newest'])?.[0]).toMatchObject({ likesCount: 3, viewerHasLiked: true });
  expect(screen.queryAllByRole('status')).toHaveLength(0);
  client.clear();
});

test('deduplicates repeated taps per poll while another poll can start in parallel', async () => {
  const gates = { aVote: t02ResponseGate<Poll>(), aLike: t02ResponseGate<Poll>(), bVote: t02ResponseGate<Poll>() };
  const requests = { aVote: 0, aLike: 0, bVote: 0 };
  server.use(
    http.post('/polls/poll-a/votes', async () => { requests.aVote += 1; return HttpResponse.json({ poll: await gates.aVote.response }); }),
    http.post('/polls/poll-a/likes', async () => { requests.aLike += 1; return HttpResponse.json({ poll: await gates.aLike.response }); }),
    http.post('/polls/poll-b/votes', async () => { requests.bVote += 1; return HttpResponse.json({ poll: await gates.bVote.response }); }),
  );
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><PendingButtons /></QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Vote A' }));
  await waitFor(() => expect(requests.aVote).toBe(1));
  for (let tap = 0; tap < 9; tap += 1) await user.click(screen.getByRole('button', { name: 'Vote A' }));
  await user.click(screen.getByRole('button', { name: 'Like A' }));
  await waitFor(() => expect(requests.aLike).toBe(1));
  for (let tap = 0; tap < 9; tap += 1) await user.click(screen.getByRole('button', { name: 'Like A' }));
  await user.click(screen.getByRole('button', { name: 'Vote B' }));
  await waitFor(() => expect(requests.bVote).toBe(1));
  expect(requests).toEqual({ aVote: 1, aLike: 1, bVote: 1 });
  expect(screen.getByText('A vote pending')).toBeInTheDocument();
  expect(screen.getByText('A like pending')).toBeInTheDocument();
  expect(screen.getByText('B pending')).toBeInTheDocument();
  gates.aVote.release({ ...racePoll('vote'), id: 'poll-a' });
  gates.aLike.release({ ...racePoll('like'), id: 'poll-a' });
  gates.bVote.release({ ...racePoll('vote'), id: 'poll-b' });
  await waitFor(() => expect(screen.getByText('A vote ready')).toBeInTheDocument());
  expect(screen.getByText('A like ready')).toBeInTheDocument();
  expect(screen.getByText('B ready')).toBeInTheDocument();
  client.clear();
});

// Apply the M03 revisions to the unchanged M02 adversarial snapshots.
function racePoll(kind?: 'vote' | 'like'): Poll {
  return { ...t02RacePoll(kind), stateRevisions: { votes: kind === 'vote' ? '1' : '0', likes: kind === 'like' ? '1' : '0', comments: '0' } };
}
const m05Regression = test;
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
    keys.forEach((key) => client.setQueryData(key, key[0] === 'poll' ? racePoll() : [racePoll()]));
    const user = userEvent.setup();
    render(<QueryClientProvider client={client}><RaceButtons /></QueryClientProvider>);
    try {
      await user.click(screen.getByRole('button', { name: reverse ? 'Race like' : 'Race vote' }));
      await waitFor(() => expect(order).toHaveLength(1));
      await user.click(screen.getByRole('button', { name: reverse ? 'Race vote' : 'Race like' }));
      await waitFor(() => expect(order).toHaveLength(2));
      (reverse ? voteGate : likeGate).release(racePoll(reverse ? 'vote' : 'like'));
      await waitFor(() => expect(client.isMutating()).toBe(1));
      (reverse ? likeGate : voteGate).release(racePoll(reverse ? 'like' : 'vote'));
      await waitFor(() => expect(client.isMutating()).toBe(0));
      expect(order).toEqual(t02MotionScrollRace.orders[reverse ? 'race_preserves_independent_fields_reverse' : 'race_preserves_independent_fields']);
      for (const key of keys) {
        const data = client.getQueryData<Poll | Poll[]>(key)!;
        expect(reactionFields(Array.isArray(data) ? data[0] : data)).toEqual(t02MotionScrollRace.expected);
      }
    } finally {
      voteGate.release(racePoll('vote'));
      likeGate.release(racePoll('like'));
      client.clear();
    }
  });
}

m05Regression('M05 stale_refetch preserves completed vote and like', async () => {
  const refetchGate = t02ResponseGate<Poll[]>();
  const started = t02ResponseGate<void>();
  server.use(
    http.get('/polls', async () => { started.release(); return HttpResponse.json({ items: await refetchGate.response }); }),
    http.post(`/polls/${t02MotionScrollRace.pollId}/votes`, () => HttpResponse.json({ poll: racePoll('vote') }, { status: 201 })),
    http.post(`/polls/${t02MotionScrollRace.pollId}/likes`, () => HttpResponse.json({ poll: { ...racePoll('vote'), ...t02MotionScrollRace.snapshots.like, stateRevisions: { votes: '1', likes: '1', comments: '0' } } }, { status: 201 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const key = ['polls', 'newest'];
  client.setQueryData(key, [racePoll()]);
  const refetch = client.fetchQuery({ queryKey: key, queryFn: () => fetchPollQuery(client, 'viewer-1', () => listPolls({ sort: 'newest' })) });
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><RaceButtons /></QueryClientProvider>);
  try {
    await started.response;
    await user.click(screen.getByRole('button', { name: 'Race vote' }));
    await waitFor(() => expect(client.getQueryData<Poll[]>(key)![0].votesCount).toBe(10));
    await user.click(screen.getByRole('button', { name: 'Race like' }));
    await waitFor(() => expect(client.getQueryData<Poll[]>(key)![0].viewerHasLiked).toBe(true));
    refetchGate.release([racePoll()]);
    await refetch;
    expect(reactionFields(client.getQueryData<Poll[]>(key)![0])).toEqual(t02MotionScrollRace.expected);
  } finally {
    refetchGate.release([racePoll()]);
    await refetch;
    client.clear();
  }
});

function reactionFields(poll: Poll) {
  return { votesCount: poll.votesCount, optionVotes: poll.options.map((option) => option.votesCount), viewerVoteOptionId: poll.viewerVoteOptionId, likesCount: poll.likesCount, viewerHasLiked: poll.viewerHasLiked };
}
