import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

import { db } from '../config/database.js';
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

export async function deliverPendingPushNotifications(provider: PushProvider, limit = 50) {
  const client = await db.connect();
  let processed = 0;
  let delivered = 0;
  try {
    await client.query('BEGIN');
    const jobs = await client.query<{
      id: string; notificationId: string; recipientUserId: string; type: string;
      pollId: string | null; commentId: string | null; attempts: number; maxAttempts: number;
    }>(
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
        const devices = await listActiveNotificationDevices(job.recipientUserId);
        let sent = false;
        for (const device of devices) {
          const result = await provider.send({
            token: device.token, platform: device.platform,
            data: { notificationId: job.notificationId, type: job.type, ...(job.pollId ? { pollId: job.pollId } : {}), ...(job.commentId ? { commentId: job.commentId } : {}) }
          });
          if (result === 'invalid_token') await revokeNotificationDevice(job.recipientUserId, device.token);
          else sent = true;
        }
        if (sent) {
          await db.query(`UPDATE notification_push_jobs SET status = 'sent', claimed_at = NULL, sent_at = now(), last_error = NULL WHERE id = $1`, [job.id]);
          delivered += 1;
        } else {
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
