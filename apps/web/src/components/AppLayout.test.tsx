import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { AppLayout } from './AppLayout';

const signOut = vi.fn();
const authenticatedUser = {
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
};
let sessionStatus = 'authenticated';
let sessionUser: typeof authenticatedUser | null = authenticatedUser;

vi.mock('../app/session-provider', () => ({
  useSession: () => ({
    status: sessionStatus,
    user: sessionUser,
    signOut,
  }),
}));

afterEach(() => {
  signOut.mockReset();
  sessionStatus = 'authenticated';
  sessionUser = authenticatedUser;
});

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<main id="main-content">Feed</main>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

test('provides keyboard-native account navigation and sign out controls', async () => {
  const user = userEvent.setup();

  renderLayout();

  const accountNavigation = screen.getByRole('navigation', { name: 'Account navigation' });
  expect(within(accountNavigation).getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  await user.click(within(accountNavigation).getByRole('button', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalledOnce();
});

test('omits the empty primary navigation for anonymous and loading sessions', () => {
  sessionStatus = 'anonymous';
  sessionUser = null;
  const { unmount } = renderLayout();
  expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument();
  unmount();

  sessionStatus = 'loading';
  renderLayout();
  expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument();
});
