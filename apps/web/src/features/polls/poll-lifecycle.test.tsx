import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { SessionProvider, useSession } from '../../app/session-provider';
import { NotificationProvider } from '../notifications/notification-store';
import type { RealtimeWebSocket } from '../notifications/realtime-client';
import type { Poll } from '../../api/models';
import { FeedPage } from '../feed/FeedPage';
import { usePollMutations } from './usePollMutations';

const user = { id: 'viewer', email: 'member@example.com', username: 'member', status: 'active', profile: { displayName: 'Member', pollsCount: 0, followersCount: 0, followingCount: 0, countryCode: 'BY', bio: null, avatarObjectKey: null, avatarUrl: null } };
const poll = { id: 'poll-1', author: { id: 'author', username: 'author', displayName: 'Author', avatarObjectKey: null, avatarUrl: null }, question: 'Question?', imageUrl: null, options: [], votesCount: 0, likesCount: 0, commentsCount: 0, viewerHasLiked: false, viewerVoteOptionId: null, allowVoteCancellation: true, createdAt: '2026-01-01T00:00:00Z', endsAt: null, stateRevisions: { votes: '0', likes: '0', comments: '0' } } satisfies Poll;

function Probe() { const session = useSession(); return <output>{session.status}</output>; }
function Controls() {
  const session = useSession();
  return <><output>{session.user?.id ?? 'anonymous'}</output><button onClick={() => session.signOut()}>Sign out</button><button onClick={() => { void session.signIn({ login: 'second', password: 'password' }); }}>Sign in</button></>;
}
function MutationProbe() {
  const mutations = usePollMutations();
  return <><button onClick={() => mutations.toggleLike({ pollId: poll.id, viewerHasLiked: false })}>Like</button><output data-testid="mutation-error">{mutations.error}</output><output>{mutations.isLiking(poll.id) ? 'pending' : 'idle'}</output></>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); focusManager.setFocused(undefined); onlineManager.setOnline(true); });

test('does not show a previous viewer mutation error after logout/relogin', async () => {
  let release!: (response: Response) => void;
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (String(url).endsWith('/likes')) return new Promise((resolve) => { release = resolve; });
    if (String(url) === '/auth/logout') return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(Response.json({ user: String(url) === '/auth/login' ? { ...user, id: 'second' } : user }));
  });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><SessionProvider><Controls /><MutationProbe /></SessionProvider></QueryClientProvider>);
  await screen.findByText('viewer');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Like' })); });
  expect(screen.getByText('pending')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
  await screen.findByText('second');
  await act(async () => { release(Response.json({ poll: { ...poll, viewerHasLiked: true } })); });
  expect(screen.getByText('idle')).toBeInTheDocument();
  expect(screen.getByTestId('mutation-error')).toBeEmptyDOMElement();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  view.unmount(); client.clear();
});

test('logout/relogin ignores the previous viewer read even when transport ignores abort', async () => {
  let release!: (response: Response) => void;
  let reads = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const path = String(url);
    if (path === '/auth/me') return Promise.resolve(Response.json({ user }));
    if (path === '/auth/logout') return Promise.resolve(new Response(null, { status: 204 }));
    if (path === '/auth/login') return Promise.resolve(Response.json({ user: { ...user, id: 'second' } }));
    if (path.startsWith('/users')) return Promise.resolve(Response.json({ items: [] }));
    expect(path).toBe('/polls?limit=20');
    reads += 1;
    if (reads === 1) return new Promise((resolve) => { release = resolve; });
    return Promise.resolve(Response.json({ items: [{ ...poll, likesCount: 1, stateRevisions: { ...poll.stateRevisions, likes: '1' } }] }));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><SessionProvider><MemoryRouter><Controls /><FeedPage /></MemoryRouter></SessionProvider></QueryClientProvider>);
  await waitFor(() => expect(reads).toBe(1));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); });
  await screen.findByText('anonymous');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
  await screen.findByText('second');
  await screen.findByRole('button', { name: 'Like (1)' });
  await act(async () => { release(Response.json({ items: [{ ...poll, likesCount: 50, viewerHasLiked: true, stateRevisions: { ...poll.stateRevisions, likes: '50' } }] })); });
  expect(screen.getByRole('button', { name: 'Like (1)' })).toHaveAttribute('aria-pressed', 'false');
  expect(client.getQueryData<Poll[]>(['polls', 'for-you'])?.[0]).toMatchObject({ likesCount: 1, viewerHasLiked: false });
  view.unmount(); client.clear();
});

test.each(['foreground', 'online', 'connection.ready'])('reconciles cached Poll by HTTP on %s and cleans up after unmount', async (trigger) => {
  const sockets: RealtimeWebSocket[] = [];
  vi.stubGlobal('WebSocket', class {
    readyState = 1; onopen = null; onmessage = null; onerror = null; onclose = null;
    send() {} close() {}
    constructor() { sockets.push(this); }
  });
  let reads = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (String(url) === '/auth/me') return Promise.resolve(Response.json({ user }));
    if (String(url).startsWith('/notifications')) return Promise.resolve(Response.json({ items: [], unreadCount: 0, nextCursor: null }));
    expect(String(url)).toBe('/polls/poll-1');
    reads += 1;
    return Promise.resolve(Response.json({ poll: { ...poll, likesCount: 1, viewerHasLiked: true, stateRevisions: { ...poll.stateRevisions, likes: '1' } } }));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><SessionProvider><NotificationProvider><Probe /></NotificationProvider></SessionProvider></QueryClientProvider>);
  await screen.findByText('authenticated');
  client.setQueryData(['polls'], [poll]);
  const resume = () => {
    if (trigger === 'foreground') { focusManager.setFocused(false); focusManager.setFocused(true); }
    if (trigger === 'online') { onlineManager.setOnline(false); onlineManager.setOnline(true); }
    if (trigger === 'connection.ready') sockets[0].onmessage?.({ data: JSON.stringify({ version: 1, type: 'connection.ready' }) });
  };
  await act(async () => { resume(); resume(); });
  await waitFor(() => expect(client.getQueryData<Poll[]>(['polls'])?.[0]).toMatchObject({ likesCount: 1, viewerHasLiked: true }));
  expect(reads).toBe(1);
  view.unmount();
  const afterUnmount = reads;
  await act(async () => { resume(); });
  expect(reads).toBe(afterUnmount);
  client.clear();
});
