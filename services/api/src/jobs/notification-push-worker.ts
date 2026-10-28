import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

import { db } from '../config/database.js';
import { InactiveAccountError, lockActiveAccounts, withActiveAccountTransaction } from '../modules/account-deletion/account-activity.guard.js';
import { listActiveNotificationDevices, revokeNotificationDevice } from '../modules/notifications/notification-devices.repository.js';

export type PushProvider = {
  send: (input: {
    token: string;
    platform: 'android' | 'ios';
    data: { notificationId: string; type: string; pollId?: string; commentId?: string };
  }) => Promise<'sent' | 'invalid_token'>;
};

const MAX_RETRY_DELAY_SECONDS = 15 * 60;
const SENDING_LEASE_SECONDS = 2 * 60;

export function pushRetryDelaySeconds(attempts: number) {
  return Math.min(2 ** Math.max(attempts - 1, 0), MAX_RETRY_DELAY_SECONDS);
}

export function shouldRetryPushJob(attempts: number, maxAttempts: number) {
  return attempts < maxAttempts;
}

type ClaimedPushJob = {
  id: string;
  notificationId: string;
  recipientUserId: string;
  type: string;
  pollId: string | null;
  commentId: string | null;
  attempts: number;
  maxAttempts: number;
};

export function createFirebasePushProvider(): PushProvider {
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault() });
  const messaging = getMessaging(app);
  return {
    async send(input) {
      try {
        await messaging.send({
          token: input.token,
          notification: { title: 'Yaskapp', body: 'You have a new notification' },
          data: input.data,
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default' } } }
        });
        return 'sent';
      } catch (error) {
        const code = (error as { errorInfo?: { code?: string } }).errorInfo?.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') return 'invalid_token';
        throw error;
      }
    }
  };
}

export async function deliverClaimedPushJob(job: ClaimedPushJob, provider: PushProvider): Promise<'sent' | 'no_devices' | 'removed' | 'inactive'> {
  try {
    return await withActiveAccountTransaction(job.recipientUserId, async (client) => {
      const current = await client.query<{
        actor_user_id: string | null;
        type: string;
        poll_id: string | null;
        comment_id: string | null;
        poll_deleted_at: Date | null;
        comment_deleted_at: Date | null;
        poll_author_id: string | null;
        comment_author_id: string | null;
      }>(
        `SELECT n.actor_user_id, n.type, n.poll_id, n.comment_id,
                p.deleted_at AS poll_deleted_at, c.deleted_at AS comment_deleted_at,
                p.author_id AS poll_author_id, c.author_id AS comment_author_id
           FROM notification_push_jobs j
           JOIN notifications n ON n.id = j.notification_id
           LEFT JOIN polls p ON p.id = n.poll_id
           LEFT JOIN comments c ON c.id = n.comment_id
          WHERE j.id = $1 AND j.notification_id = $2 AND j.recipient_user_id = $3
            AND j.status = 'sending'
          FOR UPDATE OF j`,
        [job.id, job.notificationId, job.recipientUserId]
      );
      const notification = current.rows[0];
      if (!notification) return 'removed';
      if ((notification.poll_id && (!notification.poll_author_id || notification.poll_deleted_at))
        || (notification.comment_id && (!notification.comment_author_id || notification.comment_deleted_at))) {
        await client.query("UPDATE notification_push_jobs SET status = 'failed', claimed_at = NULL, last_error = 'target_unavailable' WHERE id = $1", [job.id]);
        return 'removed';
      }

      await lockActiveAccounts(client, [
        ...(notification.actor_user_id ? [notification.actor_user_id] : []),
        ...(notification.poll_author_id ? [notification.poll_author_id] : []),
        ...(notification.comment_author_id ? [notification.comment_author_id] : [])
      ]);
      const devices = await listActiveNotificationDevices(job.recipientUserId, client);
      let deliveredToDevice = false;
      for (const device of devices) {
        const result = await provider.send({
          token: device.token,
          platform: device.platform,
          data: {
            notificationId: job.notificationId,
            type: notification.type,
            ...(notification.poll_id ? { pollId: notification.poll_id } : {}),
            ...(notification.comment_id ? { commentId: notification.comment_id } : {})
          }
        });
        if (result === 'invalid_token') await revokeNotificationDevice(job.recipientUserId, device.token, client);
        else deliveredToDevice = true;
      }
      if (deliveredToDevice) {
        await client.query(`UPDATE notification_push_jobs SET status = 'sent', claimed_at = NULL, sent_at = now(), last_error = NULL WHERE id = $1`, [job.id]);
        return 'sent';
      }
      return 'no_devices';
    });
  } catch (error) {
    if (!(error instanceof InactiveAccountError)) throw error;
    await db.query("UPDATE notification_push_jobs SET status = 'failed', claimed_at = NULL, last_error = 'account_inactive' WHERE id = $1", [job.id]);
    return 'inactive';
  }
}

export async function deliverPendingPushNotifications(provider: PushProvider, limit = 50) {
  const client = await db.connect();
  let processed = 0;
  let delivered = 0;
  try {
    await client.query('BEGIN');
    const jobs = await client.query<ClaimedPushJob>(
      `WITH claimed AS (
        SELECT id FROM notification_push_jobs
        WHERE ((status = 'pending' AND available_at <= now())
          OR (status = 'sending' AND claimed_at < now() - ($2::text || ' seconds')::interval))
          AND attempts < max_attempts
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
      )
      UPDATE notification_push_jobs j SET status = 'sending', claimed_at = now(), last_error = NULL
      FROM claimed WHERE j.id = claimed.id
      RETURNING j.id, j.notification_id AS "notificationId", j.recipient_user_id AS "recipientUserId",
        j.type, j.poll_id AS "pollId", j.comment_id AS "commentId", j.attempts, j.max_attempts AS "maxAttempts"`,
      [limit, SENDING_LEASE_SECONDS]
    );
    await client.query('COMMIT');

    for (const job of jobs.rows) {
      processed += 1;
      try {
        const result = await deliverClaimedPushJob(job, provider);
        if (result === 'sent') delivered += 1;
        else if (result === 'no_devices') {
          await schedulePushRetry(job.id, job.attempts, job.maxAttempts, 'No active notification devices.');
        }
      } catch (error) {
        await schedulePushRetry(job.id, job.attempts, job.maxAttempts, error instanceof Error ? error.message : 'Push provider failed.');
      }
    }
  } finally {
    client.release();
  }
  return { processed, delivered };
}

async function schedulePushRetry(jobId: string, attempts: number, maxAttempts: number, error: string) {
  const retry = shouldRetryPushJob(attempts, maxAttempts);
  await db.query(
    `UPDATE notification_push_jobs SET status = $2, claimed_at = NULL,
      available_at = now() + ($3::text || ' seconds')::interval,
      last_error = LEFT($4, 500), sent_at = NULL WHERE id = $1`,
    [jobId, retry ? 'pending' : 'failed', retry ? pushRetryDelaySeconds(attempts) : 0, error]
  );
}
