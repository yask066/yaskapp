import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SessionProvider } from '../../app/session-provider';
import { PollDetailPage } from './PollDetailPage';

const poll = {
  id: 'poll-1', author: { id: 'author-1', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null },
  question: 'Which option should we choose?', imageUrl: null,
  options: [{ id: 'option-1', text: 'First', position: 0, votesCount: 3 }, { id: 'option-2', text: 'Second', position: 1, votesCount: 1 }],
  votesCount: 4, commentsCount: 2, likesCount: 2, viewerHasLiked: false, allowVoteCancellation: true,
  createdAt: '2026-09-06T12:00:00.000Z', viewerVoteOptionId: null, endsAt: null,
};

const comments = [
  { id: 'comment-1', pollId: 'poll-1', author: poll.author, body: 'First existing comment.', likesCount: 0, viewerHasLiked: false, createdAt: '2026-09-06T12:01:00.000Z', updatedAt: '2026-09-06T12:01:00.000Z' },
  { id: 'comment-2', pollId: 'poll-1', author: { id: 'user-2', username: 'other', displayName: 'Other', avatarObjectKey: null, avatarUrl: null }, body: 'Second existing comment.', likesCount: 1, viewerHasLiked: true, createdAt: '2026-09-06T12:02:00.000Z', updatedAt: '2026-09-06T12:02:00.000Z' },
];

const currentUser = {
  id: 'user-1', email: 'member@example.com', username: 'member', status: 'active',
  profile: { displayName: 'Member', pollsCount: 0, followersCount: 0, followingCount: 0, countryCode: 'BY', bio: null, avatarObjectKey: null, avatarUrl: null },
};

const server = setupServer();
let originalScrollIntoViewDescriptor: PropertyDescriptor | undefined;

function renderDetail(
  initialEntry = '/polls/poll-1',
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
) {
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes><Route path="/polls/:pollId" element={<PollDetailPage />} /></Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  ) };
}

function DetailRouteHarness() {
  const navigate = useNavigate();
  return <>
    <button type="button" onClick={() => navigate('/away')}>Navigate away</button>
    <button type="button" onClick={() => navigate('/polls/poll-1?comment=reply-1')}>Return to notification</button>
    <Routes>
      <Route path="/polls/:pollId" element={<PollDetailPage />} />
      <Route path="/away" element={<p>Away from poll.</p>} />
    </Routes>
  </>;
}

function makeRootComment(index: number, repliesCount = 0) {
  const createdAt = new Date(Date.UTC(2026, 9, 19, 12, 0, index)).toISOString();
  return {
    id: `root-${index}`, pollId: 'poll-1', author: poll.author, body: `Root ${index}.`,
    likesCount: 0, viewerHasLiked: false, parentCommentId: null, repliesCount,
    createdAt, updatedAt: createdAt,
  };
}

function cachedRootCommentPages(queryClient: QueryClient) {
  const query = queryClient.getQueryCache().getAll().find(({ queryKey, state }) => {
    const data = state.data;
    return queryKey[0] === 'pagination' && queryKey[1] === 'comments' &&
      data !== null && typeof data === 'object' && 'pages' in data && 'pageParams' in data;
  });
  return query?.state.data as { pages: unknown[]; pageParams: unknown[] } | undefined;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  if (originalScrollIntoViewDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoViewDescriptor);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
  originalScrollIntoViewDescriptor = undefined;
  sessionStorage.clear();
});
afterAll(() => server.close());

test('shows a poll and comments, then adds the returned comment and authoritative count', async () => {
  const createdComment = { id: 'comment-3', pollId: 'poll-1', author: { id: 'user-1', username: 'member', displayName: 'Member', avatarObjectKey: null, avatarUrl: null }, body: 'A newly added comment.', likesCount: 0, viewerHasLiked: false, createdAt: '2026-09-06T12:03:00.000Z', updatedAt: '2026-09-06T12:03:00.000Z' };
  const updatedPoll = { ...poll, commentsCount: 3 };
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: comments })),
    http.post('/polls/poll-1/comments', async ({ request }) => {
      expect(await request.json()).toEqual({ body: 'A newly added comment.' });
      return HttpResponse.json({ comment: createdComment, poll: updatedPoll }, { status: 201 });
    }),
  );
  const user = userEvent.setup();

  renderDetail();

  expect(await screen.findByRole('heading', { name: 'Which option should we choose?' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Comments' })).toBeInTheDocument();
  expect(screen.getByText('First existing comment.')).toBeInTheDocument();
  expect(screen.getByText('Second existing comment.')).toBeInTheDocument();
  await screen.findByLabelText('Add a comment');
  await user.type(screen.getByLabelText('Add a comment'), 'A newly added comment.');
  await user.click(screen.getByRole('button', { name: 'Post comment' }));

  expect(await screen.findByText('A newly added comment.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Comments (3)' })).toBeInTheDocument();
});

