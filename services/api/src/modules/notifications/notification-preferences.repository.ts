import type { Pool, PoolClient } from 'pg';

import { db } from '../../config/database.js';
import type { NotificationType } from './notifications.repository.js';

type QueryExecutor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export type NotificationPreferences = Record<NotificationType, { inApp: boolean; push: boolean }>;
export type NotificationPreferencesPatch = Partial<Record<NotificationType, Partial<{ inApp: boolean; push: boolean }>>>;

const columns: Record<NotificationType, { inApp: string; push: string }> = {
  poll_vote: { inApp: 'poll_vote_in_app', push: 'poll_vote_push' },
  comment: { inApp: 'comment_in_app', push: 'comment_push' },
  comment_reply: { inApp: 'comment_reply_in_app', push: 'comment_reply_push' },
  like: { inApp: 'like_in_app', push: 'like_push' },
  follow: { inApp: 'follow_in_app', push: 'follow_push' }
};

function mapRow(row: Record<string, boolean>): NotificationPreferences {
  return {
    poll_vote: { inApp: row.poll_vote_in_app, push: row.poll_vote_push },
    comment: { inApp: row.comment_in_app, push: row.comment_push },
    comment_reply: { inApp: row.comment_reply_in_app, push: row.comment_reply_push },
    like: { inApp: row.like_in_app, push: row.like_push },
    follow: { inApp: row.follow_in_app, push: row.follow_push }
  };
}

export async function getNotificationPreferences(userId: string, executor: QueryExecutor = db) {
  const result = await executor.query<Record<string, boolean>>(
    `
      SELECT poll_vote_in_app, poll_vote_push, comment_in_app, comment_push,
        comment_reply_in_app, comment_reply_push, like_in_app, like_push,
        follow_in_app, follow_push
      FROM notification_preferences
      WHERE user_id = $1
    `,
    [userId]
  );
  if (!result.rows[0]) return defaultNotificationPreferences();
  return mapRow(result.rows[0]);
}

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    poll_vote: { inApp: true, push: false },
    comment: { inApp: true, push: false },
    comment_reply: { inApp: true, push: false },
    like: { inApp: true, push: false },
    follow: { inApp: true, push: false }
  };
}

export async function isInAppEnabled(userId: string, type: NotificationType, executor: QueryExecutor = db) {
  const preference = columns[type];
  const result = await executor.query<{ enabled: boolean }>(
    `SELECT COALESCE((SELECT ${preference.inApp} FROM notification_preferences WHERE user_id = $1), TRUE) AS enabled`,
    [userId]
  );
  return result.rows[0]?.enabled ?? true;
}

export async function isPushEnabled(userId: string, type: NotificationType, executor: QueryExecutor = db) {
  const preference = columns[type];
  const result = await executor.query<{ enabled: boolean }>(
    `SELECT COALESCE((SELECT ${preference.push} FROM notification_preferences WHERE user_id = $1), FALSE) AS enabled`,
    [userId]
  );
  return result.rows[0]?.enabled ?? false;
}

export async function updateNotificationPreferences(
  userId: string,
  input: NotificationPreferencesPatch,
  executor: QueryExecutor = db
) {
  const current = await getNotificationPreferences(userId, executor);
  const next = { ...current };
  for (const type of Object.keys(columns) as NotificationType[]) {
    if (input[type]) next[type] = { ...current[type], ...input[type] };
  }

  await executor.query(
    `
      INSERT INTO notification_preferences (
        user_id, poll_vote_in_app, poll_vote_push, comment_in_app, comment_push,
        comment_reply_in_app, comment_reply_push, like_in_app, like_push,
        follow_in_app, follow_push
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (user_id) DO UPDATE SET
        poll_vote_in_app = EXCLUDED.poll_vote_in_app, poll_vote_push = EXCLUDED.poll_vote_push,
        comment_in_app = EXCLUDED.comment_in_app, comment_push = EXCLUDED.comment_push,
        comment_reply_in_app = EXCLUDED.comment_reply_in_app, comment_reply_push = EXCLUDED.comment_reply_push,
        like_in_app = EXCLUDED.like_in_app, like_push = EXCLUDED.like_push,
        follow_in_app = EXCLUDED.follow_in_app, follow_push = EXCLUDED.follow_push
    `,
    [userId, next.poll_vote.inApp, next.poll_vote.push, next.comment.inApp, next.comment.push, next.comment_reply.inApp, next.comment_reply.push, next.like.inApp, next.like.push, next.follow.inApp, next.follow.push]
  );
  return next;
}
