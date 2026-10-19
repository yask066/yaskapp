import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

import { cleanupUploadedPollImage, registerPollRoutes } from './polls.routes.js';

test('poll image cleanup does not replace the original create error', async () => {
  let cleanupError: unknown;

  await assert.doesNotReject(
    cleanupUploadedPollImage('poll-images/user-1/image.webp', async () => {
      throw new Error('storage cleanup failed');
    }, (error) => {
      cleanupError = error;
    })
  );

  assert.equal((cleanupError as Error).message, 'storage cleanup failed');
});

test('failed poll image cleanup is queued for account deletion', async () => {
  let enqueuedObjectKey: string | undefined;

  const recorded = await cleanupUploadedPollImage(
    'poll-images/user-1/image.webp',
    async () => { throw new Error('storage cleanup failed'); },
    undefined,
    async (objectKey) => { enqueuedObjectKey = objectKey; }
  );

  assert.equal(recorded, true);
  assert.equal(enqueuedObjectKey, 'poll-images/user-1/image.webp');
});

test('failed poll image cleanup reports when durable enqueue also fails', async () => {
  const cleanupErrors: string[] = [];

  const recorded = await cleanupUploadedPollImage(
    'poll-images/user-1/image.webp',
    async () => { throw new Error('storage cleanup failed'); },
    (error) => { cleanupErrors.push((error as Error).message); },
    async () => { throw new Error('database unavailable'); }
  );

  assert.equal(recorded, false);
  assert.deepEqual(cleanupErrors, ['storage cleanup failed', 'database unavailable']);
});

test('invalid replies cursors use the pagination cursor error envelope', async (context) => {
  const app = Fastify();
  context.after(() => app.close());
  registerPollRoutes(app);

  const response = await app.inject({
    method: 'GET',
    url: '/polls/11111111-1111-4111-8111-111111111111/comments/33333333-3333-4333-8333-333333333333/replies?cursor=not-base64'
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    error: 'pagination_cursor_invalid',
    message: 'The pagination cursor is invalid.'
  });
});

test('overlong replies cursors use the pagination cursor error envelope', async (context) => {
  const app = Fastify();
  context.after(() => app.close());
  registerPollRoutes(app);

  for (const length of [513, 2049]) {
    const response = await app.inject({
      method: 'GET',
      url: `/polls/11111111-1111-4111-8111-111111111111/comments/33333333-3333-4333-8333-333333333333/replies?cursor=${'x'.repeat(length)}`
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'pagination_cursor_invalid',
      message: 'The pagination cursor is invalid.'
    });
  }
});

test('invalid replies limits remain ordinary validation errors', async (context) => {
  const app = Fastify();
  context.after(() => app.close());
  registerPollRoutes(app);

  const response = await app.inject({
    method: 'GET',
    url: '/polls/11111111-1111-4111-8111-111111111111/comments/33333333-3333-4333-8333-333333333333/replies?limit=0'
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, 'validation_error');
  assert.ok(response.json().details.fieldErrors.limit);
});
