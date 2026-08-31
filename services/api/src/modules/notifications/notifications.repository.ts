import type { Pool, PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { decodeAdminCursor, pageWithCursor } from '../admin/pagination.js';
import { avatarUrlForUser } from '../profiles/avatar-url.js';
import { isInAppEnabled, isPushEnabled } from './notification-preferences.repository.js';
import { incrementNotificationMetric } from './notifications.metrics.js';

type QueryExecutor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export type NotificationType =
  | 'poll_vote'
  | 'comment'
  | 'comment_reply'
  | 'like'
  | 'follow';

export type CreateNotificationInput = {
  recipientUserId: string;
  actorUserId?: string;
  type: NotificationType;
  pollId?: string;
  commentId?: string;
  payload?: Record<string, unknown>;
  deduplicationKey: string;
};

export type NotificationRecord = {
  id: string;
  type: NotificationType;
  actor: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  pollId: string | null;
  commentId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  isTargetAvailable: boolean;
};

type NotificationRow = {
  id: string;
  type: NotificationType;
  actor_id: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_avatar_object_key: string | null;
  poll_id: string | null;
  comment_id: string | null;
  payload: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
  poll_deleted_at: Date | null;
  comment_deleted_at: Date | null;
};

export function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    type: row.type,
    actor: row.actor_id && row.actor_username && row.actor_display_name
      ? {
          id: row.actor_id,
          username: row.actor_username,
          displayName: row.actor_display_name,
          avatarUrl: avatarUrlForUser(row.actor_id, row.actor_avatar_object_key)
        }
      : null,
    pollId: row.poll_id,
    commentId: row.comment_id,
    payload: row.payload,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    isTargetAvailable: row.poll_id !== null
      ? row.poll_deleted_at === null
      : row.comment_id !== null
        ? row.comment_deleted_at === null
        : true
  };
}

export async function createNotification(
  input: CreateNotificationInput,
  executor: QueryExecutor = db
) {
  if (!(await isInAppEnabled(input.recipientUserId, input.type, executor))) {
    incrementNotificationMetric('suppressed');
    return { created: false, id: null };
  }
  const result = await executor.query<{ id: string }>(
    `
      INSERT INTO notifications (
        recipient_user_id, actor_user_id, type, poll_id, comment_id,
        payload, deduplication_key
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      ON CONFLICT (deduplication_key) WHERE deduplication_key IS NOT NULL
      DO NOTHING
      RETURNING id
    `,
    [
      input.recipientUserId,
      input.actorUserId ?? null,
      input.type,
      input.pollId ?? null,
      input.commentId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.deduplicationKey
    ]
  );

  const notificationId = result.rows[0]?.id ?? null;
  if (notificationId) incrementNotificationMetric('created');
  if (notificationId && await isPushEnabled(input.recipientUserId, input.type, executor)) {
    await executor.query(
      `INSERT INTO notification_push_jobs (notification_id, recipient_user_id, type, poll_id, comment_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (notification_id) DO NOTHING`,
      [notificationId, input.recipientUserId, input.type, input.pollId ?? null, input.commentId ?? null]
    );
  }
  return { created: notificationId !== null, id: notificationId };
}

export async function listNotifications(input: {
  recipientUserId: string;
  limit: number;
  cursor?: string;
  unreadOnly?: boolean;
}) {
  const values: unknown[] = [input.recipientUserId];
  const conditions = ['n.recipient_user_id = $1'];

  if (input.unreadOnly) conditions.push('n.read_at IS NULL');
  if (input.cursor) {
    const cursor = decodeAdminCursor(input.cursor);
    values.push(cursor.createdAt, cursor.id);
    conditions.push(`(n.created_at, n.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
  }

  values.push(input.limit + 1);
  const result = await db.query<NotificationRow>(
    `
      SELECT
        n.id, n.type, n.poll_id, n.comment_id, n.payload, n.read_at, n.created_at,
        actor.id AS actor_id,
        actor.username AS actor_username,
        actor_profile.display_name AS actor_display_name,
        actor_profile.avatar_object_key AS actor_avatar_object_key,
        poll.deleted_at AS poll_deleted_at,
        comment.deleted_at AS comment_deleted_at
      FROM notifications n
      LEFT JOIN users actor ON actor.id = n.actor_user_id
      LEFT JOIN profiles actor_profile ON actor_profile.user_id = actor.id
      LEFT JOIN polls poll ON poll.id = n.poll_id
      LEFT JOIN comments comment ON comment.id = n.comment_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $${values.length}
    `,
    values
  );

  const page = pageWithCursor(result.rows.map(mapNotification), input.limit);
  return { ...page, unreadCount: await countUnreadNotifications(input.recipientUserId) };
}

export async function countUnreadNotifications(recipientUserId: string) {
  const result = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL',
    [recipientUserId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function markNotificationRead(id: string, recipientUserId: string) {
  const result = await db.query<{ id: string }>(
    `
      UPDATE notifications
      SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND recipient_user_id = $2
      RETURNING id
    `,
    [id, recipientUserId]
  );
  return result.rows.length === 1;
}

export async function markAllNotificationsRead(recipientUserId: string) {
  await db.query(
    'UPDATE notifications SET read_at = now() WHERE recipient_user_id = $1 AND read_at IS NULL',
    [recipientUserId]
  );
  return { unreadCount: 0 };
}
