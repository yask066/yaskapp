import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
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
      <MemoryRouter>
        <FeedPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
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
  expect(screen.getByRole('button', { name: 'Vote' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Comments (0)' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Comments (0)' })).toHaveAccessibleDescription('Comments are not available yet.');
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
