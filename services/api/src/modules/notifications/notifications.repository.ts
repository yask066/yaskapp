import type { NotificationItem, NotificationType } from '@yaskapp/shared';
import type { Pool, PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { decodeAdminCursor, pageWithCursor } from '../admin/pagination.js';
import { avatarUrlForUser } from '../profiles/avatar-url.js';
import { isInAppEnabled, isPushEnabled } from './notification-preferences.repository.js';
import { incrementNotificationMetric } from './notifications.metrics.js';

export type QueryExecutor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export type CreateNotificationInput = {
  recipientUserId: string;
  actorUserId?: string;
  type: NotificationType;
  pollId?: string;
  commentId?: string;
  payload?: Record<string, unknown>;
  deduplicationKey: string;
};

export type NotificationRecord = NotificationItem;

type NotificationRow = {
  id: string;
  type: NotificationType;
  actor_id: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_avatar_object_key: string | null;
  actor_deleted_at: Date | null;
  poll_id: string | null;
  comment_id: string | null;
  payload: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
  poll_deleted_at: Date | null;
  comment_deleted_at: Date | null;
};

const displayPayloadKeys = new Set(['displayName', 'pollQuestion', 'optionLabel', 'commentExcerpt']);

function safeDisplayPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => displayPayloadKeys.has(key) && (
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null
    ))
  );
}

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
    targetType: row.comment_id !== null ? 'comment' : row.poll_id !== null ? 'poll' : 'profile',
    payload: safeDisplayPayload(row.payload),
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    isTargetAvailable: row.poll_id !== null
      ? row.poll_deleted_at === null
      : row.comment_id !== null
        ? row.comment_deleted_at === null && row.poll_deleted_at === null
        : row.actor_id !== null && row.actor_deleted_at === null
  };
}

const notificationSelect = `
  n.id, n.type, n.poll_id, n.comment_id, n.payload, n.read_at, n.created_at,
  actor.id AS actor_id,
  actor.username AS actor_username,
  actor_profile.display_name AS actor_display_name,
  actor_profile.avatar_object_key AS actor_avatar_object_key,
  actor.deleted_at AS actor_deleted_at,
  poll.deleted_at AS poll_deleted_at,
  comment.deleted_at AS comment_deleted_at
FROM notifications n
LEFT JOIN users actor ON actor.id = n.actor_user_id
LEFT JOIN profiles actor_profile ON actor_profile.user_id = actor.id
LEFT JOIN polls poll ON poll.id = n.poll_id
LEFT JOIN comments comment ON comment.id = n.comment_id`;

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
        ${notificationSelect}
      WHERE ${conditions.join(' AND ')}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $${values.length}
    `,
    values
  );

  const page = pageWithCursor(result.rows.map(mapNotification), input.limit);
  return { ...page, unreadCount: await countUnreadNotifications(input.recipientUserId) };
}

export async function countUnreadNotifications(recipientUserId: string, executor: QueryExecutor = db) {
  const result = await executor.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL',
    [recipientUserId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function getNotificationForRecipient(
  id: string,
  recipientUserId: string,
  executor: QueryExecutor = db
) {
  const result = await executor.query<NotificationRow>(
    `SELECT ${notificationSelect} WHERE n.id = $1 AND n.recipient_user_id = $2`,
    [id, recipientUserId]
  );
  return result.rows[0] ? mapNotification(result.rows[0]) : null;
}

export async function markNotificationRead(
  id: string,
  recipientUserId: string,
  executor: QueryExecutor = db
) {
  const result = await executor.query<{
    notification_id: string;
    read_at: Date;
  }>(
    `
      UPDATE notifications
      SET read_at = COALESCE(read_at, now())
      WHERE id = $1 AND recipient_user_id = $2
      RETURNING id AS notification_id, read_at
    `,
    [id, recipientUserId]
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    notificationId: row.notification_id,
    readAt: row.read_at.toISOString(),
    unreadCount: await countUnreadNotifications(recipientUserId, executor)
  };
}

export async function markAllNotificationsRead(recipientUserId: string, executor: QueryExecutor = db) {
  const result = await executor.query<{ read_at: Date; updated_count: number }>(
    `
      WITH marked AS (
        UPDATE notifications
        SET read_at = now()
        WHERE recipient_user_id = $1 AND read_at IS NULL
        RETURNING read_at
      ), fallback AS (
        SELECT MAX(read_at) AS read_at
        FROM notifications
        WHERE recipient_user_id = $1
      )
      SELECT COALESCE((SELECT MAX(read_at) FROM marked), fallback.read_at, now()) AS read_at,
             (SELECT COUNT(*)::int FROM marked) AS updated_count
      FROM fallback
    `,
    [recipientUserId]
  );
  const row = result.rows[0];
  return {
    readAt: row.read_at.toISOString(),
    updatedCount: row.updated_count,
    unreadCount: 0 as const
  };
}
