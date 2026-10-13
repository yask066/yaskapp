import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';

const PURGE_BATCH_SIZE = 100;

async function loadDeletion(client: PoolClient, operationId: string) {
  const result = await client.query<{ user_id: string }>(
    'SELECT user_id FROM account_deletion_operations WHERE id = $1',
    [operationId]
  );
  const userId = result.rows[0]?.user_id;
  if (!userId) throw new Error('account_deletion_operation_not_found');
  const [targets, ownedPolls, ownedComments] = await Promise.all([
    client.query<{ target_type: 'poll' | 'comment'; target_id: string }>(
    `SELECT target_type, target_id FROM account_deletion_content_targets
      WHERE operation_id = $1 ORDER BY target_type, target_id`,
    [operationId]
    ),
    client.query<{ id: string }>('SELECT id FROM polls WHERE author_id = $1', [userId]),
    client.query<{ id: string }>(
      `SELECT c.id FROM comments c LEFT JOIN polls p ON p.id = c.poll_id
        WHERE c.author_id = $1 OR p.author_id = $1`,
      [userId]
    )
  ]);
  return {
    userId,
    pollIds: [...new Set([
      ...targets.rows.filter((row) => row.target_type === 'poll').map((row) => row.target_id),
      ...ownedPolls.rows.map((row) => row.id)
    ])],
    commentIds: [...new Set([
      ...targets.rows.filter((row) => row.target_type === 'comment').map((row) => row.target_id),
      ...ownedComments.rows.map((row) => row.id)
    ])]
  };
}

export async function purgeAccountNotifications(operationId: string): Promise<{ done: boolean }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { userId, pollIds, commentIds } = await loadDeletion(client, operationId);

    const notifications = await client.query(
      `WITH batch AS (
         SELECT id FROM notifications
          WHERE recipient_user_id = $1 OR actor_user_id = $1
             OR poll_id = ANY($2::uuid[]) OR comment_id = ANY($3::uuid[])
          ORDER BY created_at, id LIMIT $4 FOR UPDATE
       )
       DELETE FROM notifications n USING batch WHERE n.id = batch.id`,
      [userId, pollIds, commentIds, PURGE_BATCH_SIZE]
    );
    const jobs = await client.query(
      `WITH batch AS (
         SELECT id FROM notification_push_jobs
          WHERE recipient_user_id = $1 OR poll_id = ANY($2::uuid[]) OR comment_id = ANY($3::uuid[])
          ORDER BY created_at, id LIMIT $4 FOR UPDATE
       )
       DELETE FROM notification_push_jobs j USING batch WHERE j.id = batch.id`,
      [userId, pollIds, commentIds, PURGE_BATCH_SIZE]
    );
    const devices = await client.query('DELETE FROM notification_devices WHERE user_id = $1', [userId]);
    const preferences = await client.query('DELETE FROM notification_preferences WHERE user_id = $1', [userId]);

    const remaining = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM notifications
          WHERE recipient_user_id = $1 OR actor_user_id = $1
             OR poll_id = ANY($2::uuid[]) OR comment_id = ANY($3::uuid[])
       ) OR EXISTS (
         SELECT 1 FROM notification_push_jobs
          WHERE recipient_user_id = $1 OR poll_id = ANY($2::uuid[]) OR comment_id = ANY($3::uuid[])
       ) OR EXISTS (SELECT 1 FROM notification_devices WHERE user_id = $1)
          OR EXISTS (SELECT 1 FROM notification_preferences WHERE user_id = $1) AS exists`,
      [userId, pollIds, commentIds]
    );
    await client.query('COMMIT');
    const changed = (notifications.rowCount ?? 0) + (jobs.rowCount ?? 0)
      + (devices.rowCount ?? 0) + (preferences.rowCount ?? 0);
    return { done: remaining.rows[0]?.exists !== true && changed === 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
