import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SessionProvider } from '../../app/session-provider';
import { SearchPage } from './SearchPage';

const currentUser = { id: 'user-1', email: 'member@example.com', username: 'member', status: 'active', profile: { displayName: 'Member', pollsCount: 0, followersCount: 0, followingCount: 0, countryCode: 'BY', bio: null, avatarObjectKey: null, avatarUrl: null } };
const poll = { id: 'poll-1', author: { id: 'author-1', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null }, question: 'Climate action?', imageUrl: null, options: [], votesCount: 0, commentsCount: 0, likesCount: 0, viewerHasLiked: false, allowVoteCancellation: true, createdAt: '2026-09-01T00:00:00.000Z', viewerVoteOptionId: null, endsAt: null };
const server = setupServer();

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><SessionProvider><MemoryRouter><SearchPage /></MemoryRouter></SessionProvider></QueryClientProvider>);
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); sessionStorage.clear(); vi.restoreAllMocks(); });
afterAll(() => server.close());

test.each(['query', 'type', 'sort'])('ignores an old search response when %s changes and permits a new search', async (field) => {
  let release!: (response: Response) => void;
  let searches = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (String(url) === '/auth/me') return Promise.resolve(Response.json({ user: currentUser }));
    searches += 1;
    if (searches === 1) return new Promise((resolve) => { release = resolve; });
    return Promise.resolve(Response.json({ items: [{ type: 'poll', score: 1, poll: { ...poll, id: 'fresh-poll', question: 'Fresh result?' } }], nextCursor: null }));
  });
  const user = userEvent.setup();
  renderPage();
  await user.type(screen.getByLabelText('Search'), 'climate');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(searches).toBe(1));
  if (field === 'query') { await user.clear(screen.getByLabelText('Search')); await user.type(screen.getByLabelText('Search'), 'energy'); }
  if (field === 'type') await user.click(screen.getByRole('tab', { name: 'Polls' }));
  if (field === 'sort') await user.selectOptions(screen.getByLabelText('Sort'), 'newest');
  expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Fresh result?')).toBeInTheDocument();
  await act(async () => { release(Response.json({ items: [{ type: 'poll', score: 1, poll }], nextCursor: null })); });
  expect(screen.queryByText('Climate action?')).not.toBeInTheDocument();
  expect(screen.getByText('Fresh result?')).toBeInTheDocument();
});

test('renders the shared search page structure', async () => {
  server.use(http.get('/auth/me', () => HttpResponse.json({ user: currentUser })));
  renderPage();

  expect(await screen.findByRole('main')).toHaveClass('search-page');
  expect(screen.getByRole('search')).toHaveClass('search-panel');
  expect(screen.getByRole('tablist', { name: 'Search result type' })).toHaveClass('segmented-tabs');
  expect(screen.queryByText('Loading polls…')).not.toBeInTheDocument();
  expect(screen.queryByText('Loading people…')).not.toBeInTheDocument();
});

test('submits a validated poll search and keeps the entered query after a request error', async () => {
  let requests = 0;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/search', ({ request }) => {
      requests += 1;
      expect(new URL(request.url).search).toBe('?q=climate&type=polls&sort=relevance&limit=20');
      return requests === 1
        ? HttpResponse.json({ items: [{ type: 'poll', score: 1, poll }], nextCursor: null })
        : HttpResponse.json({ error: 'invalid_search', message: 'Search terms are not allowed.' }, { status: 400 });
    }),
  );
  const user = userEvent.setup();
  renderPage();

  await screen.findByLabelText('Search');
  await user.type(screen.getByLabelText('Search'), 'climate');
  await user.selectOptions(screen.getByLabelText('Result type'), 'polls');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Climate action?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Search terms are not allowed.');
  expect(screen.getByLabelText('Search')).toHaveValue('climate');
});

test('restores the submitted search context and cached results after opening a poll and returning', async () => {
  let requests = 0;
  let releaseRefresh!: (response: Response) => void;
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/search', () => {
      requests += 1;
      if (requests > 1) return new Promise<Response>((resolve) => { releaseRefresh = resolve; });
      return HttpResponse.json({ items: [{ type: 'poll', score: 1, poll }], nextCursor: null });
    }),
  );
  function BackToSearch() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate(-1)}>Back to search</button>;
  }
  const user = userEvent.setup();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter initialEntries={['/search']}>
          <Routes>
            <Route path="/search" element={<SearchPage />} />
            <Route path="/polls/:pollId" element={<BackToSearch />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );

  await user.type(await screen.findByLabelText('Search'), 'climate');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await user.click(await screen.findByRole('link', { name: 'Climate action?' }));
  expect(await screen.findByRole('button', { name: 'Back to search' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back to search' }));

  expect(await screen.findByRole('link', { name: 'Climate action?' })).toBeInTheDocument();
  expect(screen.getByLabelText('Search')).toHaveValue('climate');
  expect(screen.getByLabelText('Result type')).toHaveValue('all');
  await waitFor(() => expect(requests).toBe(2));
  expect(screen.getByRole('link', { name: 'Climate action?' })).toBeInTheDocument();
  await act(async () => releaseRefresh(Response.json({ items: [{ type: 'poll', score: 1, poll }], nextCursor: null })));
});
