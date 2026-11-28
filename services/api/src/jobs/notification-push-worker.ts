import { randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

import { db } from '../config/database.js';
import { InactiveAccountError, lockActiveAccounts } from '../modules/account-deletion/account-activity.guard.js';
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
  leaseOwner?: string | null;
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
        const code = (error as { code?: string } | null)?.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') return 'invalid_token';
        throw error;
      }
    }
  };
}

export async function deliverClaimedPushJob(job: ClaimedPushJob, provider: PushProvider): Promise<'sent' | 'no_devices' | 'removed' | 'inactive'> {
  const leaseOwner = job.leaseOwner ?? null;
  let prepared: {
    notification: { type: string; poll_id: string | null; comment_id: string | null };
    devices: Array<{ token: string; platform: 'android' | 'ios' }>;
  };

  const prepClient = await db.connect();
  try {
    await prepClient.query('BEGIN');
    const current = await prepClient.query<{
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
          AND ($4::uuid IS NULL OR j.lease_owner = $4::uuid)
        FOR UPDATE OF j`,
      [job.id, job.notificationId, job.recipientUserId, leaseOwner]
    );
    const notification = current.rows[0];
    if (!notification) {
      await prepClient.query('COMMIT');
      return 'removed';
    }
    if ((notification.poll_id && (!notification.poll_author_id || notification.poll_deleted_at))
      || (notification.comment_id && (!notification.comment_author_id || notification.comment_deleted_at))) {
      await prepClient.query(
        `UPDATE notification_push_jobs
            SET status = 'failed', claimed_at = NULL, lease_owner = NULL, last_error = 'target_unavailable'
          WHERE id = $1 AND ($2::uuid IS NULL OR lease_owner = $2::uuid)`,
        [job.id, leaseOwner]
      );
      await prepClient.query('COMMIT');
      return 'removed';
    }

    // Lock all involved users in a single sorted order to prevent AB/BA deadlocks.
    await lockActiveAccounts(prepClient, [
      job.recipientUserId,
      ...(notification.actor_user_id ? [notification.actor_user_id] : []),
      ...(notification.poll_author_id ? [notification.poll_author_id] : []),
      ...(notification.comment_author_id ? [notification.comment_author_id] : [])
    ]);
    const devices = await listActiveNotificationDevices(job.recipientUserId, prepClient);
    await prepClient.query('COMMIT');
    prepared = {
      notification: {
        type: notification.type,
        poll_id: notification.poll_id,
        comment_id: notification.comment_id
      },
      devices
    };
  } catch (error) {
    await prepClient.query('ROLLBACK').catch(() => undefined);
    if (!(error instanceof InactiveAccountError)) throw error;
    await db.query(
      "UPDATE notification_push_jobs SET status = 'failed', claimed_at = NULL, lease_owner = NULL, last_error = 'account_inactive' WHERE id = $1 AND ($2::uuid IS NULL OR lease_owner = $2::uuid)",
      [job.id, leaseOwner]
    );
    return 'inactive';
  } finally {
    prepClient.release();
  }

  // Execute external FCM calls strictly outside any PostgreSQL transaction.
  let deliveredToDevice = false;
  const invalidTokens: string[] = [];
  let lastTransientError: unknown = null;

  for (const device of prepared.devices) {
    try {
      const result = await provider.send({
        token: device.token,
        platform: device.platform,
        data: {
          notificationId: job.notificationId,
          type: prepared.notification.type,
          ...(prepared.notification.poll_id ? { pollId: prepared.notification.poll_id } : {}),
          ...(prepared.notification.comment_id ? { commentId: prepared.notification.comment_id } : {})
        }
      });
      if (result === 'invalid_token') invalidTokens.push(device.token);
      else deliveredToDevice = true;
    } catch (error) {
      lastTransientError = error;
    }
  }

  const finishClient = await db.connect();
  try {
    await finishClient.query('BEGIN');
    for (const token of invalidTokens) {
      await revokeNotificationDevice(job.recipientUserId, token, finishClient);
    }
    if (deliveredToDevice) {
      await finishClient.query(
        `UPDATE notification_push_jobs
            SET status = 'sent', claimed_at = NULL, lease_owner = NULL, sent_at = now(), last_error = NULL
          WHERE id = $1 AND status = 'sending' AND ($2::uuid IS NULL OR lease_owner = $2::uuid)`,
        [job.id, leaseOwner]
      );
    }
    await finishClient.query('COMMIT');
  } catch (error) {
    await finishClient.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    finishClient.release();
  }

  if (deliveredToDevice) return 'sent';
  if (lastTransientError) throw lastTransientError;
  return 'no_devices';
}

export async function deliverPendingPushNotifications(provider: PushProvider, limit = 20) {
  const client = await db.connect();
  const leaseOwner = randomUUID();
  let processed = 0;
  let delivered = 0;
  let claimedJobs: ClaimedPushJob[] = [];
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE notification_push_jobs
       SET status = 'failed', claimed_at = NULL, lease_owner = NULL, last_error = 'Push delivery lease expired.'
       WHERE id IN (
         SELECT id FROM notification_push_jobs
         WHERE status = 'sending' AND attempts >= max_attempts
           AND claimed_at < now() - ($1::text || ' seconds')::interval
         FOR UPDATE SKIP LOCKED
       )`,
      [SENDING_LEASE_SECONDS]
    );
    const jobs = await client.query<ClaimedPushJob>(
      `WITH claimed AS (
        SELECT id FROM notification_push_jobs
        WHERE ((status = 'pending' AND available_at <= now())
          OR (status = 'sending' AND claimed_at < now() - ($2::text || ' seconds')::interval))
          AND attempts < max_attempts
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
      )
      UPDATE notification_push_jobs j
         SET status = 'sending', attempts = j.attempts + 1,
             claimed_at = now(), lease_owner = $3, last_error = NULL
      FROM claimed WHERE j.id = claimed.id
      RETURNING j.id, j.notification_id AS "notificationId", j.recipient_user_id AS "recipientUserId",
        j.type, j.poll_id AS "pollId", j.comment_id AS "commentId", j.attempts,
        j.max_attempts AS "maxAttempts", j.lease_owner AS "leaseOwner"`,
      [limit, SENDING_LEASE_SECONDS, leaseOwner]
    );
    await client.query('COMMIT');
    claimedJobs = jobs.rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  for (const job of claimedJobs) {
    processed += 1;
    try {
      const result = await deliverClaimedPushJob(job, provider);
      if (result === 'sent') delivered += 1;
      else if (result === 'no_devices') {
        await schedulePushRetry(job.id, job.attempts, job.maxAttempts, 'No active notification devices.', job.leaseOwner ?? null);
      }
    } catch (error) {
      await schedulePushRetry(job.id, job.attempts, job.maxAttempts, error instanceof Error ? error.message : 'Push provider failed.', job.leaseOwner ?? null);
    }
  }
  return { processed, delivered };
}

async function schedulePushRetry(
  jobId: string,
  attempts: number,
  maxAttempts: number,
  error: string,
  leaseOwner: string | null = null
) {
  const retry = shouldRetryPushJob(attempts, maxAttempts);
  await db.query(
    `UPDATE notification_push_jobs
        SET status = $2, claimed_at = NULL, lease_owner = NULL,
            available_at = now() + ($3::text || ' seconds')::interval,
            last_error = LEFT($4, 500), sent_at = NULL
      WHERE id = $1 AND ($5::uuid IS NULL OR lease_owner = $5::uuid)`,
    [jobId, retry ? 'pending' : 'failed', retry ? pushRetryDelaySeconds(attempts) : 0, error, leaseOwner]
  );
}
