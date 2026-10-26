import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { SessionProvider, useSession } from '../../app/session-provider';
import { apiClient } from '../../api/client';
import { MotionSettingsProvider } from '../../core/motion/motion-settings';
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

const authenticatedUser = {
  id: 'user-1', email: 'member@example.com', username: 'member', status: 'active',
  profile: { displayName: 'Member', pollsCount: 0, followersCount: 0, followingCount: 0, countryCode: 'BY', bio: null, avatarObjectKey: null, avatarUrl: null },
};

class TestIntersectionObserver implements IntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.rootMargin = options?.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options?.threshold) ? options.threshold : [options?.threshold ?? 0];
    TestIntersectionObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }

  intersect(): void {
    this.callback([{
      isIntersecting: true,
      intersectionRatio: 1,
      target: document.createElement('div'),
      boundingClientRect: new DOMRect(),
      intersectionRect: new DOMRect(),
      rootBounds: null,
      time: 0,
    }], this);
  }
}

function cursorPage(items: unknown[], nextCursor: string | null) {
  return HttpResponse.json({ items, nextCursor });
}

const server = setupServer();

function SessionStatus() {
  const session = useSession();
  return <output aria-label="Session status">{session.status}</output>;
}

function renderFeed(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }), entryMotion = false) {
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <MotionSettingsProvider flags={{ reactionsMotion: false, entryMotion }}>
        <SessionProvider>
          <SessionStatus />
          <MemoryRouter>
            <FeedPage />
          </MemoryRouter>
        </SessionProvider>
      </MotionSettingsProvider>
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(() => server.close());

test('replaces the account feed with anonymous data after the session expires', async () => {
  let expired = false;
  let guestReads = 0;
  server.use(
    http.get('/auth/me', () => expired
      ? HttpResponse.json({ error: 'unauthorized' }, { status: 401 })
      : HttpResponse.json({ user: {
        id: 'user-1', email: 'member@example.com', username: 'member', status: 'active',
        profile: { displayName: 'Member', pollsCount: 0, followersCount: 0, followingCount: 0, countryCode: 'BY', bio: null, avatarObjectKey: null, avatarUrl: null },
      } })),
    http.get('/polls', () => {
      if (expired) guestReads += 1;
      return HttpResponse.json({ items: [{ ...poll, question: expired ? 'Public poll?' : 'Account poll?', viewerHasLiked: !expired }] });
    }),
  );
  const view = renderFeed();
  expect(await screen.findByText('Account poll?')).toBeInTheDocument();
  expired = true;
  await act(async () => { await apiClient.get('/auth/me', (body) => body).catch(() => undefined); });
  expect(screen.getByLabelText('Session status')).toHaveTextContent('anonymous');
  expect(screen.queryByText('Account poll?')).not.toBeInTheDocument();
  expect(await screen.findByText('Public poll?')).toBeInTheDocument();
  expect(guestReads).toBe(1);
  view.unmount();
  view.queryClient.clear();
});

test('applies entry motion to a newly visible poll while keeping its actions interactive', async () => {
  server.use(http.get('/auth/me', () => HttpResponse.json({ user: {
    id: 'user-1', email: 'member@example.com', username: 'member', status: 'active',
    profile: { displayName: 'Member', pollsCount: 0, followersCount: 0, followingCount: 0, countryCode: 'BY', bio: null, avatarObjectKey: null, avatarUrl: null },
  } })));
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  const view = renderFeed(undefined, true);

  const card = await screen.findByRole('article', { name: 'Which option?' });
  expect(card).toHaveAttribute('data-entry-motion', 'active');
  expect(screen.getByRole('button', { name: 'Like (2)' })).toBeEnabled();
  view.unmount();
  view.queryClient.clear();
});

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
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(document.querySelector('.feed-main [role="status"]')).toHaveTextContent('Loading polls');
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByRole('alert')).toHaveTextContent('timed out');
  expect(document.querySelector('.feed-main [role="status"]')).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(requests).toBe(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText('Fresh retry result?')).toBeInTheDocument();
  await act(async () => { release(Response.json({ items: [poll] })); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.queryByText('Which option?')).not.toBeInTheDocument();
  expect(requests).toBe(2);
  view.unmount();
  view.queryClient.clear();
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

test('does not show a suggested-users skeleton for an anonymous viewer', async () => {
  renderFeed();

  expect(await screen.findByRole('heading', { name: 'Your feed' })).toBeInTheDocument();
  expect(screen.queryByText('Loading people…')).not.toBeInTheDocument();
});

test('keeps cached polls visible and skips the skeleton during a background refetch', async () => {
  let release!: (response: Response) => void;
  let requests = 0;
  let holdNext = false;
  server.use(http.get('/polls', () => {
    requests += 1;
    if (holdNext) return new Promise<Response>((resolve) => { release = resolve; });
    return HttpResponse.json({ items: [poll] });
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = renderFeed(queryClient);

  expect(await screen.findByText('Which option?')).toBeInTheDocument();
  await waitFor(() => expect(requests).toBe(1));
  holdNext = true;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh feed' }));
  await waitFor(() => expect(requests).toBe(2));
  expect(document.querySelector('.feed-main [role="status"]')).toHaveTextContent('Refreshing polls');
  expect(screen.getByText('Which option?')).toBeInTheDocument();
  await act(async () => { release(Response.json({ items: [poll] })); });
  view.unmount();
  queryClient.clear();
});

test('preserves cached rows and shows a local retry after a background refresh error', async () => {
  let requests = 0;
  server.use(http.get('/polls', () => {
    requests += 1;
    if (requests === 1) return HttpResponse.json({ items: [poll] });
    return HttpResponse.json({ error: 'unavailable', message: 'Refresh failed.' }, { status: 503 });
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = renderFeed(queryClient);

  expect(await screen.findByText('Which option?')).toBeInTheDocument();
  await waitFor(() => expect(requests).toBe(1));
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh feed' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed.');
  expect(screen.getByText('Which option?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh feed' })).toBeEnabled();
  view.unmount();
  queryClient.clear();
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
  expect(scrollTo).toHaveBeenCalledWith({ top: 150, behavior: 'instant' });
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

test('keeps keyboard focus in the feed when Retry replaces the error view', async () => {
  let requests = 0;
  let finishRetry!: (response: Response) => void;
  server.use(http.get('/polls', () => {
    requests += 1;
    if (requests === 1) return HttpResponse.json({ error: 'unavailable' }, { status: 503 });
    return new Promise((resolve) => { finishRetry = resolve; });
  }));

  const user = userEvent.setup();
  renderFeed();
  const retry = await screen.findByRole('button', { name: 'Retry' });
  for (let index = 0; index < 32 && document.activeElement !== retry; index += 1) await user.tab();
  expect(retry).toHaveFocus();

  await user.keyboard('{Enter}');

  const main = screen.getByRole('main');
  expect(main).toHaveFocus();
  finishRetry(HttpResponse.json({ items: [poll] }));
  expect(await screen.findByText('Which option?')).toBeInTheDocument();
  expect(main).toHaveFocus();
});

test('a sidebar Retry does not steal focus during a later feed sort load', async () => {
  let pollReads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: {
      id: 'user-1', email: 'member@example.com', username: 'member', status: 'active',
      profile: { displayName: 'Member', pollsCount: 0, followersCount: 0, followingCount: 0, countryCode: 'BY', bio: null, avatarObjectKey: null, avatarUrl: null },
    } })),
    http.get('/polls', () => ++pollReads === 2 ? new Promise(() => {}) : HttpResponse.json({ items: [poll] })),
    http.get('/users', () => HttpResponse.json({ error: 'unavailable' }, { status: 503 })),
  );
  const user = userEvent.setup();
  renderFeed();

  const retry = await screen.findByRole('button', { name: 'Retry' });
  await user.click(retry);
  const following = screen.getByRole('button', { name: 'Following' });
  await user.click(following);

  expect(following).toHaveFocus();
});

test('loads Following from subscriptions and appends its next page when the footer enters the viewport', async () => {
  TestIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  const requests: string[] = [];
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: authenticatedUser })),
    http.get('/polls', ({ request }) => {
      requests.push(new URL(request.url).pathname + new URL(request.url).search);
      return cursorPage([{ ...poll, question: 'For you first page?' }], null);
    }),
    http.get('/polls/subscriptions', ({ request }) => {
      const url = new URL(request.url);
      const cursor = url.searchParams.get('cursor');
      requests.push(url.pathname + url.search);
      return cursor === null
        ? cursorPage([{ ...poll, id: 'following-1', question: 'Following first page?' }], 'following-cursor')
        : cursorPage([{ ...poll, id: 'following-2', question: 'Following second page?' }], null);
    }),
  );
  const user = userEvent.setup();

  renderFeed();
  expect(await screen.findByText('For you first page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Following' }));
  expect(await screen.findByText('Following first page?')).toBeInTheDocument();
  expect(requests).toContain('/polls/subscriptions?limit=20');

  const observer = TestIntersectionObserver.instances.at(-1);
  expect(observer?.rootMargin).toContain('100%');
  act(() => observer?.intersect());
  expect(await screen.findByText('Following second page?')).toBeInTheDocument();
  expect(requests).toContain('/polls/subscriptions?limit=20&cursor=following-cursor');
  expect(requests.filter((request) => request.startsWith('/polls?'))).toEqual(['/polls?limit=20']);
});

