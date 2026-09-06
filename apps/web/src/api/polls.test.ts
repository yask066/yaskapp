// @vitest-environment node
import { File } from 'node:buffer';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createPoll } from './polls';

const poll = {
  id: 'poll-1', author: { id: 'user-1', username: 'member', displayName: 'Member', avatarObjectKey: null, avatarUrl: null },
  question: 'Where should we meet?', imageUrl: '/media/polls/poll-1',
  options: [{ id: 'option-1', text: 'Park', position: 0, votesCount: 0 }, { id: 'option-2', text: 'Cafe', position: 1, votesCount: 0 }],
  votesCount: 0, commentsCount: 0, likesCount: 0, viewerHasLiked: false, allowVoteCancellation: true,
  createdAt: '2026-09-06T12:00:00.000Z', viewerVoteOptionId: null, endsAt: null,
};
const server = setupServer();

beforeAll(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost');
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

test('sends an image poll as FormData without manually setting a multipart content type', async () => {
  server.use(http.post('http://localhost/polls', async ({ request }) => {
    expect(request.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    const body = await request.formData();
    expect(body.get('question')).toBe('Where should we meet?');
    expect(body.get('options')).toBe(JSON.stringify(['Park', 'Cafe']));
    expect(body.get('allowVoteCancellation')).toBe('true');
    expect(body.get('image')).toBeInstanceOf(File);
    return HttpResponse.json({ poll }, { status: 201 });
  }));

  const image = new File(['image'], 'poll.png', { type: 'image/png' }) as unknown as globalThis.File;
  await expect(createPoll({ question: 'Where should we meet?', options: ['Park', 'Cafe'], allowVoteCancellation: true, image })).resolves.toEqual(poll);
});