test('keeps a posted root outside server pages and deduplicates it when a later page catches up', async () => {
  const createdComment = {
    id: 'comment-new', pollId: 'poll-1', author: { id: 'user-1', username: 'member', displayName: 'Member', avatarObjectKey: null, avatarUrl: null },
    body: 'New root from an overlay.', likesCount: 0, viewerHasLiked: false,
    parentCommentId: null, repliesCount: 0, createdAt: '2026-09-06T12:03:00.000Z', updatedAt: '2026-09-06T12:03:00.000Z',
  };
  let created = false;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll: { ...poll, commentsCount: created ? 3 : 2 } })),
    http.get('/polls/poll-1/comments', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      return cursor
        ? HttpResponse.json({ items: [createdComment], nextCursor: null })
        : HttpResponse.json({ items: [comments[0]], nextCursor: 'cursor-2' });
    }),
    http.post('/polls/poll-1/comments', () => {
      created = true;
      return HttpResponse.json({ comment: createdComment, poll: { ...poll, commentsCount: 3 } }, { status: 201 });
    }),
  );
  const user = userEvent.setup();
  const { queryClient } = renderDetail();

  expect(await screen.findByText('First existing comment.')).toBeInTheDocument();
  await user.type(screen.getByLabelText('Add a comment'), 'New root from an overlay.');
  await user.click(screen.getByRole('button', { name: 'Post comment' }));

  expect(await screen.findByText('New root from an overlay.')).toBeInTheDocument();
  const rootQuery = queryClient.getQueryCache().findAll().find((query) =>
    query.queryKey[0] === 'pagination' && query.queryKey[1] === 'comments' &&
    Boolean(query.state.data && typeof query.state.data === 'object' && 'pages' in query.state.data),
  )!;
  const beforeAppend = queryClient.getQueryData<{ pages: Array<{ items: Array<{ id: string }>; nextCursor: string | null }>; pageParams: unknown[] }>(rootQuery.queryKey)!;
  expect(beforeAppend.pages[0]?.items.map((item) => item.id)).toEqual(['comment-1']);
  expect(beforeAppend.pages[0]?.nextCursor).toBe('cursor-2');
  expect(beforeAppend.pageParams).toEqual([null]);

  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('New root from an overlay.')).toBeInTheDocument();
  expect(screen.getAllByText('New root from an overlay.')).toHaveLength(1);
  const afterAppend = queryClient.getQueryData<typeof beforeAppend>(rootQuery.queryKey)!;
  expect(afterAppend.pages.map((page) => page.items.map((item) => item.id))).toEqual([['comment-1'], ['comment-new']]);
  expect(afterAppend.pageParams).toEqual([null, 'cursor-2']);
});

test('keeps reactions across an in-flight stale refresh and accepts a newer server snapshot', async () => {
  const root = { ...makeRootComment(1), viewerHasLiked: false, likesCount: 0 };
  const likedRoot = { ...root, viewerHasLiked: true, likesCount: 1 };
  const updatedRoot = { ...root, viewerHasLiked: true, likesCount: 5 };
  let commentsReads = 0;
  let releaseStaleRefresh: ((response: Response) => void) | undefined;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => {
      commentsReads += 1;
      if (commentsReads === 1) return HttpResponse.json({ items: [root], nextCursor: null });
      if (commentsReads === 2) return new Promise<Response>((resolve) => { releaseStaleRefresh = resolve; });
      return HttpResponse.json({ items: [updatedRoot], nextCursor: null });
    }),
    http.post('/polls/poll-1/comments/root-1/likes', () => HttpResponse.json({ comment: likedRoot }, { status: 201 })),
  );
  const user = userEvent.setup();

  renderDetail();
  await screen.findByText('Root 1.');
  await user.click(screen.getByRole('button', { name: 'Refresh comments' }));
  await waitFor(() => expect(releaseStaleRefresh).toBeTypeOf('function'));
  await user.click(screen.getByRole('button', { name: 'Like (0)' }));
  expect(await screen.findByRole('button', { name: 'Like (1)' })).toHaveAttribute('aria-pressed', 'true');
  await act(async () => {
    releaseStaleRefresh?.(HttpResponse.json({ items: [root], nextCursor: null }));
    await Promise.resolve();
  });

  expect(await screen.findByRole('button', { name: 'Like (1)' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'Refresh comments' }));
  expect(await screen.findByRole('button', { name: 'Like (5)' })).toHaveAttribute('aria-pressed', 'true');
});

