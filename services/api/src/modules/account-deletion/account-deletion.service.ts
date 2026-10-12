import type { AccountDeletionStatusResponse } from '@yaskapp/shared';
import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import {
  acceptDeletionOperation,
  consumeDeletionPermission,
  getDeletionOperation,
  getDeletionPermission
} from './account-deletion.repository.js';
import { hashDeletionToken } from './account-deletion.verification.js';
import { lockSuperadminMutation } from './account-activity.guard.js';

const cleanupSteps = ['discovery', 'notifications', 'moderation', 'content', 'relationships', 'media', 'completion'];

export class AccountDeletionAcceptanceError extends Error {
  constructor(readonly code: 'unauthorized' | 'account_deletion_conflict' | 'last_superadmin') {
    super(code);
  }
}

async function snapshotDeletionWork(client: PoolClient, operationId: string, userId: string) {
  await client.query(
    `INSERT INTO account_deletion_steps (operation_id, step_key, position)
     SELECT $1, step_key, position::int
     FROM unnest($2::text[]) WITH ORDINALITY AS step(step_key, position)
     ON CONFLICT (operation_id, step_key) DO NOTHING`,
    [operationId, cleanupSteps]
  );
  await client.query(
    `INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key)
     SELECT $1, $2, object_key FROM (
       SELECT avatar_object_key AS object_key FROM profiles WHERE user_id = $2 AND avatar_object_key IS NOT NULL
       UNION
       SELECT image_object_key FROM polls WHERE author_id = $2 AND image_object_key IS NOT NULL
     ) AS media
     ON CONFLICT (operation_id, object_key, version_id) DO NOTHING`,
    [operationId, userId]
  );
  await client.query(
    `INSERT INTO account_deletion_events (operation_id, event_key)
     VALUES ($1, 'access_revoked'), ($1, 'cleanup_requested')
     ON CONFLICT (operation_id, event_key) DO NOTHING`,
    [operationId]
  );
}

export async function acceptAccountDeletion(
  deletionToken: string,
  confirm: true
): Promise<AccountDeletionStatusResponse> {
  if (confirm !== true || !deletionToken) {
    throw new AccountDeletionAcceptanceError('unauthorized');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const tokenHash = hashDeletionToken(deletionToken);
    const permission = await getDeletionPermission(tokenHash, 'delete', client, true);
    if (!permission) throw new AccountDeletionAcceptanceError('unauthorized');

    const operation = await getDeletionOperation(permission.operationId, client);
    if (!operation) throw new AccountDeletionAcceptanceError('unauthorized');
    if (permission.consumedAt || operation.status !== 'not_started') {
      if (operation.status === 'not_started') {
        throw new AccountDeletionAcceptanceError('account_deletion_conflict');
      }
      await client.query('COMMIT');
      return operation;
    }

    await lockSuperadminMutation(client);
    const accountResult = await client.query<{
      role: string;
      status: string;
      deleted_at: Date | null;
    }>('SELECT role, status, deleted_at FROM users WHERE id = $1 FOR UPDATE', [permission.userId]);
    const account = accountResult.rows[0];
    if (!account || account.status === 'deleted' || account.deleted_at) {
      throw new AccountDeletionAcceptanceError('account_deletion_conflict');
    }
    if (account.role === 'superadmin') {
      const countResult = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users
         WHERE role = 'superadmin' AND status <> 'deleted' AND deleted_at IS NULL`
      );
      if (Number(countResult.rows[0]?.count ?? 0) <= 1) {
        throw new AccountDeletionAcceptanceError('last_superadmin');
      }
    }

    const consumed = await consumeDeletionPermission(tokenHash, client);
    if (!consumed) throw new AccountDeletionAcceptanceError('unauthorized');

    const acceptedAt = new Date();
    const deadlineAt = new Date(acceptedAt.getTime() + 24 * 60 * 60_000);
    const accepted = await acceptDeletionOperation({
      operationId: permission.operationId,
      userId: permission.userId,
      acceptedAt,
      deadlineAt
    }, client);
    if (!accepted || accepted.status === 'not_started') {
      throw new AccountDeletionAcceptanceError('account_deletion_conflict');
    }

    await client.query(
      `UPDATE users SET status = 'deleted', deleted_at = COALESCE(deleted_at, $2),
         session_version = session_version + 1, updated_at = $2 WHERE id = $1`,
      [permission.userId, acceptedAt]
    );
    await snapshotDeletionWork(client, permission.operationId, permission.userId);
    await client.query('COMMIT');
    return accepted;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
