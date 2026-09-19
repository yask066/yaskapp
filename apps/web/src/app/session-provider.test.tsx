import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
});
afterAll(() => server.close());

describe('SessionProvider', () => {
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
