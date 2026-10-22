import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider, useSession } from './session-provider';
import { saveAccountDeletionReceipt } from '../features/account-deletion/account-deletion-receipt';
import { paginationQueryKey } from '../core/pagination/pagination-state';

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
    <output data-testid="deletion-pending">{String(session.accountDeletionPending)}</output>
    <output data-testid="receipt-expired">{String(session.accountDeletionReceiptExpired)}</output>
    <button type="button" onClick={() => session.signOut()}>Sign out</button>
    <button type="button" onClick={() => { void session.completeAccountDeletion(); }}>Complete deletion</button>
    <button type="button" onClick={() => { void session.setAccountDeletionPending(true); }}>Lock for deletion</button>
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
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
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

  it('does not restore infinite poll pages or viewer state from a prior account after logout and login', async () => {
    const secondUser = { ...user, id: 'user-2', username: 'second' };
    server.use(
      http.get('/auth/me', () => HttpResponse.json({ user })),
      http.post('/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.post('/auth/login', () => HttpResponse.json({ user: secondUser })),
    );
    const { queryClient } = renderSession();
    await screen.findByText('member');
    const firstAccountKey = paginationQueryKey({ surface: 'feed', sessionEpoch: 0, userId: user.id, sort: 'newest' });
    queryClient.setQueryData(firstAccountKey, {
      pages: [{ items: [{ id: 'poll-1', viewerState: { hasLiked: true } }], nextCursor: 'cursor-1', paginationSupported: true }],
      pageParams: [undefined],
    });

    await act(async () => { screen.getByRole('button', { name: 'Sign out' }).click(); });
    expect(queryClient.getQueryData(firstAccountKey)).toBeUndefined();

    await act(async () => { screen.getByRole('button', { name: 'Sign in' }).click(); });
    expect(await screen.findByText('second')).toBeInTheDocument();
    expect(queryClient.getQueryData(firstAccountKey)).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
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

  it('clears auth queries and browser caches when account deletion is accepted', async () => {
    server.use(http.get('/auth/me', () => HttpResponse.json({ user })));
    const { queryClient } = renderSession();
    queryClient.setQueryData(['profile', 'private'], { displayName: 'Private profile' });
    sessionStorage.setItem('private-route', 'profile');
    await screen.findByText('member');

    await act(async () => { screen.getByRole('button', { name: 'Complete deletion' }).click(); });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
    expect(queryClient.getQueryData(['profile', 'private'])).toBeUndefined();
    expect(sessionStorage.getItem('private-route')).toBeNull();
  });

  it('locks account views and clears in-flight query data while acceptance is uncertain', async () => {
    server.use(http.get('/auth/me', () => HttpResponse.json({ user })));
    const { queryClient } = renderSession();
    await screen.findByText('member');
    queryClient.setQueryData(['profile', 'private'], { displayName: 'Private profile' });

    await act(async () => { screen.getByRole('button', { name: 'Lock for deletion' }).click(); });

    expect(screen.getByTestId('deletion-pending')).toHaveTextContent('true');
    expect(screen.getByText('anonymous')).toBeInTheDocument();
    expect(queryClient.getQueryData(['profile', 'private'])).toBeUndefined();
  });

  it('restores the private-route lock from a saved receipt after reload', async () => {
    saveAccountDeletionReceipt({ operationId: 'operation-1', statusToken: 'status-secret', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
    const restoreRequest = vi.fn(() => HttpResponse.json({ user }));
    server.use(http.get('/auth/me', restoreRequest));

    renderSession();

    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(screen.getByTestId('deletion-pending')).toHaveTextContent('true');
    expect(restoreRequest).not.toHaveBeenCalled();
  });

  it('restores an expired receipt as a locked cleanup state without restoring the old session', async () => {
    vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
    saveAccountDeletionReceipt({ operationId: 'operation-1', statusToken: 'expired-secret', expiresAt: '2026-10-15T10:00:00.000Z' });
    const restoreRequest = vi.fn(() => HttpResponse.json({ user }));
    server.use(http.get('/auth/me', restoreRequest));

    renderSession();

    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(screen.getByTestId('deletion-pending')).toHaveTextContent('true');
    expect(screen.getByTestId('receipt-expired')).toHaveTextContent('true');
    expect(restoreRequest).not.toHaveBeenCalled();
  });

  it('does not restore an account query that resolves after deletion cleanup', async () => {
    server.use(http.get('/auth/me', () => HttpResponse.json({ user })));
    const { queryClient } = renderSession();
    let resolveLate!: (value: { displayName: string }) => void;
    const lateQuery = queryClient.fetchQuery({ queryKey: ['profile', 'late'], queryFn: () => new Promise<{ displayName: string }>((resolve) => { resolveLate = resolve; }) });
    void lateQuery.catch(() => undefined);
    await waitFor(() => expect(resolveLate).toBeDefined());
    await screen.findByText('member');

    await act(async () => { screen.getByRole('button', { name: 'Complete deletion' }).click(); });
    resolveLate({ displayName: 'Deleted account data' });

    await Promise.resolve();
    expect(queryClient.getQueryData(['profile', 'late'])).toBeUndefined();
  });

  it('clears the current session when another tab announces deletion', async () => {
    server.use(http.get('/auth/me', () => HttpResponse.json({ user })));
    vi.stubGlobal('BroadcastChannel', undefined);
    const { queryClient } = renderSession();
    await screen.findByText('member');
    queryClient.setQueryData(['profile', 'private'], { displayName: 'Member' });

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'yask.account-deletion.event',
        newValue: JSON.stringify({ type: 'account.deleted', nonce: 'from-other-tab' }),
      }));
    });

    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
    expect(queryClient.getQueryData(['profile', 'private'])).toBeUndefined();
  });
});