test('loads another page from the footer, ignores a duplicate click, and retries a failed append', async () => {
  let cursorReads = 0;
  let finishFirstAppend!: (response: Response) => void;
  server.use(http.get('/polls', ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    if (cursor === null) return cursorPage([{ ...poll, question: 'First page?' }], 'cursor-1');
    cursorReads += 1;
    if (cursorReads === 1) return new Promise((resolve) => { finishFirstAppend = resolve; });
    return cursorPage([{ ...poll, id: 'poll-2', question: 'Second page?' }], null);
  }));
  const user = userEvent.setup();
  renderFeed();

  expect(await screen.findByText('First page?')).toBeInTheDocument();
  const loadMore = screen.getByRole('button', { name: 'Load more' });
  await user.dblClick(loadMore);
  await waitFor(() => expect(cursorReads).toBe(1));
  expect(screen.getByRole('button', { name: 'Load more' })).toHaveAttribute('aria-disabled', 'true');
  finishFirstAppend(HttpResponse.json({ error: 'unavailable', message: 'Append failed.' }, { status: 503 }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Append failed.');
  expect(screen.getByRole('button', { name: 'Retry loading more' })).toBeEnabled();
  expect(screen.getByText('First page?')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Retry loading more' }));
  expect(await screen.findByText('Second page?')).toBeInTheDocument();
  expect(cursorReads).toBe(2);
});

test('Refresh replaces the accumulated page chain with a cursorless first page', async () => {
  const requests: string[] = [];
  let firstPageReads = 0;
  server.use(http.get('/polls', ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    requests.push(cursor ?? '<first>');
    if (cursor === null) {
      firstPageReads += 1;
      return firstPageReads === 1
        ? cursorPage([{ ...poll, question: 'Original first page?' }], 'cursor-1')
        : cursorPage([{ ...poll, id: 'poll-refreshed', question: 'Refreshed first page?' }], null);
    }
    return cursorPage([{ ...poll, id: 'poll-2', question: 'Original second page?' }], 'cursor-2');
  }));
  const user = userEvent.setup();
  renderFeed();

  expect(await screen.findByText('Original first page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Original second page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Refresh feed' }));

  expect(await screen.findByText('Refreshed first page?')).toBeInTheDocument();
  expect(screen.queryByText('Original first page?')).not.toBeInTheDocument();
  expect(screen.queryByText('Original second page?')).not.toBeInTheDocument();
  expect(requests).toEqual(['<first>', 'cursor-1', '<first>']);
  expect(screen.getByText("You've seen everything.")).toHaveAttribute('role', 'status');
});