test('keeps a confirmed root reaction when an older append commits its captured page chain', async () => {
  const root = { ...makeRootComment(1), likesCount: 0, viewerHasLiked: false };
  const likedRoot = { ...root, likesCount: 1, viewerHasLiked: true };
  const nextRoot = { ...makeRootComment(2), body: 'Root from appended page.' };
  let appendStarted = false;
  let releaseAppend: ((response: Response) => void) | undefined;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (!cursor) return HttpResponse.json({ items: [root], nextCursor: 'cursor-2' });
      appendStarted = true;
      return new Promise<Response>((resolve) => { releaseAppend = resolve; });
    }),
    http.post('/polls/poll-1/comments/root-1/likes', () => HttpResponse.json({ comment: likedRoot }, { status: 201 })),
  );
  const user = userEvent.setup();
  const { queryClient } = renderDetail();

  await screen.findByText('Root 1.');
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(appendStarted).toBe(true));
  await user.click(screen.getByRole('button', { name: 'Like (0)' }));
  expect(await screen.findByRole('button', { name: 'Like (1)' })).toHaveAttribute('aria-pressed', 'true');

  await act(async () => {
    releaseAppend?.(HttpResponse.json({ items: [nextRoot], nextCursor: null }));
    await Promise.resolve();
  });
  expect(await screen.findByText('Root from appended page.')).toBeInTheDocument();
  await waitFor(() => {
    const query = queryClient.getQueryCache().findAll().find((item) =>
      item.queryKey[0] === 'pagination' && item.queryKey[1] === 'comments' &&
      Boolean(item.state.data && typeof item.state.data === 'object' && 'pages' in item.state.data),
    );
    expect(queryClient.getQueryData<{ pages: Array<{ items: Array<{ id: string }> }> }>(query?.queryKey ?? [])?.pages).toHaveLength(2);
  });
  const rootCard = screen.getByText('Root 1.').closest('li')!;
  expect(within(rootCard).getByRole('button', { name: 'Like (1)' })).toHaveAttribute('aria-pressed', 'true');
});

test('filters a deleted root from a late page and keeps the third feed page counter authoritative', async () => {
  const memberAuthor = { id: 'user-1', username: 'member', displayName: 'Member', avatarObjectKey: null, avatarUrl: null };
  const root = { ...makeRootComment(1), author: memberAuthor };
  const confirmedPoll = { ...poll, commentsCount: 1 };
  let releaseAppend: ((response: Response) => void) | undefined;
  let appendStarted = false;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll: confirmedPoll })),
    http.get('/polls/poll-1/comments', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      return cursor ? new Promise<Response>((resolve) => { appendStarted = true; releaseAppend = resolve; }) : HttpResponse.json({ items: [root], nextCursor: 'cursor-2' });
    }),
    http.delete('/polls/poll-1/comments/root-1', () => new HttpResponse(null, { status: 204 })),
  );
  const user = userEvent.setup();
  const { queryClient } = renderDetail();
  const feedPageParams = [null, 'feed-2', 'feed-3'];
  const feedKey = ['pagination', 'feed', 1, 'user-1', 'newest', null, null, null] as const;
  queryClient.setQueryData(feedKey, {
    pages: [
      { items: [{ ...poll, id: 'feed-a' }], nextCursor: 'feed-2', paginationSupported: true },
      { items: [{ ...poll, id: 'feed-b' }], nextCursor: 'feed-3', paginationSupported: true },
      { items: [poll], nextCursor: null, paginationSupported: true },
    ],
    pageParams: feedPageParams,
  });

  expect(await screen.findByText('Root 1.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(appendStarted).toBe(true));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(screen.queryByText('Root 1.')).not.toBeInTheDocument());
  await act(async () => {
    releaseAppend?.(HttpResponse.json({ items: [root], nextCursor: null }));
    await Promise.resolve();
  });

  expect(screen.queryByText('Root 1.')).not.toBeInTheDocument();
  const rootQuery = queryClient.getQueryCache().findAll().find((query) =>
    query.queryKey[0] === 'pagination' && query.queryKey[1] === 'comments' &&
    Boolean(query.state.data && typeof query.state.data === 'object' && 'pages' in query.state.data),
  )!;
  const rootPages = queryClient.getQueryData<{ pages: Array<{ items: Array<{ id: string }> }>; pageParams: unknown[] }>(rootQuery.queryKey)!;
  expect(rootPages.pages.flatMap((page) => page.items.map((item) => item.id))).not.toContain('root-1');
  expect(rootPages.pageParams).toEqual([null, 'cursor-2']);
  const feed = queryClient.getQueryData<typeof poll | { pages: Array<{ items: typeof poll[] }>; pageParams: unknown[] }>(feedKey)!;
  expect('pages' in feed && feed.pages[2]?.items[0]?.commentsCount).toBe(1);
  expect('pages' in feed && feed.pageParams).toBe(feedPageParams);
});

