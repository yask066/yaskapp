import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanupUploadedPollImage } from './polls.routes.js';

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
