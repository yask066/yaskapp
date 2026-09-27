// @vitest-environment node
import { File } from 'node:buffer';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createComment, createPoll, getComment, listCommentReplies } from './polls';
import { decodePollComment } from './models';

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

const comment = {
  id: 'comment-1', pollId: 'poll-1', author: poll.author, body: 'A reply.', likesCount: 0,
  viewerHasLiked: false, createdAt: '2026-09-06T12:01:00.000Z', updatedAt: '2026-09-06T12:01:00.000Z',
};

test('decodes reply fields and defaults missing rollout fields', () => {
  expect(decodePollComment(comment)).toMatchObject({ parentCommentId: null, repliesCount: 0 });
  expect(decodePollComment({ ...comment, parentCommentId: 'root-1', repliesCount: 2 }))
    .toMatchObject({ parentCommentId: 'root-1', repliesCount: 2 });
});

test('lists cursor-paginated replies using cookie-backed API requests', async () => {
  const reply = { ...comment, parentCommentId: 'root-1' };
  server.use(http.get('http://localhost/polls/poll-1/comments/root-1/replies', ({ request }) => {
    expect(request.credentials).toBe('include');
    expect(request.headers.get('authorization')).toBeNull();
    expect(new URL(request.url).search).toBe('?limit=3&cursor=next-page');
    return HttpResponse.json({ items: [reply], nextCursor: null });
  }));

  await expect(listCommentReplies('poll-1', 'root-1', { limit: 3, cursor: 'next-page' }))
    .resolves.toMatchObject({ items: [{ id: 'comment-1', parentCommentId: 'root-1' }], nextCursor: null });
});

test('loads an individual comment target through the existing cookie-backed route', async () => {
  const reply = { ...comment, parentCommentId: 'root-1' };
  server.use(http.get('http://localhost/polls/poll-1/comments/comment-1', ({ request }) => {
    expect(request.credentials).toBe('include');
    expect(request.headers.get('authorization')).toBeNull();
    return HttpResponse.json({ comment: reply });
  }));

  await expect(getComment('poll-1', 'comment-1')).resolves.toMatchObject({
    id: 'comment-1', parentCommentId: 'root-1',
  });
});

test('creates replies with parentCommentId while preserving the root comment body', async () => {
  const reply = { ...comment, parentCommentId: 'root-1' };
  server.use(http.post('http://localhost/polls/poll-1/comments', async ({ request }) => {
    expect(request.credentials).toBe('include');
    expect(request.headers.get('authorization')).toBeNull();
    expect(await request.json()).toEqual({ body: 'A reply.', parentCommentId: 'root-1' });
    return HttpResponse.json({ comment: reply, poll: { ...poll, commentsCount: 3 } }, { status: 201 });
  }));

  await expect(createComment('poll-1', 'A reply.', 'root-1')).resolves.toMatchObject({
    comment: { id: 'comment-1', parentCommentId: 'root-1' },
    poll: { commentsCount: 3 },
  });
});
