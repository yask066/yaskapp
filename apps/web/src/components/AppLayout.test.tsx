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

function renderLayout(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<main id="main-content">Feed</main>} />
          <Route path="*" element={<main id="main-content">Page</main>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

test('renders the documentation-style shell with one retained branding image', () => {
  const { container } = renderLayout();

  expect(container.querySelector('.app-shell')).toBeInTheDocument();
  expect(container.querySelectorAll('img[src^="/branding/"]')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Yaskapp' })).toContainElement(container.querySelector('img[src="/branding/yaskapp_logo.png"]'));
  expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toHaveClass('app-sidebar-navigation');
});

test('marks only the current primary destination', () => {
  renderLayout('/search');

  const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(navigation).getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
  expect(within(navigation).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
});

test('provides keyboard-native account navigation and sign out controls', async () => {
  const user = userEvent.setup();

  renderLayout();

  const accountNavigation = screen.getByRole('navigation', { name: 'Account navigation' });
  expect(within(accountNavigation).getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/me');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  await user.click(within(accountNavigation).getByRole('button', { name: 'Sign out' }));
  expect(signOut).toHaveBeenCalledOnce();
});

test('provides the reference-style Home destination to signed-in members', () => {
  renderLayout();

  const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(primaryNavigation).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  expect(within(primaryNavigation).getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/search');
  expect(within(primaryNavigation).getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/me');
});

test('keeps the reference sidebar focused on navigation and poll creation', () => {
  renderLayout();

  const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(primaryNavigation).getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Popular topics' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Create poll/i })).toHaveLength(1);
  expect(screen.getByRole('link', { name: /Create poll/i })).toHaveAttribute('href', '/polls/new');
});

test('uses the reference icon set for authenticated navigation', () => {
  renderLayout();

  expect(screen.getByRole('link', { name: 'Yaskapp' }).querySelector('img[src="/branding/yaskapp_logo.png"]')).toBeInTheDocument();
  const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(primaryNavigation.querySelector('[data-icon="home"]')).toBeInTheDocument();
  expect(primaryNavigation.querySelector('[data-icon="explore"]')).toBeInTheDocument();
  expect(primaryNavigation.querySelector('[data-icon="notifications_none"]')).toBeInTheDocument();
  expect(within(primaryNavigation).getByRole('link', { name: 'Profile' }).querySelector('.avatar')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create poll' }).querySelector('[data-icon="add"]')).toBeInTheDocument();
});

test('keeps footer links in the discovery rail instead of the left navigation', () => {
  renderLayout();

  expect(screen.queryByText('© 2025 Yask')).not.toBeInTheDocument();
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