test.each([false, true])('reconciles an ambiguous comment write (reply=%s) without repeating POST', async (reply) => {
  let written = false; let writes = 0; let reads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => { reads += 1; return HttpResponse.json({ poll: { ...poll, commentsCount: written ? 3 : 2 } }); }),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: comments })),
    http.get('/polls/poll-1/comments/comment-1/replies', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.post('/polls/poll-1/comments', () => { written = true; writes += 1; return HttpResponse.json({ error: 'server_error' }, { status: 500 }); }),
  );
  const user = userEvent.setup();
  renderDetail();
  await screen.findByRole('button', { name: 'Comments (2)' });
  await screen.findByLabelText('Add a comment');
  if (reply) await user.click(screen.getByRole('button', { name: 'Reply to Author' }));
  await user.type(screen.getByLabelText(reply ? 'Write a reply' : 'Add a comment'), 'Possibly saved comment');
  await user.click(screen.getByRole('button', { name: reply ? 'Post reply' : 'Post comment' }));
  expect(await screen.findByRole('button', { name: 'Comments (3)' })).toBeInTheDocument();
  expect(screen.getByLabelText(reply ? 'Write a reply' : 'Add a comment')).toHaveValue('Possibly saved comment');
  expect(writes).toBe(1); expect(reads).toBe(2);
});

test('allows Retry after an initial comments read failure', async () => {
  let reads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => ++reads === 1 ? HttpResponse.json({ error: 'server_error' }, { status: 503 }) : HttpResponse.json({ items: comments })),
  );
  renderDetail();
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Retry loading comments' }));
  expect(screen.getByRole('main')).toHaveFocus();
  expect(await screen.findByText('First existing comment.')).toBeInTheDocument();
  expect(reads).toBe(2);
});

test('keeps focus on the page when Retry replaces a failed poll with a new loading state', async () => {
  let reads = 0;
  let finishRetry!: (response: Response) => void;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => {
      reads += 1;
      if (reads === 1) return HttpResponse.json({ error: 'unavailable' }, { status: 503 });
      return new Promise((resolve) => { finishRetry = resolve; });
    }),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: comments })),
  );
  const user = userEvent.setup();
  renderDetail();

  const retry = await screen.findByRole('button', { name: 'Retry' });
  for (let index = 0; index < 32 && document.activeElement !== retry; index += 1) await user.tab();
  expect(retry).toHaveFocus();
  await user.keyboard('{Enter}');

  const main = screen.getByRole('main');
  expect(main).toHaveFocus();
  finishRetry(HttpResponse.json({ poll }));
  expect(await screen.findByRole('heading', { name: poll.question })).toBeInTheDocument();
  expect(main).toHaveFocus();
});

test('shows a Login link instead of a comment text area for anonymous visitors', async () => {
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: comments, nextCursor: null })),
  );

  renderDetail();

  expect(await screen.findByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login?next=%2Fpolls%2Fpoll-1');
  expect(await screen.findByText('First existing comment.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Add a comment')).not.toBeInTheDocument();
});

