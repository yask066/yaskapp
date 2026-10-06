import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { SessionProvider } from '../../app/session-provider';
import { listScrollState } from '../../core/scroll/list-scroll-state';
import { PublicProfilePage } from './PublicProfilePage';

const poll = {
  id: 'profile-poll',
  author: { id: 'profile-user', username: 'profile', displayName: 'Profile', avatarObjectKey: null, avatarUrl: null },
  question: 'A poll from this profile?', imageUrl: null, options: [], votesCount: 0, commentsCount: 0,
  likesCount: 0, viewerHasLiked: false, allowVoteCancellation: true,
  createdAt: '2026-09-06T12:00:00.000Z', viewerVoteOptionId: null, endsAt: null,
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); sessionStorage.clear(); listScrollState.clear(); vi.restoreAllMocks(); });
afterAll(() => server.close());

test('restores the public-profile poll anchor and focus after opening a poll and returning', async () => {
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    http.get('/users/profile-user', () => HttpResponse.json({ user: {
      id: 'profile-user', username: 'profile', status: 'active', viewerIsFollowing: false,
      profile: { displayName: 'Profile', pollsCount: 1, followersCount: 0, followingCount: 0, countryCode: null, bio: null, avatarObjectKey: null, avatarUrl: null },
    } })),
    http.get('/users/profile-user/polls', () => HttpResponse.json({ items: [poll] })),
  );
  let anchorTop = 110;
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.listItemId === 'profile-poll') {
      return { x: 0, y: anchorTop, top: anchorTop, left: 0, right: 640, bottom: anchorTop + 240, width: 640, height: 240, toJSON: () => ({}) };
    }
    return originalRect.call(this);
  });
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2000);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  function BackToProfile() {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate(-1)}>Back to profile</button>;
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <MemoryRouter initialEntries={['/users/profile-user']}>
          <Routes>
            <Route path="/users/:userId" element={<PublicProfilePage />} />
            <Route path="/polls/:pollId" element={<BackToProfile />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );

  await screen.findByText('A poll from this profile?');
  window.dispatchEvent(new Event('scroll'));
  await user.click(screen.getByRole('link', { name: 'A poll from this profile?' }));
  expect(await screen.findByRole('button', { name: 'Back to profile' })).toBeInTheDocument();
  anchorTop = 190;
  await user.click(screen.getByRole('button', { name: 'Back to profile' }));

  const restoredPoll = await screen.findByText('A poll from this profile?');
  expect(scrollTo).toHaveBeenCalledWith({ top: 80, behavior: 'auto' });
  expect(document.activeElement).toBe(restoredPoll.closest('[data-list-item-id]'));
});