test('Popular keeps snapshot order after a reaction and advances through an empty page', async () => {
  const popularFirst = { ...poll, id: 'popular-1', question: 'Popular first?' };
  const popularSecond = { ...poll, id: 'popular-2', question: 'Popular second?', likesCount: 1 };
  const likedPopularSecond = { ...popularSecond, likesCount: 100, viewerHasLiked: true };
  const popularThird = { ...poll, id: 'popular-3', question: 'Popular third?' };
  const requests: Array<{ sort: string; cursor: string | null }> = [];
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: authenticatedUser })),
    http.get('/polls', ({ request }) => {
      const url = new URL(request.url);
      const sort = url.searchParams.get('sort') ?? 'newest';
      const cursor = url.searchParams.get('cursor');
      requests.push({ sort, cursor });
      if (sort !== 'popular') return cursorPage([{ ...poll, question: 'Newest feed?' }], null);
      if (cursor === null) return cursorPage([popularFirst, popularSecond], 'popular-cursor-1');
      if (cursor === 'popular-cursor-1') return cursorPage([], 'popular-cursor-2');
      if (cursor === 'popular-cursor-2') return cursorPage([popularThird], null);
      throw new Error(`Unexpected popular cursor: ${cursor}`);
    }),
    http.post('/polls/:pollId/likes', ({ params }) => {
      expect(params.pollId).toBe(popularSecond.id);
      return HttpResponse.json({ poll: likedPopularSecond });
    }),
  );
  const user = userEvent.setup();
  renderFeed();

  expect(await screen.findByText('Newest feed?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Trending' }));
  expect(await screen.findByText('Popular first?')).toBeInTheDocument();
  expect(screen.getByText('Popular second?')).toBeInTheDocument();

  const pollOrder = () => Array.from(document.querySelectorAll('.feed-list .poll-card h2'))
    .map((heading) => heading.textContent);
  expect(pollOrder()).toEqual(['Popular first?', 'Popular second?']);
  await user.click(screen.getByRole('button', { name: 'Like (1)' }));
  expect(await screen.findByRole('button', { name: 'Like (100)' })).toHaveAttribute('aria-pressed', 'true');
  expect(pollOrder()).toEqual(['Popular first?', 'Popular second?']);

  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByRole('button', { name: 'Load more' })).toBeEnabled();
  expect(screen.getByText('Popular first?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Popular third?')).toBeInTheDocument();
  expect(pollOrder()).toEqual(['Popular first?', 'Popular second?', 'Popular third?']);
  expect(requests.filter((request) => request.sort === 'popular')).toEqual([
    { sort: 'popular', cursor: null },
    { sort: 'popular', cursor: 'popular-cursor-1' },
    { sort: 'popular', cursor: 'popular-cursor-2' },
  ]);
});

