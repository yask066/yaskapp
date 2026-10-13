import { db } from '../../config/database.js';
import type { AccountDeletionJournalEntry } from './account-deletion.journal.js';

const cleanupSteps = ['discovery', 'notifications', 'moderation', 'content', 'relationships', 'media', 'completion'];

type RestoreDatabase = Pick<typeof db, 'connect'>;

export async function reapplyAcceptedDeletions(
  entries: AccountDeletionJournalEntry[],
  database: RestoreDatabase = db
) {
  const byOperation = new Map<string, AccountDeletionJournalEntry>();
  const operationByUser = new Map<string, string>();
  for (const entry of entries) {
    if (byOperation.has(entry.operationId)) throw new Error('account_deletion_journal_duplicate_operation');
    if (operationByUser.has(entry.userId)) throw new Error('account_deletion_journal_duplicate_user');
    byOperation.set(entry.operationId, entry);
    operationByUser.set(entry.userId, entry.operationId);
  }

  let reapplied = 0;
  for (const entry of byOperation.values()) {
    const acceptedAt = new Date(entry.acceptedAt);
    const deadlineAt = new Date(entry.deadlineAt);
    if (!Number.isFinite(acceptedAt.getTime()) || !Number.isFinite(deadlineAt.getTime()) || deadlineAt < acceptedAt) {
      throw new Error('account_deletion_journal_invalid_timestamps');
    }
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ user_id: string }>(
        'SELECT user_id FROM account_deletion_operations WHERE id = $1 FOR UPDATE', [entry.operationId]
      );
      if (existing.rows[0] && existing.rows[0].user_id !== entry.userId) {
        throw new Error('account_deletion_journal_operation_owner_mismatch');
      }

      await client.query(
        `INSERT INTO account_deletion_operations
           (id, user_id, status, accepted_at, deadline_at, completed_at, available_at,
            attempts, lease_owner, lease_until, last_error_code, updated_at)
         VALUES ($1, $2, 'pending', $3, $4, NULL, now(), 0, NULL, NULL, NULL, now())
         ON CONFLICT (id) DO UPDATE SET
           status = 'pending', accepted_at = EXCLUDED.accepted_at, deadline_at = EXCLUDED.deadline_at,
           completed_at = NULL, available_at = now(), attempts = 0, lease_owner = NULL,
           lease_until = NULL, last_error_code = NULL, updated_at = now()`,
        [entry.operationId, entry.userId, acceptedAt, deadlineAt]
      );
      await client.query(
        `UPDATE users SET status = 'deleted', deleted_at = COALESCE(deleted_at, $2),
           session_version = session_version + CASE
             WHEN status <> 'deleted' OR deleted_at IS NULL THEN 1 ELSE 0 END,
           updated_at = now() WHERE id = $1`,
        [entry.userId, acceptedAt]
      );
      await client.query(
        `INSERT INTO account_deletion_steps (operation_id, step_key, position)
         SELECT $1, step_key, (position - 1)::int FROM unnest($2::text[]) WITH ORDINALITY AS step(step_key, position)
         ON CONFLICT (operation_id, step_key) DO UPDATE SET
           status = 'pending', cursor_id = NULL, processed_count = 0, attempts = 0,
           available_at = now(), last_error_code = NULL, started_at = NULL,
           completed_at = NULL, updated_at = now()`,
        [entry.operationId, cleanupSteps]
      );
      await client.query(
        `UPDATE account_deletion_media_manifest SET status = 'pending', attempts = 0,
           available_at = now(), last_error_code = NULL, completed_at = NULL
         WHERE operation_id = $1`,
        [entry.operationId]
      );
      await client.query(
        `INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key)
         SELECT $1, $2, object_key FROM (
           SELECT avatar_object_key AS object_key FROM profiles WHERE user_id = $2 AND avatar_object_key IS NOT NULL
           UNION
           SELECT cover_object_key FROM profiles WHERE user_id = $2 AND cover_object_key IS NOT NULL
           UNION
           SELECT image_object_key FROM polls WHERE author_id = $2 AND image_object_key IS NOT NULL
         ) media ON CONFLICT (operation_id, object_key, version_id) DO NOTHING`,
        [entry.operationId, entry.userId]
      );
      await client.query(
        `INSERT INTO account_deletion_events (operation_id, event_key)
         VALUES ($1, 'access_revoked'), ($1, 'cleanup_requested')
         ON CONFLICT (operation_id, event_key) DO UPDATE SET
           available_at = now(), attempts = 0, lease_owner = NULL, lease_until = NULL,
           last_error_code = NULL, delivered_at = NULL`,
        [entry.operationId]
      );
      await client.query('COMMIT');
      reapplied += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return { reapplied };
}

export const accountDeletionRestoreTestUtils = { cleanupSteps };
