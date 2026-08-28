import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanupUploadedPollImage } from './polls.routes.js';

test('poll image cleanup does not replace the original create error', async () => {
  await assert.doesNotReject(
    cleanupUploadedPollImage('poll-images/user-1/image.webp', async () => {
      throw new Error('storage cleanup failed');
    })
  );
});
