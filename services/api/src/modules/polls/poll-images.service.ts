import { randomUUID } from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import sharp, { type Metadata } from 'sharp';

import { deleteObject, putObject } from '../../config/storage.js';
import { db } from '../../config/database.js';
import { withActiveAccountTransaction } from '../account-deletion/account-activity.guard.js';

const maxPollImageBytes = 5 * 1024 * 1024;

export const allowedPollImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export type PollImageErrorCode =
  | 'poll_image_invalid'
  | 'poll_image_unsupported_type'
  | 'poll_image_too_large';

export class PollImageUploadError extends Error {
  constructor(message: string, readonly code: PollImageErrorCode = 'poll_image_invalid') {
    super(message);
  }
}

export class PollImageStorageError extends Error {}

export function createPollImageObjectKey(authorId: string) {
  return `poll-images/${authorId}/${randomUUID()}.webp`;
}

function hasPrefix(bytes: Buffer, prefix: readonly number[]) {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function matchesImageSignature(mimetype: string, body: Buffer) {
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

export function validatePollImageBytes(mimetype: string, body: Buffer) {
  if (!allowedPollImageMimeTypes.has(mimetype)) {
    throw new PollImageUploadError(
      'Poll image must be a JPEG, PNG, or WebP image.',
      'poll_image_unsupported_type'
    );
  }

  if (body.length > maxPollImageBytes) {
    throw new PollImageUploadError(
      'Poll image file must be 5 MB or smaller.',
      'poll_image_too_large'
    );
  }

  if (!matchesImageSignature(mimetype, body)) {
    throw new PollImageUploadError(
      'Poll image content does not match its declared image type.',
      'poll_image_unsupported_type'
    );
  }
}

export async function normalizePollImage(body: Buffer) {
  return sharp(body)
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp()
    .toBuffer();
}

function isInvalidImageError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /corrupt|invalid|unsupported|truncated|end of stream|input buffer/i.test(
    error.message
  );
}

type PollImagePart = Pick<MultipartFile, 'fieldname' | 'mimetype' | 'toBuffer'>;

export async function processPollImage(authorId: string, part: PollImagePart) {
  return withActiveAccountTransaction(authorId, async () => processPollImageWhileLocked(authorId, part));
}

async function processPollImageWhileLocked(authorId: string, part: PollImagePart) {
  if (part.fieldname !== 'image') {
    throw new PollImageUploadError('The image field is required.');
  }

  const body = await part.toBuffer();
  validatePollImageBytes(part.mimetype, body);

  let metadata: Metadata;
  let normalizedBody: Buffer;

  try {
    metadata = await sharp(body).metadata();

    if ((metadata.pages ?? 1) > 1) {
      throw new PollImageUploadError('Animated poll images are not supported.');
    }

    normalizedBody = await normalizePollImage(body);
  } catch (error) {
    if (error instanceof PollImageUploadError) {
      throw error;
    }

    if (isInvalidImageError(error)) {
      throw new PollImageUploadError('Please choose a valid image file.');
    }

    throw new PollImageUploadError('Poll image could not be processed safely.');
  }

  const objectKey = createPollImageObjectKey(authorId);

  try {
    await putObject({
      key: objectKey,
      body: normalizedBody,
      contentType: 'image/webp'
    });
  } catch (_) {
    throw new PollImageStorageError('Poll image storage is temporarily unavailable.');
  }

  return { objectKey };
}

export function deletePollImageObject(objectKey: string) {
  return deleteObject(objectKey);
}

export async function enqueuePollImageForAccountDeletion(userId: string, objectKey: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const operation = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM account_deletion_operations
        WHERE user_id = $1 AND status <> 'not_started'
        ORDER BY accepted_at DESC LIMIT 1 FOR UPDATE`,
      [userId]
    );
    const deletion = operation.rows[0];
    if (!deletion) throw new Error('No accepted account deletion operation was found for the uploaded image.');

    if (deletion.status === 'completed') {
      await client.query(
        `UPDATE account_deletion_operations
            SET status = 'pending', completed_at = NULL, available_at = now(),
                lease_owner = NULL, lease_until = NULL, updated_at = now()
          WHERE id = $1`,
        [deletion.id]
      );
      await client.query(
        `UPDATE account_deletion_steps
            SET status = 'pending', cursor_id = NULL, completed_at = NULL,
                started_at = NULL, available_at = now(), last_error_code = NULL, updated_at = now()
          WHERE operation_id = $1 AND step_key IN ('media', 'completion')`,
        [deletion.id]
      );
    }
    await client.query(
      `INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (operation_id, object_key, version_id) DO UPDATE
         SET status = 'pending', available_at = now(), completed_at = NULL`,
      [deletion.id, userId, objectKey]
    );
    await client.query(
      `INSERT INTO account_deletion_events (operation_id, event_key)
       VALUES ($1, 'cleanup_requested')
       ON CONFLICT (operation_id, event_key) DO UPDATE
         SET available_at = now(), attempts = 0, lease_owner = NULL, lease_until = NULL,
             last_error_code = NULL, delivered_at = NULL`,
      [deletion.id]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
