import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

import { generateApiRequestId, safeRequestSerializer } from '../../observability/pagination-logging.js';
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

test('invalid root cursors use the pagination cursor error envelope', async (context) => {
  const app = Fastify();
  context.after(() => app.close());
  registerPollRoutes(app);

  const response = await app.inject({
    method: 'GET',
    url: '/polls/11111111-1111-4111-8111-111111111111/comments?order=newest&cursor=not-a-cursor'
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    error: 'pagination_cursor_invalid',
    message: 'The pagination cursor is invalid.'
  });
});

test('invalid newest-feed cursors use the pagination cursor error envelope', async (context) => {
  const app = Fastify();
  context.after(() => app.close());
  registerPollRoutes(app);

  const response = await app.inject({
    method: 'GET',
    url: '/polls?cursor=not-a-cursor'
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    error: 'pagination_cursor_invalid',
    message: 'The pagination cursor is invalid.'
  });
});

test('invalid pagination cursors log a safe failure and cursor anomaly', async (context) => {
  const logLines: string[] = [];
  const app = Fastify({
    requestIdHeader: false,
    genReqId: generateApiRequestId,
    logger: {
      stream: { write: (line: string) => logLines.push(line) },
      serializers: { req: safeRequestSerializer },
    },
  });
  context.after(() => app.close());
  registerPollRoutes(app);

  const response = await app.inject({
    method: 'GET',
    url: '/polls?cursor=RAW_CURSOR_CANARY',
    headers: {
      'x-request-id': 'e5b2e8b1-f4c8-44ba-a25f-a63d60058128',
    },
  });

  assert.equal(response.statusCode, 400);
  const records = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const events = records.filter((record) => typeof record.event === 'string' &&
    (record.event as string).startsWith('pagination.'));
  assert.deepEqual(events.map((record) => record.event), [
    'pagination.start', 'pagination.failure', 'pagination.cursor_anomaly',
  ]);
  assert.equal(events[1].errorCode, 'pagination_cursor_invalid');
  assert.ok(events.every((record) => record.requestId === 'e5b2e8b1-f4c8-44ba-a25f-a63d60058128'));
  const serialized = logLines.join('\n');
  assert.equal(serialized.includes('RAW_CURSOR_CANARY'), false);
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
