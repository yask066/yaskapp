import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider, useSession } from './session-provider';

const user = {
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

const server = setupServer();

function SessionProbe() {
  const session = useSession();
  return <>
    <output>{session.status === 'authenticated' && session.user ? session.user.username : session.status}</output>
    <button type="button" onClick={() => session.signOut()}>Sign out</button>
    <button type="button" onClick={() => { void session.signIn({ login: 'second', password: 'password' }).catch(() => undefined); }}>Sign in</button>
  </>;
}

function renderSession() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>
    </QueryClientProvider>,
    ),
    queryClient,
  };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe('SessionProvider', () => {
  it('leaves loading when login fails after cancelling an unfinished restore', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url) === '/auth/me') return new Promise(() => undefined);
      return Promise.resolve(Response.json({ error: 'server_error' }, { status: 503 }));
    });
    renderSession();
    await act(async () => { screen.getByRole('button', { name: 'Sign in' }).click(); });
    expect(screen.getByText('anonymous')).toBeInTheDocument();
  });
  it.each([200, 401])('does not apply an old restore response (%s) after signing in as another user', async (status) => {
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url) === '/auth/me') return new Promise((resolve) => { release = resolve; });
      return Promise.resolve(Response.json({ user: { ...user, id: 'user-2', username: 'second' } }));
    });
    const { queryClient } = renderSession();
    queryClient.setQueryData(['profile', 'someone'], { viewerIsFollowing: true });
    await act(async () => { screen.getByRole('button', { name: 'Sign in' }).click(); });
    expect(await screen.findByText('second')).toBeInTheDocument();
    await act(async () => { release(Response.json({ user }, { status })); });
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(queryClient.getQueryData(['profile', 'someone'])).toBeUndefined();
  });

  it('does not apply a login response after sign-out', async () => {
    let release!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url) === '/auth/login') return new Promise((resolve) => { release = resolve; });
      if (String(url) === '/auth/logout') return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(Response.json({ user }));
    });
    renderSession();
    await screen.findByText('member');
    await act(async () => { screen.getByRole('button', { name: 'Sign in' }).click(); });
    await act(async () => {
      screen.getByRole('button', { name: 'Sign out' }).click();
      release(Response.json({ user: { ...user, id: 'user-2', username: 'second' } }));
    });
    expect(screen.getByText('anonymous')).toBeInTheDocument();
  });

  it('restores a cookie session and loads the current user', async () => {
    server.use(
      http.get('/auth/me', ({ request }) => {
        expect(request.credentials).toBe('include');
        expect(request.headers.get('authorization')).toBeNull();
        return HttpResponse.json({ user });
      }),
    );

    renderSession();

    expect(await screen.findByText('member')).toBeInTheDocument();
  });

  it('becomes anonymous after a 401 cookie session response', async () => {
    server.use(http.get('/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })));

    const { queryClient } = renderSession();
    queryClient.setQueryData(['polls', 'newest'], [{ id: 'cached-poll' }]);

    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
    expect(queryClient.getQueryData(['polls', 'newest'])).toBeUndefined();
  });

  it('becomes anonymous when restoring the cookie session fails without a 401', async () => {
    server.use(http.get('/auth/me', () => HttpResponse.json({ error: 'server_error' }, { status: 500 })));

    renderSession();

    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
  });

  it('does not restore a completed request after the user signs out', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    server.use(
      http.post('/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.get('/auth/me', () => new Promise((resolve) => { resolveResponse = resolve; })),
    );

    renderSession();
    await waitFor(() => expect(resolveResponse).toBeDefined());
    await act(async () => {
      screen.getByRole('button', { name: 'Sign out' }).click();
      resolveResponse?.(HttpResponse.json({ user }));
      await Promise.resolve();
    });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
  });
});
