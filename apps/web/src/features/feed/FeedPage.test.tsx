import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { SessionProvider } from '../../app/session-provider';
import { apiClient } from '../../api/client';
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter>
          <FeedPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  sessionStorage.clear();
  apiClient.clearAccessToken();
});
afterAll(() => server.close());

test('renders polls returned from GET /polls?limit=20 with a Vote button', async () => {
  server.use(
    http.get('/polls', ({ request }) => {
      expect(new URL(request.url).searchParams.get('limit')).toBe('20');
      return HttpResponse.json({ items: [poll] });
    }),
  );

  renderFeed();

  expect(await screen.findByText('Which option?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Vote for First' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Vote for First' })).toHaveAccessibleDescription('Sign in to vote on this poll.');
  expect(screen.getByRole('button', { name: 'Comments (0)' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Comments (0)' })).toHaveAccessibleDescription('Comments are not available yet.');
});

test('renders a discovery rail alongside the feed', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  renderFeed();

  expect(await screen.findByRole('complementary', { name: 'Discover content' })).toBeInTheDocument();
  expect(screen.getByText('#Programming')).toBeInTheDocument();
});

test('waits for a restored session before loading viewer-specific polls', async () => {
  sessionStorage.setItem('yaskapp.access-token', 'saved-token');
  const requests: string[] = [];
  const viewerPoll = {
    ...poll,
    author: { ...poll.author, id: 'user-1' },
  };
  server.use(
    http.get('/auth/me', ({ request }) => {
      requests.push('me');
      expect(request.headers.get('authorization')).toBe('Bearer saved-token');
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
      expect(request.headers.get('authorization')).toBe('Bearer saved-token');
      return HttpResponse.json({ items: [viewerPoll] });
    }),
  );

  renderFeed();

  expect(await screen.findByText('You')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Vote for First' })).toBeDisabled();
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