test('Popular expiry keeps loaded pages and creates a new snapshot only on refresh', async () => {
  const retained = { ...poll, id: 'popular-retained', question: 'Retained popular page?' };
  const refreshed = { ...poll, id: 'popular-refreshed', question: 'Refreshed popular page?' };
  const requests: Array<string | null> = [];
  let popularFirstReads = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: authenticatedUser })),
    http.get('/polls', ({ request }) => {
      const url = new URL(request.url);
      const sort = url.searchParams.get('sort') ?? 'newest';
      const cursor = url.searchParams.get('cursor');
      if (sort !== 'popular') return cursorPage([{ ...poll, question: 'Newest feed?' }], null);
      requests.push(cursor);
      if (cursor === null) {
        popularFirstReads += 1;
        return cursorPage([popularFirstReads === 1 ? retained : refreshed], popularFirstReads === 1 ? 'cursor-1' : null);
      }
      return HttpResponse.json({
        error: 'pagination_expired',
        message: 'This popular feed snapshot expired.',
      }, { status: 410 });
    }),
  );
  const user = userEvent.setup();
  renderFeed();

  expect(await screen.findByText('Newest feed?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Trending' }));
  expect(await screen.findByText('Retained popular page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('This popular feed snapshot expired. Refresh the feed to continue.');
  expect(screen.getByText('Retained popular page?')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry loading more' })).not.toBeInTheDocument();
  expect(requests).toEqual([null, 'cursor-1']);

  await user.click(screen.getByRole('button', { name: 'Refresh popular feed' }));
  expect(await screen.findByText('Refreshed popular page?')).toBeInTheDocument();
  expect(screen.queryByText('Retained popular page?')).not.toBeInTheDocument();
  expect(requests).toEqual([null, 'cursor-1', null]);
});

test('a failed Refresh keeps the previous pages and continuation cursor usable', async () => {
  let firstPageReads = 0;
  const cursors: string[] = [];
  server.use(http.get('/polls', ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    if (cursor === null) {
      firstPageReads += 1;
      if (firstPageReads === 1) return cursorPage([{ ...poll, question: 'Retained first page?' }], 'cursor-1');
      return HttpResponse.json({ error: 'unavailable', message: 'Refresh failed.' }, { status: 503 });
    }
    cursors.push(cursor);
    if (cursor === 'cursor-1') return cursorPage([{ ...poll, id: 'poll-2', question: 'Retained second page?' }], 'cursor-2');
    return cursorPage([{ ...poll, id: 'poll-3', question: 'Continued third page?' }], null);
  }));
  const user = userEvent.setup();
  renderFeed();

  expect(await screen.findByText('Retained first page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Retained second page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Refresh feed' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh failed.');
  expect(screen.getByText('Retained first page?')).toBeInTheDocument();
  expect(screen.getByText('Retained second page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Continued third page?')).toBeInTheDocument();
  expect(cursors).toEqual(['cursor-1', 'cursor-2']);
});

test('requires a manual append after three viewport-triggered page loads', async () => {
  TestIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  const cursors: string[] = [];
  server.use(http.get('/polls', ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    cursors.push(cursor ?? '<first>');
    const index = cursor === null ? 0 : Number(cursor.replace('cursor-', ''));
    return cursorPage([{ ...poll, id: `poll-${index}`, question: `Page ${index + 1}?` }], index < 4 ? `cursor-${index + 1}` : null);
  }));
  const user = userEvent.setup();
  renderFeed();

  expect(await screen.findByText('Page 1?')).toBeInTheDocument();
  for (let page = 2; page <= 4; page += 1) {
    act(() => TestIntersectionObserver.instances.at(-1)?.intersect());
    expect(await screen.findByText(`Page ${page}?`)).toBeInTheDocument();
  }
  expect(cursors).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();

  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Page 5?')).toBeInTheDocument();
  expect(cursors).toHaveLength(5);
});

test('shows a sign-in prompt for guest Following without requesting a shared feed', async () => {
  const requests: string[] = [];
  server.use(http.get('/polls', ({ request }) => {
    requests.push(new URL(request.url).pathname);
    return HttpResponse.json({ items: [poll] });
  }));
  const user = userEvent.setup();
  renderFeed();

  await user.click(await screen.findByRole('button', { name: 'Following' }));

  expect(screen.getByText(/Sign in to see polls from people you follow/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2F');
  expect(screen.getByRole('button', { name: 'Refresh feed' })).toBeDisabled();
  expect(requests).toEqual(['/polls']);
});

test('restores the selected feed tab and its cached pages after returning from comments', async () => {
  const requests: string[] = [];
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: authenticatedUser })),
    http.get('/polls', () => cursorPage([{ ...poll, question: 'For you tab?' }], null)),
    http.get('/polls/subscriptions', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url.searchParams.get('cursor') ?? '<first>');
      return url.searchParams.has('cursor')
        ? cursorPage([{ ...poll, id: 'following-2', question: 'Following cached second?' }], null)
        : cursorPage([{ ...poll, id: 'following-1', question: 'Following cached first?' }], 'following-cursor');
    }),
  );
  const user = userEvent.setup();
  function BackToFeed() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate(-1)}>Back to feed</button>;
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>
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

  await user.click(await screen.findByRole('button', { name: 'Following' }));
  expect(await screen.findByText('Following cached first?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Following cached second?')).toBeInTheDocument();
  await user.click(screen.getAllByRole('button', { name: 'Comments (0)' })[0]);
  await user.click(await screen.findByRole('button', { name: 'Back to feed' }));

  expect(await screen.findByText('Following cached first?')).toBeInTheDocument();
  expect(screen.getByText('Following cached second?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
  expect(requests).toEqual(['<first>', 'following-cursor']);
});

