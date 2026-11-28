import { randomUUID } from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import sharp from 'sharp';

import { deleteObject, putObject } from '../../config/storage.js';
import { withActiveAccountTransaction } from '../account-deletion/account-activity.guard.js';
import { findUserById } from '../auth/auth.repository.js';
import {
  clearAvatarObjectKey,
  findAvatarObjectKey,
  updateAvatarObjectKey
} from './profiles.repository.js';

export type AvatarErrorCode =
  | 'avatar_invalid'
  | 'avatar_unsupported_type'
  | 'avatar_processing_failed'
  | 'avatar_storage_unavailable';

export class AvatarUploadError extends Error {
  constructor(message: string, readonly code: AvatarErrorCode = 'avatar_invalid') {
    super(message);
  }
}

export class AvatarProcessingError extends Error {}

export class AvatarStorageError extends Error {}

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

const maxAvatarInputPixels = 25_000_000;

export async function normalizeAvatar(body: Buffer) {
  return sharp(body, { limitInputPixels: maxAvatarInputPixels, failOn: 'error' })
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

function isInvalidImageError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /corrupt|invalid|unsupported|truncated|end of stream|input buffer|pixel limit/i.test(
    error.message
  );
}

export async function uploadAvatar(userId: string, part: MultipartFile) {
  if (part.fieldname !== 'avatar') {
    throw new AvatarUploadError('The avatar field is required.');
  }

  if (!allowedAvatarMimeTypes.has(part.mimetype)) {
    throw new AvatarUploadError(
      'Avatar file must be a JPEG, PNG, or WebP image.',
      'avatar_unsupported_type'
    );
  }

  const body = await part.toBuffer();

  if (!matchesAvatarSignature(part.mimetype, body)) {
    throw new AvatarUploadError(
      'Avatar file content does not match its declared image type.',
      'avatar_unsupported_type'
    );
  }

  if (isAnimatedAvatar(part.mimetype, body)) {
    throw new AvatarUploadError(
      'Animated avatar images are not supported.',
      'avatar_unsupported_type'
    );
  }

  let normalizedBody: Buffer;
  try {
    normalizedBody = await normalizeAvatar(body);
  } catch (error) {
    if (isInvalidImageError(error)) {
      throw new AvatarUploadError(
        'Please choose a valid image file.',
        'avatar_invalid'
      );
    }

    throw new AvatarProcessingError('Avatar image could not be processed safely.');
  }

  const objectKey = createAvatarObjectKey(userId);

  try {
    await putObject({
      key: objectKey,
      body: normalizedBody,
      contentType: 'image/webp'
    });
  } catch (_) {
    throw new AvatarStorageError('Avatar storage is temporarily unavailable.');
  }

  let previousObjectKey: string | null = null;
  let user;
  try {
    const committed = await withActiveAccountTransaction(userId, async (client) => {
      const currentKey = await findAvatarObjectKey(userId, client);
      if (currentKey === undefined) {
        throw new AvatarUploadError('Profile was not found.');
      }

      const updated = await updateAvatarObjectKey(userId, objectKey, client);
      if (!updated) {
        throw new AvatarUploadError('Profile was not found.');
      }

      const updatedUser = await findUserById(userId, client);
      if (!updatedUser) {
        throw new AvatarUploadError('Profile was not found.');
      }

      return { previousObjectKey: currentKey, user: updatedUser };
    });
    previousObjectKey = committed.previousObjectKey;
    user = committed.user;
  } catch (error) {
    await deleteObject(objectKey).catch(() => undefined);
    throw error;
  }

  // Delete the superseded avatar best-effort after commit; orphan cleanup reclaims transient failures.
  if (previousObjectKey !== null) {
    await deleteObject(previousObjectKey).catch(() => undefined);
  }

  return user;
}

export async function deleteAvatar(userId: string) {
  const committed = await withActiveAccountTransaction(userId, async (client) => {
    const objectKey = await findAvatarObjectKey(userId, client);
    if (objectKey === undefined) {
      throw new AvatarUploadError('Profile was not found.');
    }

    const cleared = await clearAvatarObjectKey(userId, client);
    if (!cleared) {
      throw new AvatarUploadError('Profile was not found.');
    }

    const user = await findUserById(userId, client);
    if (!user) {
      throw new AvatarUploadError('Profile was not found.');
    }

    return { objectKey, user };
  });

  if (committed.objectKey !== null) {
    await deleteObject(committed.objectKey).catch(() => undefined);
  }

  return committed.user;
}