test('replaces cached feed and profile polls with the poll returned after a comment is created', async () => {
  const createdComment = { id: 'comment-3', pollId: 'poll-1', author: { id: 'user-1', username: 'member', displayName: 'Member', avatarObjectKey: null, avatarUrl: null }, body: 'A newly added comment.', likesCount: 0, viewerHasLiked: false, createdAt: '2026-09-06T12:03:00.000Z', updatedAt: '2026-09-06T12:03:00.000Z' };
  const updatedPoll = { ...poll, commentsCount: 3 };
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: comments })),
    http.post('/polls/poll-1/comments', () => HttpResponse.json({ comment: createdComment, poll: updatedPoll }, { status: 201 })),
  );
  const user = userEvent.setup();
  const { queryClient } = renderDetail();
  queryClient.setQueryData(['polls', 'for-you'], [poll]);
  queryClient.setQueryData(['user-polls', poll.author.id], [poll]);

  await user.type(await screen.findByLabelText('Add a comment'), 'A newly added comment.');
  await user.click(screen.getByRole('button', { name: 'Post comment' }));

  await screen.findByText('A newly added comment.');
  expect(queryClient.getQueryData<typeof poll[]>(['polls', 'for-you'])?.[0]?.commentsCount).toBe(3);
  expect(queryClient.getQueryData<typeof poll[]>(['user-polls', poll.author.id])?.[0]?.commentsCount).toBe(3);
});

test('opens a distant reply in link context without traversing replies pages or changing the root chain', async () => {
  const root = {
    ...comments[0], id: 'root-1', body: 'Target root comment.', repliesCount: 1, parentCommentId: null,
  };
  const reply = {
    ...comments[1], id: 'reply-1', pollId: 'poll-1', body: 'The exact notification reply.',
    parentCommentId: 'root-1', repliesCount: 0,
  };
  const earlierReply = {
    ...reply, id: 'reply-0', body: 'An earlier reply in the first page.',
  };
  const commentGets: string[] = [];
  const replyCursors: Array<string | null> = [];
  const scrollIntoView = vi.fn();
  originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: [{ ...root, id: 'root-0', body: 'A root from the first page.' }], nextCursor: 'root-page-2' })),
    http.get('/polls/poll-1/comments/reply-1', () => {
      commentGets.push('reply-1');
      return HttpResponse.json({ comment: reply });
    }),
    http.get('/polls/poll-1/comments/root-1', () => {
      commentGets.push('root-1');
      return HttpResponse.json({ comment: root });
    }),
    http.get('/polls/poll-1/comments/root-1/replies', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      replyCursors.push(cursor);
      return cursor
        ? HttpResponse.json({ items: [reply], nextCursor: null })
        : HttpResponse.json({ items: [earlierReply], nextCursor: 'next-page' });
    }),
  );

  const { queryClient } = renderDetail('/polls/poll-1?comment=reply-1');

  expect(await screen.findByText('A root from the first page.')).toBeInTheDocument();
  expect(await screen.findByText('An earlier reply in the first page.')).toBeInTheDocument();
  await waitFor(() => expect(commentGets).toHaveLength(2));
  expect(replyCursors).toEqual([null]);
  expect(commentGets.sort()).toEqual(['reply-1', 'root-1']);

  expect(await screen.findByText('Target root comment.')).toBeInTheDocument();
  const linkedContext = screen.getByRole('region', { name: 'Comment from link' });
  expect(within(linkedContext).getByText('Target root comment.')).toBeInTheDocument();
  const focusedReply = within(linkedContext).getByRole('listitem', { current: 'location' });
  expect(focusedReply).toHaveTextContent('The exact notification reply.');
  expect(document.activeElement).toBe(focusedReply);
  expect(await screen.findByRole('button', { name: 'Hide replies (1)' })).toBeInTheDocument();
  expect(scrollIntoView).toHaveBeenCalledTimes(1);

  const rootPagesBeforeAppend = cachedRootCommentPages(queryClient);
  if (!rootPagesBeforeAppend) throw new Error('Expected the root comments query to be cached.');
  expect(rootPagesBeforeAppend.pages).toHaveLength(1);
  expect(rootPagesBeforeAppend.pageParams).toEqual([null]);

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Load more replies' }));
  await screen.findByText('The exact notification reply.');
  expect(replyCursors).toEqual([null, 'next-page']);
  expect(screen.getAllByText('The exact notification reply.')).toHaveLength(1);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);

  const refreshButton = screen.getByRole('button', { name: 'Refresh comments' });
  await user.click(refreshButton);
  await screen.findByText('An earlier reply in the first page.');
  expect(document.activeElement).toBe(refreshButton);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(commentGets.sort()).toEqual(['reply-1', 'root-1']);
});

