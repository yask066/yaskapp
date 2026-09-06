import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { apiClient } from './client';
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
  apiClient.clearAccessToken();
});
afterAll(() => server.close());

describe('API client', () => {
  it('sends its bearer token and decodes a poll returned by a JSON request', async () => {
    apiClient.setAccessToken('browser-token');
    server.use(
      http.post('/polls/poll-1/votes', async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer browser-token');
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
