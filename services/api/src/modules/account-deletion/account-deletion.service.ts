import type { AccountDeletionStatusResponse } from '@yaskapp/shared';
import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import {
  acceptDeletionOperation,
  consumeDeletionPermission,
  getDeletionOperation,
  getDeletionPermission,
  markOperationJournalConfirmed
} from './account-deletion.repository.js';
import { hashDeletionToken } from './account-deletion.verification.js';
import { lockSuperadminMutation } from './account-activity.guard.js';
import { dispatchPendingDeletionEvents } from './account-deletion.events.js';
import { disconnectUser } from '../../realtime/realtime.hub.js';
import { abortDeletionInJournal, acceptDeletionInJournal, prepareDeletionInJournal } from './account-deletion.journal.js';
import { commitJournaledAcceptance } from './account-deletion.acceptance-protocol.js';
import { snapshotDeletedAccount } from './account-deletion.archive.js';

const cleanupSteps = ['discovery', 'notifications', 'moderation', 'content', 'relationships', 'media', 'completion'];

export class AccountDeletionAcceptanceError extends Error {
  constructor(readonly code: 'unauthorized' | 'account_deletion_conflict' | 'last_superadmin') {
    super(code);
  }
}

export async function snapshotDeletionWork(client: PoolClient, operationId: string, userId: string) {
  await client.query(
    `INSERT INTO account_deletion_steps (operation_id, step_key, position)
     SELECT $1, step_key, (position - 1)::int
     FROM unnest($2::text[]) WITH ORDINALITY AS step(step_key, position)
     ON CONFLICT (operation_id, step_key) DO NOTHING`,
    [operationId, cleanupSteps]
  );
  await client.query(
    `INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key)
     SELECT $1, $2, object_key FROM (
       SELECT avatar_object_key AS object_key FROM profiles WHERE user_id = $2 AND avatar_object_key IS NOT NULL
       UNION
       SELECT cover_object_key FROM profiles WHERE user_id = $2 AND cover_object_key IS NOT NULL
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

export async function enqueueAdminAccountDeletion(
  client: PoolClient,
  userId: string,
  deletedAt: Date
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM account_deletion_operations
      WHERE user_id = $1 AND status <> 'not_started'
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  await client.query(
    "DELETE FROM account_deletion_operations WHERE user_id = $1 AND status = 'not_started'",
    [userId]
  );
  const deadlineAt = new Date(deletedAt.getTime() + 24 * 60 * 60_000);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO account_deletion_operations (
       user_id, status, accepted_at, deadline_at, available_at, updated_at
     )
     VALUES ($1, 'pending', $2, $3, $2, $2)
     RETURNING id`,
    [userId, deletedAt, deadlineAt]
  );
  const operationId = inserted.rows[0]?.id;
  if (!operationId) {
    throw new Error('Failed to create admin account deletion operation.');
  }
  await snapshotDeletionWork(client, operationId, userId);
  return operationId;
}

export async function acceptAccountDeletion(
  deletionToken: string,
  confirm: true,
  journal: {
    writePrepared: typeof prepareDeletionInJournal;
    writeAccepted: typeof acceptDeletionInJournal;
    writeAborted?: typeof abortDeletionInJournal;
  } | undefined = env.ACCOUNT_DELETION_JOURNAL_ENABLED ? {
    writePrepared: prepareDeletionInJournal,
    writeAccepted: acceptDeletionInJournal,
    writeAborted: abortDeletionInJournal
  } : undefined
): Promise<AccountDeletionStatusResponse> {
  if (confirm !== true || !deletionToken) {
    throw new AccountDeletionAcceptanceError('unauthorized');
  }

  const client = await db.connect();
  let transactionCommitted = false;
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
      transactionCommitted = true;
      if (!operation.acceptedAt || !operation.deadlineAt) throw new Error('account_deletion_accepted_timestamps_missing');
      await journal?.writeAccepted({
        operationId: operation.operationId,
        userId: permission.userId,
        acceptedAt: new Date(operation.acceptedAt),
        deadlineAt: new Date(operation.deadlineAt)
      });
      return operation;
    }

    let accountResult = await client.query<{
      role: string;
      status: string;
      deleted_at: Date | null;
    }>('SELECT role, status, deleted_at FROM users WHERE id = $1 FOR UPDATE', [permission.userId]);
    let account = accountResult.rows[0];
    if (!account || account.status === 'deleted' || account.deleted_at) {
      throw new AccountDeletionAcceptanceError('account_deletion_conflict');
    }
    if (account.role === 'superadmin') {
      await lockSuperadminMutation(client);
      accountResult = await client.query<{
        role: string;
        status: string;
        deleted_at: Date | null;
      }>('SELECT role, status, deleted_at FROM users WHERE id = $1 FOR UPDATE', [permission.userId]);
      account = accountResult.rows[0];
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

    await snapshotDeletedAccount(client, permission.userId, acceptedAt, 'self_service');
    await client.query(
      `UPDATE users SET status = 'deleted', deleted_at = COALESCE(deleted_at, $2),
         session_version = session_version + 1, updated_at = $2 WHERE id = $1`,
      [permission.userId, acceptedAt]
    );
    await snapshotDeletionWork(client, permission.operationId, permission.userId);
    const journalAcceptance = {
      operationId: permission.operationId,
      userId: permission.userId,
      acceptedAt,
      deadlineAt
    };
    const commitDatabase = async () => {
      await client.query('COMMIT');
      transactionCommitted = true;
    };
    // The operation, access revocation, cleanup steps and outbox are committed
    // together in the application database. Independent journaling is opt-in.
    if (journal) {
      await commitJournaledAcceptance({
        writePrepared: () => journal.writePrepared(journalAcceptance),
        commitDatabase,
        writeAccepted: async () => {
          await journal.writeAccepted(journalAcceptance);
          await markOperationJournalConfirmed(permission.operationId).catch(() => undefined);
        },
        writeAborted: journal.writeAborted ? () => journal.writeAborted!(journalAcceptance) : undefined
      });
    } else {
      await commitDatabase();
    }
    try {
      disconnectUser(permission.userId, 'account_deleted', {
        type: 'account.deleted',
        payload: { userId: permission.userId, operationId: permission.operationId }
      });
    } catch {
      // The committed outbox event and per-delivery account check still revoke remote access.
    }
    void dispatchPendingDeletionEvents().catch(() => undefined);
    return accepted;
  } catch (error) {
    if (!transactionCommitted) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