test('keeps a distant root in a separate target context and deduplicates it when root pagination catches up', async () => {
  const firstRoot = makeRootComment(1);
  const targetRoot = makeRootComment(10);
  let targetReads = 0;
  let rootPageReads = 0;
  const scrollIntoView = vi.fn();
  originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', ({ request }) => {
      if (new URL(request.url).searchParams.has('cursor')) {
        rootPageReads += 1;
        return HttpResponse.json({ items: [targetRoot], nextCursor: null });
      }
      rootPageReads += 1;
      return HttpResponse.json({ items: [firstRoot], nextCursor: 'root-page-2' });
    }),
    http.get('/polls/poll-1/comments/root-10', () => {
      targetReads += 1;
      return HttpResponse.json({ comment: targetRoot });
    }),
  );
  const user = userEvent.setup();
  const { queryClient } = renderDetail('/polls/poll-1?comment=root-10');

  await screen.findByText('Root 10.');
  const linkedContext = screen.getByRole('region', { name: 'Comment from link' });
  await waitFor(() => expect(targetReads).toBe(1));
  expect(within(linkedContext).getByText('Root 10.')).toBeInTheDocument();
  expect(screen.getAllByText('Root 10.')).toHaveLength(1);
  expect(targetReads).toBe(1);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);

  const rootPages = () => cachedRootCommentPages(queryClient)!;
  expect(rootPages().pages).toHaveLength(1);
  expect(rootPages().pageParams).toEqual([null]);

  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Comment from link' })).not.toBeInTheDocument());
  expect(screen.getAllByText('Root 10.')).toHaveLength(1);
  expect(rootPages().pageParams).toEqual([null, 'root-page-2']);
  expect(rootPageReads).toBe(2);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);

  const refreshButton = screen.getByRole('button', { name: 'Refresh comments' });
  await user.click(refreshButton);
  await screen.findByText('Root 10.');
  expect(document.activeElement).toBe(refreshButton);
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
});

test('reports a missing linked comment while leaving the first comment page available', async () => {
  const firstRoot = makeRootComment(1);
  let targetReads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: [firstRoot], nextCursor: null })),
    http.get('/polls/poll-1/comments/missing-root', () => {
      targetReads += 1;
      return HttpResponse.json({ error: 'not_found', message: 'Comment not found.' }, { status: 404 });
    }),
  );

  renderDetail('/polls/poll-1?comment=missing-root');

  expect(await screen.findByText('This comment is unavailable or may have been removed.')).toBeInTheDocument();
  expect(await screen.findByText('Root 1.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry loading linked comment' })).not.toBeInTheDocument();
  expect(targetReads).toBe(1);
});

test('offers a separate retry after a network error loading a linked comment', async () => {
  const firstRoot = makeRootComment(1);
  const targetRoot = makeRootComment(10);
  let targetReads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: [firstRoot], nextCursor: 'root-page-2' })),
    http.get('/polls/poll-1/comments/root-10', () => {
      targetReads += 1;
      return targetReads === 1
        ? HttpResponse.json({ error: 'temporarily_unavailable' }, { status: 503 })
        : HttpResponse.json({ comment: targetRoot });
    }),
  );
  const user = userEvent.setup();

  renderDetail('/polls/poll-1?comment=root-10');

  expect(await screen.findByText('Could not load this comment from the link.')).toBeInTheDocument();
  expect(await screen.findByText('Root 1.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry loading linked comment' }));
  expect(await screen.findByText('Root 10.')).toBeInTheDocument();
  const linkedContext = screen.getByRole('region', { name: 'Comment from link' });
  expect(within(linkedContext).getByText('Root 10.')).toBeInTheDocument();
  expect(targetReads).toBe(2);
});