test('keeps append errors scoped to their tab when switching between feed surfaces', async () => {
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: authenticatedUser })),
    http.get('/polls', ({ request }) => new URL(request.url).searchParams.has('cursor')
      ? HttpResponse.json({ error: 'unavailable', message: 'For you append failed.' }, { status: 503 })
      : cursorPage([{ ...poll, question: 'For you cached page?' }], 'for-you-cursor')),
    http.get('/polls/subscriptions', () => cursorPage([{ ...poll, id: 'following-1', question: 'Following separate page?' }], null)),
  );
  const user = userEvent.setup();
  renderFeed();

  expect(await screen.findByText('For you cached page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('For you append failed.');
  await user.click(screen.getByRole('button', { name: 'Following' }));

  expect(await screen.findByText('Following separate page?')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'For you' }));

  expect(screen.getByText('For you cached page?')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('For you append failed.');
  expect(screen.getByRole('button', { name: 'Retry loading more' })).toBeEnabled();
});

test('returning after an append error keeps the accepted chain without refetching its pages', async () => {
  const requests: string[] = [];
  server.use(http.get('/polls', ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    requests.push(cursor ?? '<first>');
    if (cursor === null) return cursorPage([{ ...poll, question: 'Retained first page?' }], 'cursor-1');
    if (cursor === 'cursor-1') return cursorPage([{ ...poll, id: 'poll-2', question: 'Retained second page?' }], 'cursor-2');
    return HttpResponse.json({ error: 'unavailable', message: 'Final append failed.' }, { status: 503 });
  }));
  const user = userEvent.setup();
  function BackToFeed() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate(-1)}>Back to feed</button>;
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>
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

  expect(await screen.findByText('Retained first page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Retained second page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Final append failed.');
  await user.click(screen.getAllByRole('button', { name: 'Comments (0)' })[0]);
  await user.click(await screen.findByRole('button', { name: 'Back to feed' }));

  expect(await screen.findByText('Retained first page?')).toBeInTheDocument();
  expect(screen.getByText('Retained second page?')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Final append failed.');
  expect(screen.getByRole('button', { name: 'Retry loading more' })).toBeEnabled();
  expect(requests).toEqual(['<first>', 'cursor-1', 'cursor-2']);
});

test('offers Refresh instead of a dead Load more button when the server repeats a cursor', async () => {
  const cursors: Array<string | null> = [];
  server.use(http.get('/polls', ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor');
    cursors.push(cursor);
    if (cursor === null) return cursorPage([{ ...poll, question: 'Repeated cursor first page?' }], 'cursor-1');
    return cursorPage([{ ...poll, id: 'poll-2', question: 'Repeated cursor second page?' }], 'cursor-1');
  }));
  const user = userEvent.setup();
  renderFeed();

  expect(await screen.findByText('Repeated cursor first page?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('Repeated cursor second page?')).toBeInTheDocument();

  expect(await screen.findByRole('alert')).toHaveTextContent('The server returned a repeated cursor. Refresh the feed to continue.');
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh this feed' })).toBeEnabled();
  expect(cursors).toEqual([null, 'cursor-1']);
});
