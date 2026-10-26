import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <main id="main-content"><CommentThread
        pollId="poll-1"
        rootComment={input.rootComment ?? root}
        currentUserId={input.currentUserId === undefined ? 'user-1' : input.currentUserId}
        onReplyCreated={input.onReplyCreated}
      /></main>
    </QueryClientProvider>,
  ) };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });
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

test('keeps a new reply in a separate gap overlay until the server cursor reaches it', async () => {
  const member = { ...author, id: 'user-1', username: 'member', displayName: 'Member' };
  const ownReply: PollComment = { ...replyTwo, id: 'reply-new', author: member, body: 'My newest reply.' };
  const interveningReply: PollComment = { ...replyOne, id: 'reply-middle', body: 'An intervening reply.' };
  const user = userEvent.setup();
  server.use(
    http.get('/polls/poll-1/comments/root-1/replies', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      return cursor
        ? HttpResponse.json({ items: [interveningReply, ownReply], nextCursor: null })
        : HttpResponse.json({ items: [replyOne], nextCursor: 'cursor-2' });
    }),
    http.post('/polls/poll-1/comments', async ({ request }) => {
      expect(await request.json()).toEqual({ body: 'My newest reply.', parentCommentId: 'root-1' });
      return HttpResponse.json({ comment: ownReply, poll: { ...poll, commentsCount: 6 } }, { status: 201 });
    }),
  );
  const { queryClient } = renderThread();

  await user.click(screen.getByRole('button', { name: 'Show replies (3)' }));
  expect(await screen.findByText('First reply.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reply to Author' }));
  await user.type(screen.getByLabelText('Write a reply'), 'My newest reply.');
  await user.click(screen.getByRole('button', { name: 'Post reply' }));

  expect(await screen.findByText('My newest reply.')).toBeInTheDocument();
  expect(screen.getByText('Your reply')).toBeInTheDocument();
  expect(screen.getByText('Replies between these sections are not loaded yet.')).toBeInTheDocument();
  const replyQuery = queryClient.getQueryCache().findAll().find((query) =>
    query.queryKey[0] === 'pagination' && query.queryKey[1] === 'replies' &&
    Boolean(query.state.data && typeof query.state.data === 'object' && 'pages' in query.state.data),
  )!;
  const beforeAppend = queryClient.getQueryData<{ pages: Array<{ items: PollComment[]; nextCursor: string | null }>; pageParams: unknown[] }>(replyQuery.queryKey)!;
  expect(beforeAppend.pages).toHaveLength(1);
  expect(beforeAppend.pages[0]?.items.map((item) => item.id)).toEqual(['reply-1']);
  expect(beforeAppend.pages[0]?.nextCursor).toBe('cursor-2');
  expect(beforeAppend.pageParams).toEqual([undefined]);

  await user.click(screen.getByRole('button', { name: 'Load more replies' }));
  expect(await screen.findByText('An intervening reply.')).toBeInTheDocument();
  expect(screen.getAllByText('My newest reply.')).toHaveLength(1);
  expect(screen.queryByText('Your reply')).not.toBeInTheDocument();
  expect(screen.queryByText('Replies between these sections are not loaded yet.')).not.toBeInTheDocument();
  const afterAppend = queryClient.getQueryData<typeof beforeAppend>(replyQuery.queryKey)!;
  expect(afterAppend.pages.map((page) => page.items.map((item) => item.id))).toEqual([['reply-1'], ['reply-middle', 'reply-new']]);
  expect(afterAppend.pageParams).toEqual([undefined, 'cursor-2']);
});

