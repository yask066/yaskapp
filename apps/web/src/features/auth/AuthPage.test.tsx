import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { AuthPage } from './AuthPage';

const signIn = vi.fn();

vi.mock('../../app/session-provider', () => ({
  useSession: () => ({
    status: 'anonymous',
    user: null,
    signIn,
    register: vi.fn(),
    signOut: vi.fn(),
  }),
}));

afterEach(() => {
  signIn.mockReset();
  signIn.mockResolvedValue(undefined);
});

test('submitting Login and Password signs in and returns to the feed', async () => {
  const user = userEvent.setup();

  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/" element={<h1>Feed</h1>} />
      </Routes>
    </MemoryRouter>,
  );

  await user.type(screen.getByLabelText('Login'), 'member@example.com');
  await user.type(screen.getByLabelText('Password'), 'passphrase');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(signIn).toHaveBeenCalledWith({ login: 'member@example.com', password: 'passphrase' });
  expect(await screen.findByRole('heading', { name: 'Feed' })).toBeInTheDocument();
});

test('rejects a protocol-relative next destination after sign in', async () => {
  const user = userEvent.setup();

  render(
    <MemoryRouter initialEntries={['/login?next=//example.com']}>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/" element={<h1>Feed</h1>} />
      </Routes>
    </MemoryRouter>,
  );

  await user.type(screen.getByLabelText('Login'), 'member@example.com');
  await user.type(screen.getByLabelText('Password'), 'passphrase');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByRole('heading', { name: 'Feed' })).toBeInTheDocument();
});

test('lets a member reveal and conceal their password', async () => {
  const user = userEvent.setup();

  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
      </Routes>
    </MemoryRouter>,
  );

  const password = screen.getByLabelText('Password');
  expect(password).toHaveAttribute('type', 'password');

  await user.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password).toHaveAttribute('type', 'text');

  await user.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password).toHaveAttribute('type', 'password');
});

test('uses the mobile PNG logo in the authentication header', () => {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(screen.getByRole('link', { name: 'Yask home' }).querySelector('img[src="/branding/yaskapp_logo.png"]')).toBeInTheDocument();
});

test('uses a focused auth form composition without the showcase', () => {
  const { container } = render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes><Route path="/login" element={<AuthPage mode="login" />} /></Routes>
    </MemoryRouter>,
  );

  expect(container.querySelector('main.auth-page')).toBeInTheDocument();
  expect(container.querySelector('.auth-showcase')).not.toBeInTheDocument();
  expect(screen.getByRole('form')).toHaveClass('form-panel');
});
