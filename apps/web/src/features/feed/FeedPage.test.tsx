import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { SessionProvider } from '../../app/session-provider';
import { listScrollState } from '../../core/scroll/list-scroll-state';
import { t02MotionScrollCursorPages, t02MotionScrollPolls } from '../../test-utils/t02-motion-scroll-fixture';
import { FeedPage } from './FeedPage';

const poll = {
  id: 'poll-1',
  author: { id: 'author-1', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null },
  question: 'Which option?',
  imageUrl: null,
  options: [{ id: 'option-1', text: 'First', position: 0, votesCount: 3 }],
  votesCount: 3,
  commentsCount: 0,
  likesCount: 2,
  viewerHasLiked: false,
  allowVoteCancellation: false,
  createdAt: '2026-09-06T12:00:00.000Z',
  viewerVoteOptionId: null,
  endsAt: null,
};

const server = setupServer();

function renderFeed() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter>
          <FeedPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  ) };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => server.use(
  http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
  http.get('/polls', () => HttpResponse.json({ items: [] })),
  http.get('/users', () => HttpResponse.json({ items: [] })),
));
afterEach(() => {
  server.resetHandlers();
  sessionStorage.clear();
  listScrollState.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => server.close());

test('read_timeout_then_retry_ignores_old_response in the feed UI without automatic retry', async () => {
  vi.useFakeTimers();
  let requests = 0; let release!: (response: Response) => void;
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (String(url) === '/auth/me') return Promise.resolve(Response.json({ error: 'unauthorized' }, { status: 401 }));
    requests += 1;
    if (requests === 1) return new Promise((resolve) => { release = resolve; });
    return Promise.resolve(Response.json({ items: [{ ...poll, question: 'Fresh retry result?' }] }));
  });
  const view = renderFeed();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(requests).toBe(1);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole('alert')).toHaveTextContent('timed out');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(requests).toBe(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText('Fresh retry result?')).toBeInTheDocument();
  await act(async () => { release(Response.json({ items: [poll] })); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.queryByText('Which option?')).not.toBeInTheDocument();
  expect(requests).toBe(2);
  view.unmount(); view.queryClient.clear();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(vi.getTimerCount()).toBe(0);
});

test('renders polls with immediately clickable answer options', async () => {
  server.use(
    http.get('/polls', ({ request }) => {
      expect(new URL(request.url).searchParams.get('limit')).toBe('20');
      return HttpResponse.json({ items: [poll] });
    }),
  );

  renderFeed();

  expect(await screen.findByText('Which option?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'First (3 votes)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'First (3 votes)' })).toHaveAccessibleDescription('Sign in to vote on this poll.');
  expect(screen.getByRole('button', { name: 'Comments (0)' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Comments (0)' })).not.toHaveAccessibleDescription('Comments are not available yet.');
});

test('loads the shared T02 fixture with fixed count boundaries and cursor pages', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: t02MotionScrollPolls })));
  const { container } = renderFeed();

  for (const card of t02MotionScrollPolls) {
    expect(await screen.findByRole('heading', { name: card.question })).toBeInTheDocument();
  }
  expect(container.querySelectorAll('.poll-card')).toHaveLength(8);
  expect(Array.from(container.querySelectorAll('.poll-card__image')).map((image) => image.getAttribute('src')))
    .toEqual(t02MotionScrollPolls.filter((card) => card.imageUrl).map((card) => card.imageUrl));
  expect(t02MotionScrollPolls.map((card) => card.votesCount)).toEqual([9, 10, 99, 100, 0, 999, 1000, 10]);
  expect(t02MotionScrollCursorPages.map((page) => page.pollIds.length)).toEqual([2, 3]);
});


test('uses an editorial feed heading and restrained contextual rail', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  const { container } = renderFeed();

  expect(await screen.findByRole('heading', { name: 'Your feed' })).toBeInTheDocument();
  expect(container.querySelector('.feed-toolbar')).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Discover content' })).toHaveClass('context-rail');
  expect(container.querySelector('.discovery-cta')).not.toBeInTheDocument();
});

test('opens the selected poll comments route from the feed card', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<FeedPage />} />
            <Route path="/polls/:pollId" element={<p>Comments for selected poll</p>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );

  await user.click(await screen.findByRole('button', { name: 'Comments (0)' }));
  expect(await screen.findByText('Comments for selected poll')).toBeInTheDocument();
});

test('restores the feed poll anchor after opening comments and returning', async () => {
  const polls = [poll, { ...poll, id: 'poll-2', question: 'Second poll?' }];
  server.use(http.get('/polls', () => HttpResponse.json({ items: polls })));
  let anchorTop = 120;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.listItemId === 'poll-2') {
      return { x: 0, y: anchorTop, top: anchorTop, left: 0, right: 640, bottom: anchorTop + 240, width: 640, height: 240, toJSON: () => ({}) };
    }
    return originalRect.call(this);
  });
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const user = userEvent.setup();
  function BackToFeed() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate(-1)}>Back to feed</button>;
  }
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<FeedPage />} />
            <Route path="/polls/:pollId" element={<BackToFeed />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );

  await screen.findByText('Second poll?');
  window.dispatchEvent(new Event('scroll'));
  expect(listScrollState.read({ userId: null, route: '/', list: 'feed', query: '', filter: '', sort: 'for-you' }))
    .toEqual({ id: 'poll-2', top: 120 });
  await user.click(screen.getAllByRole('button', { name: 'Comments (0)' })[1]);
  expect(await screen.findByRole('button', { name: 'Back to feed' })).toBeInTheDocument();
  anchorTop = 270;
  await user.click(screen.getByRole('button', { name: 'Back to feed' }));
  await screen.findByText('Second poll?');
  expect(scrollTo).toHaveBeenCalledWith({ top: 150, behavior: 'auto' });
  expect(document.activeElement).toBe(screen.getByText('Second poll?').closest('[data-list-item-id]'));
});