test('allows reacting to and deleting a reply on a later server page', async () => {
  const likedReply = { ...replyTwo, likesCount: 1, viewerHasLiked: true };
  let deleted = false;
  server.use(
    http.get('/polls/poll-1/comments/root-1/replies', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      return cursor
        ? HttpResponse.json({ items: [replyTwo], nextCursor: null })
        : HttpResponse.json({ items: [replyOne], nextCursor: 'cursor-2' });
    }),
    http.post('/polls/poll-1/comments/reply-2/likes', () => HttpResponse.json({ comment: likedReply }, { status: 201 })),
    http.delete('/polls/poll-1/comments/reply-2', () => { deleted = true; return new HttpResponse(null, { status: 204 }); }),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll: { ...poll, commentsCount: 4 } })),
  );
  const user = userEvent.setup();
  const { queryClient } = renderThread({ currentUserId: 'author-1' });

  await user.click(screen.getByRole('button', { name: 'Show replies (3)' }));
  expect(await screen.findByText('First reply.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more replies' }));
  expect(await screen.findByText('Second reply.')).toBeInTheDocument();
  const secondReply = screen.getByText('Second reply.').closest('li')!;
  await user.click(within(secondReply).getByRole('button', { name: 'Like (0)' }));
  expect(await within(secondReply).findByRole('button', { name: 'Like (1)' })).toHaveAttribute('aria-pressed', 'true');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await user.click(within(secondReply).getByRole('button', { name: 'Delete reply' }));

  await waitFor(() => expect(deleted).toBe(true));
  expect(screen.queryByText('Second reply.')).not.toBeInTheDocument();
  const replyQuery = queryClient.getQueryCache().findAll().find((query) =>
    query.queryKey[0] === 'pagination' && query.queryKey[1] === 'replies' &&
    Boolean(query.state.data && typeof query.state.data === 'object' && 'pages' in query.state.data),
  )!;
  const pages = queryClient.getQueryData<{ pages: Array<{ items: PollComment[]; nextCursor: string | null }>; pageParams: unknown[] }>(replyQuery.queryKey)!;
  expect(pages.pages.flatMap((page) => page.items.map((item) => item.id))).not.toContain('reply-2');
  expect(pages.pages[0]?.nextCursor).toBe('cursor-2');
  expect(pages.pageParams).toEqual([undefined, 'cursor-2']);
});

test('keeps a confirmed reply reaction when an older append commits its captured page chain', async () => {
  const likedReply = { ...replyOne, likesCount: 1, viewerHasLiked: true };
  let appendStarted = false;
  let releaseAppend: ((response: Response) => void) | undefined;
  server.use(
    http.get('/polls/poll-1/comments/root-1/replies', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (!cursor) return HttpResponse.json({ items: [replyOne], nextCursor: 'cursor-2' });
      appendStarted = true;
      return new Promise<Response>((resolve) => { releaseAppend = resolve; });
    }),
    http.post('/polls/poll-1/comments/reply-1/likes', () => HttpResponse.json({ comment: likedReply }, { status: 201 })),
  );
  const user = userEvent.setup();
  const { queryClient } = renderThread();

  await user.click(screen.getByRole('button', { name: 'Show replies (3)' }));
  await screen.findByText('First reply.');
  await user.click(screen.getByRole('button', { name: 'Load more replies' }));
  await waitFor(() => expect(appendStarted).toBe(true));
  const firstReply = screen.getByText('First reply.').closest('li')!;
  await user.click(within(firstReply).getByRole('button', { name: 'Like (0)' }));
  expect(await within(firstReply).findByRole('button', { name: 'Like (1)' })).toHaveAttribute('aria-pressed', 'true');

  await act(async () => {
    releaseAppend?.(HttpResponse.json({ items: [replyTwo], nextCursor: null }));
    await Promise.resolve();
  });
  expect(await screen.findByText('Second reply.')).toBeInTheDocument();
  await waitFor(() => {
    const query = queryClient.getQueryCache().findAll().find((item) =>
      item.queryKey[0] === 'pagination' && item.queryKey[1] === 'replies' &&
      Boolean(item.state.data && typeof item.state.data === 'object' && 'pages' in item.state.data),
    );
    expect(queryClient.getQueryData<{ pages: Array<{ items: PollComment[] }> }>(query?.queryKey ?? [])?.pages).toHaveLength(2);
  });
  expect(within(firstReply).getByRole('button', { name: 'Like (1)' })).toHaveAttribute('aria-pressed', 'true');
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
