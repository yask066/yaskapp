import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import {
  createPollImageObjectKey,
  normalizePollImage,
  validatePollImageBytes
} from './poll-images.service.js';

test('poll image object keys are unique and use the poll-images namespace', () => {
  const firstKey = createPollImageObjectKey('user-123');
  const secondKey = createPollImageObjectKey('user-123');

  assert.match(
    firstKey,
    /^poll-images\/user-123\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/
  );
  assert.notEqual(firstKey, secondKey);
});

test('poll image validation accepts a real JPEG, PNG, and WebP signature', async () => {
  const sources = await Promise.all([
    sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
      .jpeg()
      .toBuffer(),
    sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } })
      .png()
      .toBuffer(),
    sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
      .webp()
      .toBuffer()
  ]);

  assert.doesNotThrow(() => validatePollImageBytes('image/jpeg', sources[0]));
  assert.doesNotThrow(() => validatePollImageBytes('image/png', sources[1]));
  assert.doesNotThrow(() => validatePollImageBytes('image/webp', sources[2]));
});

test('poll image validation rejects mismatched, unsupported, and animated files', async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'white' }
  })
    .png()
    .toBuffer();

  assert.throws(
    () => validatePollImageBytes('image/jpeg', png),
    /does not match/i
  );
  assert.throws(
    () => validatePollImageBytes('image/gif', png),
    /JPEG, PNG, or WebP/i
  );
  assert.throws(
    () => validatePollImageBytes('image/png', Buffer.from('not-an-image')),
    /does not match/i
  );
});

test('poll image normalization produces a metadata-free WebP', async () => {
  const source = await sharp({
    create: { width: 800, height: 400, channels: 3, background: 'purple' }
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

  const normalized = await normalizePollImage(source);
  const metadata = await sharp(normalized).metadata();

  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.iptc, undefined);
});
