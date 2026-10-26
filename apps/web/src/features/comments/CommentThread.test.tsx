import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import type { PollComment } from '../../api/models';
import { CommentThread } from './CommentThread';

const author = { id: 'author-1', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null };
const root: PollComment = {
  id: 'root-1', pollId: 'poll-1', author, body: 'Root comment.', likesCount: 0, viewerHasLiked: false,
  parentCommentId: null, repliesCount: 3, createdAt: '2026-09-06T12:00:00.000Z', updatedAt: '2026-09-06T12:00:00.000Z',
};
const replyOne: PollComment = {
  id: 'reply-1', pollId: 'poll-1', author, body: 'First reply.', likesCount: 0, viewerHasLiked: false,
  parentCommentId: 'root-1', repliesCount: 0, createdAt: '2026-09-06T12:01:00.000Z', updatedAt: '2026-09-06T12:01:00.000Z',
};
const replyTwo: PollComment = { ...replyOne, id: 'reply-2', body: 'Second reply.' };
const poll = {
  id: 'poll-1', author, question: 'Question?', imageUrl: null, options: [], votesCount: 0,
  commentsCount: 5, likesCount: 0, viewerHasLiked: false, allowVoteCancellation: true,
  createdAt: '2026-09-06T12:00:00.000Z', viewerVoteOptionId: null, endsAt: null,
};
const server = setupServer();

