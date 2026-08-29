import { db } from '../config/database.js';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { listActiveNotificationDevices, revokeNotificationDevice } from '../modules/notifications/notification-devices.repository.js';

export type PushProvider = {
  send: (input: {
    token: string;
    platform: 'android' | 'ios';
    data: { notificationId: string; type: string; pollId?: string; commentId?: string };
  }) => Promise<'sent' | 'invalid_token'>;
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
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          return 'invalid_token';
        }
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
      id: string;
      notificationId: string;
      recipientUserId: string;
      type: string;
      pollId: string | null;
      commentId: string | null;
    }>(
      `WITH claimed AS (
        SELECT id FROM notification_push_jobs
        WHERE status = 'pending' AND available_at <= now()
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
      )
      UPDATE notification_push_jobs j SET status = 'sending', attempts = attempts + 1
      FROM claimed WHERE j.id = claimed.id
      RETURNING j.id, j.notification_id AS "notificationId", j.recipient_user_id AS "recipientUserId",
        j.type, j.poll_id AS "pollId", j.comment_id AS "commentId"`,
      [limit]
    );
    await client.query('COMMIT');

    for (const job of jobs.rows) {
      processed += 1;
      const devices = await listActiveNotificationDevices(job.recipientUserId);
      let sent = false;
      for (const device of devices) {
        const result = await provider.send({
          token: device.token,
          platform: device.platform,
          data: {
            notificationId: job.notificationId,
            type: job.type,
            ...(job.pollId ? { pollId: job.pollId } : {}),
            ...(job.commentId ? { commentId: job.commentId } : {})
          }
        });
        if (result === 'invalid_token') {
          await revokeNotificationDevice(job.recipientUserId, device.token);
        } else {
          sent = true;
        }
      }
      await db.query(
        `UPDATE notification_push_jobs SET status = $2, attempts = attempts + 1,
         sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id = $1`,
        [job.id, sent ? 'sent' : 'failed']
      );
      if (sent) delivered += 1;
    }
  } finally {
    client.release();
  }
  return { processed, delivered };
}
