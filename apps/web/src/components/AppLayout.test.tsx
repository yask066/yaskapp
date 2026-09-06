import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { AppLayout } from './AppLayout';

const signOut = vi.fn();

vi.mock('../app/session-provider', () => ({
  useSession: () => ({
    status: 'authenticated',
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
    signOut,
  }),
}));

afterEach(() => signOut.mockReset());

test('provides keyboard-native account navigation and sign out controls', async () => {
  const user = userEvent.setup();

  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<main id="main-content">Feed</main>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

  const accountNavigation = screen.getByRole('navigation', { name: 'Account navigation' });
  expect(within(accountNavigation).getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  await user.click(within(accountNavigation).getByRole('button', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalledOnce();
});
