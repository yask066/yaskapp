import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
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
afterEach(() => { server.resetHandlers(); sessionStorage.clear(); });
afterAll(() => server.close());

test('renders the shared search page structure', async () => {
  server.use(http.get('/auth/me', () => HttpResponse.json({ user: currentUser })));
  renderPage();

  expect(await screen.findByRole('main')).toHaveClass('search-page');
  expect(screen.getByRole('search')).toHaveClass('search-panel');
  expect(screen.getByRole('tablist', { name: 'Search result type' })).toHaveClass('segmented-tabs');
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