test('renders a discovery rail alongside the feed', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  renderFeed();

  expect(await screen.findByRole('complementary', { name: 'Discover content' })).toBeInTheDocument();
  expect(screen.getByText('Games')).toBeInTheDocument();
});

test('renders the reference desktop discovery cards', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  renderFeed();

  expect(await screen.findByRole('heading', { name: 'Trending today' })).toBeInTheDocument();
  expect(screen.getByText('Programming')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'See all' })).toBeInTheDocument();
  expect(screen.getByText(`© ${new Date().getFullYear()} Yask. All rights reserved.`)).toBeInTheDocument();
});

test('renders the reference composer and feed segments', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  renderFeed();

  expect(await screen.findByRole('link', { name: 'Post' })).toHaveAttribute('href', '/polls/new');
  expect(screen.getByText("What's on your mind today?")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'For you' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Trending' })).toHaveAttribute('aria-pressed', 'false');
});

test('uses the current mobile add icon in the composer', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  renderFeed();

  const composer = await screen.findByRole('region', { name: 'Create a poll' });
  expect(composer.querySelector('[data-icon="add"]')).toBeInTheDocument();
});

test('renders the reference discovery sections', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  renderFeed();

  expect(await screen.findByRole('heading', { name: 'Who to follow' })).toBeInTheDocument();
  expect(screen.getByText('Games')).toBeInTheDocument();
});

test('renders real registered profiles in who to follow', async () => {
  server.use(
    http.get('/auth/me', () => HttpResponse.json({
      user: {
        id: 'user-1',
        email: 'member@example.com',
        username: 'member',
        status: 'active',
        profile: {
          displayName: 'Member',
          pollsCount: 0,
          followersCount: 0,
          followingCount: 0,
          countryCode: 'BY',
          bio: null,
          avatarObjectKey: null,
          avatarUrl: null,
        },
      },
    })),
    http.get('/polls', () => HttpResponse.json({ items: [poll] })),
    http.get('/users', ({ request }) => {
      expect(request.credentials).toBe('include');
      expect(request.headers.get('authorization')).toBeNull();
      expect(new URL(request.url).search).toBe('?sort=popular&limit=3');
      return HttpResponse.json({
        items: [
          {
            id: 'user-2',
            username: 'real-user',
            status: 'active',
            createdAt: '2026-09-07T12:00:00.000Z',
            updatedAt: '2026-09-07T12:00:00.000Z',
            viewerIsFollowing: false,
            profile: {
              displayName: 'Real User',
              pollsCount: 4,
              followersCount: 12,
              followingCount: 2,
              countryCode: 'BY',
              bio: null,
              avatarObjectKey: null,
              avatarUrl: null,
            },
          },
        ],
      });
    }),
  );

  renderFeed();

  expect(await screen.findByText('Real User')).toBeInTheDocument();
  expect(screen.getByText('@real-user')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Real User' })).toHaveAttribute('href', '/users/user-2');
  expect(screen.queryByText('alexdev')).not.toBeInTheDocument();
});

test('uses the supplied reference labels and abbreviated trend counts', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  renderFeed();

  expect(await screen.findByRole('heading', { name: 'Trending today' })).toBeInTheDocument();
  expect(screen.getByText('1.2K polls')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Who to follow' })).toBeInTheDocument();
});

test('collapses and expands the trends list from its button', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  const user = userEvent.setup();
  renderFeed();

  const trendsButton = await screen.findByRole('button', { name: /Toggle trending topics/ });
  expect(trendsButton).toHaveAttribute('aria-expanded', 'true');
  await user.click(trendsButton);
  expect(trendsButton).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Games')).not.toBeInTheDocument();
});

test('waits for a restored session before loading viewer-specific polls', async () => {
  const requests: string[] = [];
  const viewerPoll = {
    ...poll,
    author: { ...poll.author, id: 'user-1' },
  };
  server.use(
    http.get('/auth/me', ({ request }) => {
      requests.push('me');
      expect(request.credentials).toBe('include');
      expect(request.headers.get('authorization')).toBeNull();
      return HttpResponse.json({
        user: {
          id: 'user-1',
          email: 'member@example.com',
          username: 'member',
          status: 'active',
          profile: {
            displayName: 'Member',
            pollsCount: 0,
            followersCount: 0,
            followingCount: 0,
            countryCode: 'BY',
            bio: null,
            avatarObjectKey: null,
            avatarUrl: null,
          },
        },
      });
    }),
    http.get('/polls', ({ request }) => {
      requests.push('polls');
      expect(request.credentials).toBe('include');
      expect(request.headers.get('authorization')).toBeNull();
      return HttpResponse.json({ items: [viewerPoll] });
    }),
    http.get('/users', () => HttpResponse.json({ items: [] })),
  );

  renderFeed();

  expect(await screen.findByText('You')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'First (3 votes)' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Like (2)' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Like (2)' })).toHaveAttribute('aria-pressed', 'false');
  expect(requests).toEqual(['me', 'polls']);
});

test('reissues the feed request when Retry is selected after a failed load', async () => {
  let requests = 0;
  server.use(
    http.get('/polls', () => {
      requests += 1;
      return HttpResponse.json({ error: 'unavailable', message: 'Try again.' }, { status: 503 });
    }),
  );

  const user = userEvent.setup();
  renderFeed();

  await user.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(requests).toBe(2));
});
