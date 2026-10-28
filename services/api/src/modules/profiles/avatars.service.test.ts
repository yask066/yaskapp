import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';

import {
  createAvatarObjectKey,
  normalizeAvatar
} from './avatars.service.js';

test('avatar object keys are unique and independent of the source filename', () => {
  const firstKey = createAvatarObjectKey('user-123');
  const secondKey = createAvatarObjectKey('user-123');

  assert.match(
    firstKey,
    /^avatars\/user-123\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/
  );
  assert.notEqual(firstKey, secondKey);
  assert.doesNotMatch(firstKey, /avatar\.png|avatar\.jpg|avatar\.jpeg|avatar\.gif/i);
});

test('avatar normalization stores a WebP representation', async () => {
  const source = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  const normalized = await normalizeAvatar(source);

  assert.equal(normalized.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(normalized.subarray(8, 12).toString('ascii'), 'WEBP');
});

test('avatar normalization center-crops large images to 512x512', async () => {
  const source = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 3,
      background: { r: 20, g: 40, b: 80 }
    }
  })
    .png()
    .toBuffer();

  const normalized = await normalizeAvatar(source);
  const metadata = await sharp(normalized).metadata();

  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});

test('avatar normalization applies orientation and strips metadata', async () => {
  const source = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 3,
      background: { r: 20, g: 40, b: 80 }
    }
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();

  const normalized = await normalizeAvatar(source);
  const metadata = await sharp(normalized).metadata();

  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.iptc, undefined);
});
