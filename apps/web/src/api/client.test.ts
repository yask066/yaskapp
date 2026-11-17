import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { ApiClient, apiClient } from './client';
import { vote } from './polls';

const poll = {
  id: 'poll-1',
  author: { id: 'author-1', username: 'author', displayName: 'Author' },
  question: 'Which option?',
  imageUrl: null,
  options: [{ id: 'option-1', text: 'First', position: 0, votesCount: 3 }],
  votesCount: 3,
  commentsCount: 0,
  likesCount: 2,
  viewerHasLiked: false,
  allowVoteCancellation: false,
  createdAt: '2026-09-06T12:00:00.000Z',
  viewerVoteOptionId: null,
  endsAt: null,
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => server.close());

describe('API client', () => {
  it('read_timeout_then_retry_ignores_old_response, including a late 401', async () => {
    vi.useFakeTimers();
    const client = new ApiClient();
    const unauthorized = vi.fn();
    const decode = vi.fn((body: unknown) => body);
    client.setOnUnauthorized(unauthorized);
    let release!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise((resolve) => { release = resolve; });
    }).mockResolvedValueOnce(Response.json({ value: 'fresh' }));
    const first = client.get('/polls', decode).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(9999);
    expect(signal?.aborted ?? false).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // Observe the deadline before releasing a transport that ignores abort.
    let error: unknown;
    void first.then((value) => { error = value; });
    await Promise.resolve();
    expect(error).toMatchObject({ code: 'read_timeout' });
    expect(signal?.aborted).toBe(true);
    await expect(client.get('/polls', decode)).resolves.toEqual({ value: 'fresh' });
    release(Response.json({ value: 'stale' }, { status: 401 }));
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds response body reading and cancels without decoding a late body', async () => {
    vi.useFakeTimers();
    const client = new ApiClient();
    let release!: (value: unknown) => void;
    const response = Response.json({});
    vi.spyOn(response, 'json').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const decode = vi.fn((body: unknown) => body);
    let error: unknown;
    const request = client.get('/polls', decode).catch((value: unknown) => { error = value; });
    await vi.advanceTimersByTimeAsync(10000);
    expect(error).toMatchObject({ code: 'read_timeout' });
    release({ stale: true });
    await request;
    await vi.advanceTimersByTimeAsync(0);
    expect(decode).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up caller cancellation even when fetch ignores abort', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => undefined));
    let error: unknown;
    const request = apiClient.send('/polls', { method: 'GET', signal: controller.signal }, (value) => value)
      .catch((value: unknown) => { error = value; });
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toMatchObject({ code: 'request_cancelled' });
    expect(vi.getTimerCount()).toBe(0);
    // Only await after checking prompt cancellation; otherwise the regression hangs.
    if (error) await request;
  });

  it('does not impose the read deadline on mutations', async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise((resolve) => { release = resolve; });
    });
    const request = apiClient.send('/polls/poll-1/likes', { method: 'POST' }, (body) => body);
    await vi.advanceTimersByTimeAsync(12000);
    expect(signal?.aborted ?? false).toBe(false);
    release(Response.json({ saved: true }));
    await expect(request).resolves.toEqual({ saved: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends browser credentials and decodes a poll returned by a JSON request', async () => {
    server.use(
      http.post('/polls/poll-1/votes', async ({ request }) => {
        expect(request.credentials).toBe('include');
        expect(request.headers.get('authorization')).toBeNull();
        expect(request.headers.get('content-type')).toContain('application/json');
        await expect(request.json()).resolves.toEqual({ optionId: 'option-1' });
        return HttpResponse.json({ poll });
      }),
    );

    await expect(vote('poll-1', 'option-1')).resolves.toMatchObject({
      id: 'poll-1',
      question: 'Which option?',
      options: [{ id: 'option-1', votesCount: 3 }],
    });
  });

  it('maps API error payloads to ApiError', async () => {
    server.use(
      http.post('/polls/poll-1/votes', () =>
        HttpResponse.json(
          { error: 'poll_closed', message: 'This poll is closed.' },
          { status: 422 },
        ),
      ),
    );

    await expect(vote('poll-1', 'option-1')).rejects.toMatchObject({
      status: 422,
      code: 'poll_closed',
      message: 'This poll is closed.',
    });
  });

  it('rejects malformed successful payloads at the API boundary', async () => {
    server.use(http.post('/polls/poll-1/votes', () => HttpResponse.json({ poll: { id: 'poll-1' } })));

    await expect(vote('poll-1', 'option-1')).rejects.toMatchObject({
      status: 502,
      code: 'invalid_response',
    });
  });

  it('does not label non-JSON request bodies as JSON', async () => {
    server.use(
      http.post('/uploads', ({ request }) => {
        expect(request.headers.get('content-type')).not.toContain('application/json');
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(apiClient.send('/uploads', { method: 'POST', body: new URLSearchParams({ name: 'file' }) }, () => undefined)).resolves.toBeUndefined();
  });
});