test('updates root repliesCount and the authoritative poll count after posting a reply', async () => {
  const root = { ...comments[0], id: 'root-1', parentCommentId: null, repliesCount: 0 };
  const reply = {
    ...comments[1], id: 'reply-2', pollId: 'poll-1', body: 'Reply from the detail page.',
    parentCommentId: 'root-1', repliesCount: 0,
  };
  const updatedPoll = { ...poll, commentsCount: 3 };
  let posted = false;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: [{ ...root, repliesCount: posted ? 1 : 0 }] })),
    http.get('/polls/poll-1/comments/root-1/replies', () => HttpResponse.json({ items: posted ? [reply] : [], nextCursor: null })),
    http.post('/polls/poll-1/comments', async ({ request }) => {
      expect(await request.json()).toEqual({ body: 'Reply from the detail page.', parentCommentId: 'root-1' });
      posted = true;
      return HttpResponse.json({ comment: reply, poll: updatedPoll }, { status: 201 });
    }),
  );
  const user = userEvent.setup();

  const { queryClient } = renderDetail();
  expect(await screen.findByText('First existing comment.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reply to Author' }));
  await user.type(screen.getByLabelText('Write a reply'), 'Reply from the detail page.');
  await user.click(screen.getByRole('button', { name: 'Post reply' }));

  expect(await screen.findByText('Reply from the detail page.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Comments (3)' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Hide replies (1)' }));
  expect(screen.getByRole('button', { name: 'Show replies (1)' })).toBeInTheDocument();
  expect(queryClient.getQueryData<typeof poll>(['poll', 'poll-1'])?.commentsCount).toBe(3);
});

test('loads 125 newest roots through cursor pages and exposes the end only after the final cursor', async () => {
  const roots = Array.from({ length: 125 }, (_, index) => makeRootComment(125 - index));
  const requests: Array<{ order: string | null; limit: string | null; cursor: string | null }> = [];
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', ({ request }) => {
      const url = new URL(request.url);
      const offset = Number(url.searchParams.get('cursor') ?? 0);
      requests.push({
        order: url.searchParams.get('order'),
        limit: url.searchParams.get('limit'),
        cursor: url.searchParams.get('cursor'),
      });
      return HttpResponse.json({
        items: roots.slice(offset, offset + 20),
        nextCursor: offset + 20 < roots.length ? String(offset + 20) : null,
      });
    }),
  );
  const user = userEvent.setup();

  renderDetail();

  expect(await screen.findByText('Root 125.')).toBeInTheDocument();
  expect(screen.getByText('Root 106.')).toBeInTheDocument();
  expect(screen.queryByText('Root 105.')).not.toBeInTheDocument();
  for (let page = 0; page < 6; page += 1) {
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText(`Root ${105 - page * 20}.`)).toBeInTheDocument();
  }

  expect(screen.getByText('Root 1.')).toBeInTheDocument();
  expect(screen.getAllByText(/^Root \d+\.$/)).toHaveLength(125);
  expect(screen.getByText("You've seen everything.")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  expect(requests).toEqual([
    { order: 'newest', limit: '20', cursor: null },
    { order: 'newest', limit: '20', cursor: '20' },
    { order: 'newest', limit: '20', cursor: '40' },
    { order: 'newest', limit: '20', cursor: '60' },
    { order: 'newest', limit: '20', cursor: '80' },
    { order: 'newest', limit: '20', cursor: '100' },
    { order: 'newest', limit: '20', cursor: '120' },
  ]);
});

test('keeps a legacy roots response readable without offering append or claiming the list is complete', async () => {
  let reads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => { reads += 1; return HttpResponse.json({ items: [makeRootComment(1)] }); }),
  );

  renderDetail();

  expect(await screen.findByText('Root 1.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  expect(screen.queryByText("You've seen everything.")).not.toBeInTheDocument();
  expect(reads).toBe(1);
});

test('preserves root pages and their next cursor when discussion refresh fails', async () => {
  const roots = [makeRootComment(1), makeRootComment(2), makeRootComment(3)];
  const cursors: Array<string | null> = [];
  let firstPageReads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      cursors.push(cursor);
      if (!cursor) {
        firstPageReads += 1;
        return firstPageReads === 1
          ? HttpResponse.json({ items: [roots[0]], nextCursor: 'cursor-2' })
          : HttpResponse.json({ error: 'unavailable', message: 'Refresh failed.' }, { status: 503 });
      }
      if (cursor === 'cursor-2') return HttpResponse.json({ items: [roots[1]], nextCursor: 'cursor-3' });
      return HttpResponse.json({ items: [roots[2]], nextCursor: null });
    }),
  );
  const user = userEvent.setup();

  renderDetail();

  expect(await screen.findByText('Root 1.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Root 2.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Refresh comments' }));
  expect(await screen.findByText('Refresh failed.')).toBeInTheDocument();
  expect(screen.getByText('Root 1.')).toBeInTheDocument();
  expect(screen.getByText('Root 2.')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Root 3.')).toBeInTheDocument();
  expect(cursors).toEqual([null, 'cursor-2', null, 'cursor-3']);
});

