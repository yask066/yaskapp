import { randomUUID } from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import sharp from 'sharp';

import { deleteObject, putObject } from '../../config/storage.js';
import { findUserById } from '../auth/auth.repository.js';
import {
  clearAvatarObjectKey,
  findAvatarObjectKey,
  updateAvatarObjectKey
} from './profiles.repository.js';

export class AvatarUploadError extends Error {}

export const allowedAvatarMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export function createAvatarObjectKey(userId: string) {
  return `avatars/${userId}/${randomUUID()}.webp`;
}

function hasPrefix(bytes: Buffer, prefix: readonly number[]) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function matchesAvatarSignature(mimetype: string, body: Buffer) {
  if (mimetype === 'image/jpeg') {
    return hasPrefix(body, [0xff, 0xd8, 0xff]);
  }

  if (mimetype === 'image/png') {
    return hasPrefix(body, [
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a
    ]);
  }

  if (mimetype === 'image/webp') {
    return (
      hasPrefix(body, [0x52, 0x49, 0x46, 0x46]) &&
      body.length >= 12 &&
      body.subarray(8, 12).equals(Buffer.from('WEBP'))
    );
  }

  return false;
}

function hasPngAnimationChunk(body: Buffer) {
  let offset = 8;

  while (offset + 12 <= body.length) {
    const chunkSize = body.readUInt32BE(offset);
    const chunkType = body.toString('ascii', offset + 4, offset + 8);
    const nextOffset = offset + 12 + chunkSize;

    if (nextOffset > body.length) {
      return false;
    }

    if (chunkType === 'acTL') {
      return true;
    }

    offset = nextOffset;
  }

  return false;
}

function hasWebpAnimationChunk(body: Buffer) {
  let offset = 12;

  while (offset + 8 <= body.length) {
    const chunkType = body.toString('ascii', offset, offset + 4);
    const chunkSize = body.readUInt32LE(offset + 4);
    const nextOffset = offset + 8 + chunkSize + (chunkSize % 2);

    if (nextOffset > body.length) {
      return false;
    }

    if (chunkType === 'ANIM') {
      return true;
    }

    if (chunkType === 'VP8X' && chunkSize >= 1 && (body[offset + 8] & 0x02) !== 0) {
      return true;
    }

    offset = nextOffset;
  }

  return false;
}

function isAnimatedAvatar(mimetype: string, body: Buffer) {
  if (mimetype === 'image/png') {
    return hasPngAnimationChunk(body);
  }

  if (mimetype === 'image/webp') {
    return hasWebpAnimationChunk(body);
  }

  return false;
}

export async function normalizeAvatar(body: Buffer) {
  return sharp(body)
    .rotate()
    .resize({
      width: 512,
      height: 512,
      fit: 'cover',
      position: 'centre'
    })
    .webp()
    .toBuffer();
}

export async function uploadAvatar(userId: string, part: MultipartFile) {
  if (part.fieldname !== 'avatar') {
    throw new AvatarUploadError('The avatar field is required.');
  }

  if (!allowedAvatarMimeTypes.has(part.mimetype)) {
    throw new AvatarUploadError(
      'Avatar file must be a JPEG, PNG, or WebP image.'
    );
  }

  const previousObjectKey = await findAvatarObjectKey(userId);

  if (previousObjectKey === undefined) {
    throw new AvatarUploadError('Profile was not found.');
  }

  const body = await part.toBuffer();

  if (!matchesAvatarSignature(part.mimetype, body)) {
    throw new AvatarUploadError(
      'Avatar file content does not match its declared image type.'
    );
  }

  if (isAnimatedAvatar(part.mimetype, body)) {
    throw new AvatarUploadError('Animated avatar images are not supported.');
  }

  const normalizedBody = await normalizeAvatar(body);
  const objectKey = createAvatarObjectKey(userId);

  await putObject({
    key: objectKey,
    body: normalizedBody,
    contentType: 'image/webp'
  });

  const updated = await updateAvatarObjectKey(userId, objectKey);

  if (!updated) {
    await deleteObject(objectKey);
    throw new AvatarUploadError('Profile was not found.');
  }

  // Keep the old object until the new key is safely persisted in the profile.
  if (previousObjectKey !== null) {
    await deleteObject(previousObjectKey);
  }

  const user = await findUserById(userId);

  if (!user) {
    throw new AvatarUploadError('Profile was not found.');
  }

  return user;
}

export async function deleteAvatar(userId: string) {
  const objectKey = await findAvatarObjectKey(userId);

  if (objectKey === undefined) {
    throw new AvatarUploadError('Profile was not found.');
  }

  // A missing avatar is a successful no-op for repeated DELETE requests.
  // Clear the database pointer only after the storage object is deleted.
  if (objectKey !== null) {
    await deleteObject(objectKey);
  }

  const cleared = await clearAvatarObjectKey(userId);

  if (!cleared) {
    throw new AvatarUploadError('Profile was not found.');
  }

  const user = await findUserById(userId);

  if (!user) {
    throw new AvatarUploadError('Profile was not found.');
  }

  return user;
}