function renderThread(input: { rootComment?: PollComment; currentUserId?: string | null; onReplyCreated?: ReturnType<typeof vi.fn> } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <main id="main-content"><CommentThread
        pollId="poll-1"
        rootComment={input.rootComment ?? root}
        currentUserId={input.currentUserId === undefined ? 'user-1' : input.currentUserId}
        onReplyCreated={input.onReplyCreated}
      /></main>
    </QueryClientProvider>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('shows the reply count, retries a failed page, loads more, and collapses the thread', async () => {
  let firstPageAttempts = 0;
  server.use(http.get('/polls/poll-1/comments/root-1/replies', ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    if (cursor) return HttpResponse.json({ items: [replyTwo], nextCursor: null });
    firstPageAttempts += 1;
    if (firstPageAttempts === 1) return HttpResponse.json({ error: 'temporary failure' }, { status: 503 });
    return HttpResponse.json({ items: [replyOne], nextCursor: 'cursor-2' });
  }));
  const user = userEvent.setup();

  renderThread();

  await user.click(screen.getByRole('button', { name: 'Show replies (3)' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry loading replies' }));
  expect(screen.getByRole('main')).toHaveFocus();
  expect(await screen.findByText('First reply.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more replies' }));
  expect(await screen.findByText('Second reply.')).toBeInTheDocument();
  expect(screen.getByText("You've seen all replies.")).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Hide replies (3)' }));
  expect(screen.queryByText('First reply.')).not.toBeInTheDocument();
});

test('does not claim the end of a legacy replies response without cursor metadata', async () => {
  server.use(http.get('/polls/poll-1/comments/root-1/replies', () => HttpResponse.json({ items: [replyOne] })));
  const user = userEvent.setup();

  renderThread();

  await user.click(screen.getByRole('button', { name: 'Show replies (3)' }));
  expect(await screen.findByText('First reply.')).toBeInTheDocument();
  expect(screen.queryByText("You've seen all replies.")).not.toBeInTheDocument();
});

test('cancels a reply composer and submits a reply to the root comment', async () => {
  let posted = false;
  const newReply: PollComment = { ...replyOne, id: 'reply-3', body: 'A reply to the root.' };
  const updatedPoll = { ...poll, commentsCount: 6 };
  const onReplyCreated = vi.fn();
  server.use(
    http.get('/polls/poll-1/comments/root-1/replies', () =>
      HttpResponse.json({ items: posted ? [newReply] : [], nextCursor: null })),
    http.post('/polls/poll-1/comments', async ({ request }) => {
      expect(await request.json()).toEqual({ body: 'A reply to the root.', parentCommentId: 'root-1' });
      posted = true;
      return HttpResponse.json({ comment: newReply, poll: updatedPoll }, { status: 201 });
    }),
  );
  const user = userEvent.setup();

  renderThread({ rootComment: { ...root, repliesCount: 0 }, onReplyCreated });

  await user.click(screen.getByRole('button', { name: 'Reply to Author' }));
  await user.type(screen.getByLabelText('Write a reply'), 'discard this text');
  await user.click(screen.getByRole('button', { name: 'Cancel reply' }));
  expect(screen.queryByLabelText('Write a reply')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Reply to Author' }));
  await user.type(screen.getByLabelText('Write a reply'), 'A reply to the root.');
  await user.click(screen.getByRole('button', { name: 'Post reply' }));

  expect(await screen.findByText('A reply to the root.')).toBeInTheDocument();
  expect(onReplyCreated).toHaveBeenCalledWith(newReply, updatedPoll);
});

test('lets anonymous visitors read replies without showing reply controls', async () => {
  server.use(http.get('/polls/poll-1/comments/root-1/replies', () =>
    HttpResponse.json({ items: [replyOne], nextCursor: null })));
  const user = userEvent.setup();

  renderThread({ currentUserId: null });

  await user.click(screen.getByRole('button', { name: 'Show replies (3)' }));
  expect(await screen.findByText('First reply.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reply to Author' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Write a reply')).not.toBeInTheDocument();
});

test('keeps append errors and manual retries isolated to their own expanded reply branch', async () => {
  const rootA = { ...root, id: 'root-a', author: { ...author, displayName: 'Author A' }, repliesCount: 2 };
  const rootB = { ...root, id: 'root-b', author: { ...author, displayName: 'Author B' }, repliesCount: 2 };
  const replyA1 = { ...replyOne, id: 'reply-a1', parentCommentId: 'root-a', body: 'First reply in A.' };
  const replyA2 = { ...replyOne, id: 'reply-a2', parentCommentId: 'root-a', body: 'Second reply in A.' };
  const replyB1 = { ...replyOne, id: 'reply-b1', parentCommentId: 'root-b', body: 'First reply in B.' };
  const replyB2 = { ...replyOne, id: 'reply-b2', parentCommentId: 'root-b', body: 'Second reply in B.' };
  let branchAAppendAttempts = 0;
  server.use(
    http.get('/polls/poll-1/comments/root-a/replies', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (!cursor) return HttpResponse.json({ items: [replyA1], nextCursor: 'a-next' });
      branchAAppendAttempts += 1;
      return branchAAppendAttempts === 1
        ? HttpResponse.json({ error: 'unavailable', message: 'Branch A append failed.' }, { status: 503 })
        : HttpResponse.json({ items: [replyA2], nextCursor: null });
    }),
    http.get('/polls/poll-1/comments/root-b/replies', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      return cursor
        ? HttpResponse.json({ items: [replyB2], nextCursor: null })
        : HttpResponse.json({ items: [replyB1], nextCursor: 'b-next' });
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <main id="main-content">
        <CommentThread pollId="poll-1" rootComment={rootA} currentUserId={null} />
        <CommentThread pollId="poll-1" rootComment={rootB} currentUserId={null} />
      </main>
    </QueryClientProvider>,
  );
  const branchA = within(screen.getByRole('region', { name: 'Replies to Author A' }));
  const branchB = within(screen.getByRole('region', { name: 'Replies to Author B' }));

  await user.click(branchA.getByRole('button', { name: 'Show replies (2)' }));
  await user.click(branchB.getByRole('button', { name: 'Show replies (2)' }));
  expect(await branchA.findByText('First reply in A.')).toBeInTheDocument();
  expect(await branchB.findByText('First reply in B.')).toBeInTheDocument();

  await user.click(branchA.getByRole('button', { name: 'Load more replies' }));
  expect(await branchA.findByRole('alert')).toHaveTextContent('Branch A append failed.');
  expect(branchA.getByRole('button', { name: 'Retry loading more replies' })).toBeInTheDocument();
  await user.click(branchB.getByRole('button', { name: 'Load more replies' }));
  expect(await branchB.findByText('Second reply in B.')).toBeInTheDocument();

  await user.click(branchA.getByRole('button', { name: 'Retry loading more replies' }));
  expect(await branchA.findByText('Second reply in A.')).toBeInTheDocument();
  expect(branchB.getByText('Second reply in B.')).toBeInTheDocument();
  expect(branchAAppendAttempts).toBe(2);
});