test('does not let an in-flight append overwrite a successful discussion refresh', async () => {
  const initialRoot = makeRootComment(1);
  const refreshedRoot = { ...makeRootComment(2), body: 'Fresh root after refresh.' };
  const staleRoot = { ...makeRootComment(3), body: 'Stale append response.' };
  let firstPageReads = 0;
  let releaseStaleAppend: ((response: Response) => void) | undefined;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (cursor) return new Promise((resolve) => { releaseStaleAppend = resolve; });
      firstPageReads += 1;
      return HttpResponse.json({
        items: [firstPageReads === 1 ? initialRoot : refreshedRoot],
        nextCursor: firstPageReads === 1 ? 'cursor-2' : null,
      });
    }),
  );
  const user = userEvent.setup();

  renderDetail();

  expect(await screen.findByText('Root 1.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(releaseStaleAppend).toBeTypeOf('function'));
  await user.click(screen.getByRole('button', { name: 'Refresh comments' }));
  expect(await screen.findByText('Fresh root after refresh.')).toBeInTheDocument();

  await act(async () => {
    releaseStaleAppend?.(HttpResponse.json({ items: [staleRoot], nextCursor: null }));
    await Promise.resolve();
  });
  expect(screen.queryByText('Stale append response.')).not.toBeInTheDocument();
  expect(screen.queryByText('Root 1.')).not.toBeInTheDocument();
});

test('refreshes expanded reply threads from their first page after a successful discussion refresh', async () => {
  const root = makeRootComment(1, 2);
  let rootReads = 0;
  let replyFirstPageReads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => {
      rootReads += 1;
      return HttpResponse.json({ items: [rootReads === 1 ? root : { ...root, body: 'Root after refresh.' }], nextCursor: null });
    }),
    http.get('/polls/poll-1/comments/root-1/replies', ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      if (cursor) return HttpResponse.json({ items: [{ ...comments[1], id: 'reply-2', parentCommentId: 'root-1', body: 'Old second reply.' }], nextCursor: null });
      replyFirstPageReads += 1;
      const body = replyFirstPageReads === 1 ? 'Old first reply.' : 'Fresh first reply.';
      return HttpResponse.json({
        items: [{ ...comments[1], id: 'reply-1', parentCommentId: 'root-1', body }],
        nextCursor: replyFirstPageReads === 1 ? 'reply-cursor-2' : null,
      });
    }),
  );
  const user = userEvent.setup();

  renderDetail();

  expect(await screen.findByText('Root 1.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show replies (2)' }));
  expect(await screen.findByText('Old first reply.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more replies' }));
  expect(await screen.findByText('Old second reply.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Refresh comments' }));

  expect(await screen.findByText('Root after refresh.')).toBeInTheDocument();
  expect(await screen.findByText('Fresh first reply.')).toBeInTheDocument();
  expect(screen.queryByText('Old second reply.')).not.toBeInTheDocument();
  expect(replyFirstPageReads).toBe(2);
});

test('keeps the refreshed reply generation when the detail page remounts from a notification target', async () => {
  const root = makeRootComment(1, 1);
  const notificationReply = { ...comments[1], id: 'reply-1', parentCommentId: 'root-1', repliesCount: 0 };
  let replyFirstPageReads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: [root], nextCursor: null })),
    http.get('/polls/poll-1/comments/reply-1', () => HttpResponse.json({ comment: notificationReply })),
    http.get('/polls/poll-1/comments/root-1', () => HttpResponse.json({ comment: root })),
    http.get('/polls/poll-1/comments/root-1/replies', () => {
      replyFirstPageReads += 1;
      const body = replyFirstPageReads === 1 ? 'Old cached notification reply.' : 'Fresh notification reply.';
      return HttpResponse.json({ items: [{ ...notificationReply, body }], nextCursor: null });
    }),
  );
  const user = userEvent.setup();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter initialEntries={['/polls/poll-1?comment=reply-1']}>
          <DetailRouteHarness />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Old cached notification reply.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Refresh comments' }));
  expect(await screen.findByText('Fresh notification reply.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Navigate away' }));
  expect(await screen.findByText('Away from poll.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Return to notification' }));

  expect(await screen.findByText('Fresh notification reply.')).toBeInTheDocument();
  expect(screen.queryByText('Old cached notification reply.')).not.toBeInTheDocument();
  expect(replyFirstPageReads).toBe(2);
});
