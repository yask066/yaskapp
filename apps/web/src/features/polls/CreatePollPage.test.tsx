import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { CreatePollPage } from './CreatePollPage';

vi.mock('../../app/session-provider', () => ({
  useSession: () => ({ status: 'authenticated', user: { id: 'user-1' } }),
}));

const createdPoll = {
  id: 'poll-2', author: { id: 'user-1', username: 'member', displayName: 'Member', avatarObjectKey: null, avatarUrl: null },
  question: 'Where should we meet?', imageUrl: '/media/polls/poll-2',
  options: [{ id: 'option-1', text: 'Park', position: 0, votesCount: 0 }, { id: 'option-2', text: 'Cafe', position: 1, votesCount: 0 }],
  votesCount: 0, commentsCount: 0, likesCount: 0, viewerHasLiked: false, allowVoteCancellation: true,
  createdAt: '2026-09-06T12:00:00.000Z', viewerVoteOptionId: null, endsAt: null,
};
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('prepends the returned poll before returning to the feed after creation', async () => {
  server.use(http.post('/polls', async ({ request }) => {
    expect(await request.json()).toEqual({ question: 'Where should we meet?', options: ['Park', 'Cafe'], allowVoteCancellation: true });
    return HttpResponse.json({ poll: createdPoll }, { status: 201 });
  }));
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  queryClient.setQueryData(['polls', 'newest'], []);
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/polls/new']}>
        <Routes>
          <Route path="/polls/new" element={<CreatePollPage />} />
          <Route path="/" element={<h1>Feed</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.type(screen.getByLabelText('Question'), 'Where should we meet?');
  await user.type(screen.getByLabelText('Option 1'), 'Park');
  await user.type(screen.getByLabelText('Option 2'), 'Cafe');
  await user.click(screen.getByRole('button', { name: 'Create poll' }));

  expect(await screen.findByRole('heading', { name: 'Feed' })).toBeInTheDocument();
  await waitFor(() => expect(queryClient.getQueryData<typeof createdPoll[]>(['polls', 'newest'])?.[0]).toEqual(createdPoll));
});
