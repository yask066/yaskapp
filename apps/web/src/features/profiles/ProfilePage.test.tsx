import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { apiClient } from '../../api/client';
import { uploadAvatar } from '../../api/profiles';
import { AppLayout } from '../../components/AppLayout';
import { SessionProvider } from '../../app/session-provider';
import { MyProfilePage } from './MyProfilePage';
import { PublicProfilePage } from './PublicProfilePage';

const author = { id: 'user-2', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null };
const profile = {
  id: 'user-2', username: 'author', status: 'active', viewerIsFollowing: false,
  profile: { displayName: 'Author', pollsCount: 1, followersCount: 4, followingCount: 2, countryCode: 'BY', bio: 'Writes polls.', avatarObjectKey: null, avatarUrl: null },
};
const poll = { id: 'poll-1', author, question: 'Which option?', imageUrl: null, options: [{ id: 'option-1', text: 'One', position: 0, votesCount: 1 }, { id: 'option-2', text: 'Two', position: 1, votesCount: 0 }], votesCount: 1, commentsCount: 0, likesCount: 0, viewerHasLiked: false, allowVoteCancellation: true, createdAt: '2026-09-01T00:00:00.000Z', viewerVoteOptionId: null, endsAt: null };
const currentUser = { id: 'user-1', email: 'member@example.com', username: 'member', status: 'active', profile: { displayName: 'Member', pollsCount: 0, followersCount: 0, followingCount: 0, countryCode: 'BY', bio: null, avatarObjectKey: null, avatarUrl: null } };
const server = setupServer();

function renderPage(path: string, element: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><SessionProvider><MemoryRouter initialEntries={[path]}><Routes><Route element={<AppLayout />}><Route path="/users/:userId" element={element} /><Route path="/me" element={element} /></Route></Routes></MemoryRouter></SessionProvider></QueryClientProvider>);
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); sessionStorage.clear(); apiClient.clearAccessToken(); });
afterAll(() => server.close());

test('renders an authored poll and replaces profile follow state with the returned relationship', async () => {
  sessionStorage.setItem('yaskapp.access-token', 'saved-token');
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.get('/users/user-2', () => HttpResponse.json({ user: profile })),
    http.get('/users/user-2/polls', () => HttpResponse.json({ items: [poll] })),
    http.post('/users/user-2/follow', () => HttpResponse.json({ following: true, followerFollowingCount: 3, followeeFollowersCount: 5 }, { status: 201 })),
  );
  const user = userEvent.setup();
  renderPage('/users/user-2', <PublicProfilePage />);

  expect(await screen.findByRole('heading', { name: 'Author' })).toBeInTheDocument();
  expect(screen.getByText('@author')).toBeInTheDocument();
  expect(screen.getByText('Which option?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Follow' }));
  expect(await screen.findByRole('button', { name: 'Following' })).toBeInTheDocument();
  expect(screen.getByText(/5 followers/)).toBeInTheDocument();
});

test('uploads an avatar and preserves edited profile fields in the authenticated session', async () => {
  sessionStorage.setItem('yaskapp.access-token', 'saved-token');
  const updatedUser = { ...currentUser, profile: { ...currentUser.profile, displayName: 'Renamed', bio: 'Updated bio.', countryCode: 'PL', avatarUrl: '/media/renamed.png' } };
  server.use(
    http.get('/auth/me', () => HttpResponse.json({ user: currentUser })),
    http.post('/profiles/me/avatar', () => HttpResponse.json({ user: updatedUser })),
    http.patch('/profiles/me', async ({ request }) => {
      expect(await request.json()).toEqual({ displayName: 'Renamed', bio: 'Updated bio.', countryCode: 'PL' });
      return HttpResponse.json({ user: updatedUser });
    }),
  );
  const user = userEvent.setup();
  renderPage('/me', <MyProfilePage />);

  const avatar = new File(['avatar'], 'avatar.png', { type: 'image/png' });
  await screen.findByLabelText('Display name');
  await user.upload(screen.getByLabelText('Avatar'), avatar);
  expect((await screen.findAllByAltText("Renamed's avatar")).length).toBeGreaterThan(0);
  await user.clear(screen.getByLabelText('Display name'));
  await user.type(screen.getByLabelText('Display name'), 'Renamed');
  await user.clear(screen.getByLabelText('Bio'));
  await user.type(screen.getByLabelText('Bio'), 'Updated bio.');
  await user.selectOptions(screen.getByLabelText('Country code'), 'PL');
  await user.click(screen.getByRole('button', { name: 'Save profile' }));

  expect(await screen.findByText('Renamed', { selector: 'span' })).toBeInTheDocument();
});

test('sends avatar uploads as FormData without a manually supplied content type', async () => {
  const send = vi.spyOn(apiClient, 'send').mockResolvedValue(currentUser);
  const avatar = new File(['avatar'], 'avatar.png', { type: 'image/png' });

  await uploadAvatar(avatar);

  expect(send).toHaveBeenCalledWith('/profiles/me/avatar', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }), expect.any(Function));
  const [, init] = send.mock.calls[0];
  expect(init.headers).toBeUndefined();
  expect((init.body as FormData).get('avatar')).toBe(avatar);
  send.mockRestore();
});
