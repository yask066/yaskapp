import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
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

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter initialEntries={['/polls/poll-1']}>
          <Routes><Route path="/polls/:pollId" element={<PollDetailPage />} /></Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  ) };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
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

test('shows a Login link instead of a comment text area for anonymous visitors', async () => {
  server.use(
    http.get('/polls/poll-1', () => HttpResponse.json({ poll })),
    http.get('/polls/poll-1/comments', () => HttpResponse.json({ items: comments })),
  );

  renderDetail();

  expect(await screen.findByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login?next=%2Fpolls%2Fpoll-1');
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
