import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';

const [{ db, closeDatabaseConnection }, { closeRedisConnection }, { closeStorageConnection }, { purgeAccountNotifications }, { deliverClaimedPushJob }, { countUnreadNotifications }] = await Promise.all([
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('../../config/storage.js'),
  import('./account-deletion.notifications.js'),
  import('../../jobs/notification-push-worker.js'),
  import('../notifications/notifications.repository.js')
]);

const userIds = new Set<string>();
const operationIds = new Set<string>();

function suffix() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

async function createUser() {
  const id = randomUUID();
  const username = `ad09_${suffix()}`;
  await db.query('INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)', [id, `${username}@yaskapp.test`, username, 'test-hash']);
  await db.query('INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)', [id, username]);
  userIds.add(id);
  return id;
}

async function createOperation(userId: string) {
  const id = randomUUID();
  await db.query(`INSERT INTO account_deletion_operations (id, user_id, status, accepted_at, deadline_at)
    VALUES ($1, $2, 'pending', now(), now() + interval '24 hours')`, [id, userId]);
  await db.query("UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = $1", [userId]);
  operationIds.add(id);
  return id;
}

after(async () => {
  for (const id of operationIds) await db.query('DELETE FROM account_deletion_operations WHERE id = $1', [id]);
  for (const id of userIds) await db.query('DELETE FROM users WHERE id = $1', [id]);
  await closeDatabaseConnection();
  await closeRedisConnection();
  await closeStorageConnection();
});

test('notification_payload_purged_before_actor_fk_null', async () => {
  const deletedUserId = await createUser();
  const recipientId = await createUser();
  const unrelatedActorId = await createUser();
  const operationId = await createOperation(deletedUserId);
  const notificationId = randomUUID();
  await db.query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [deletedUserId]);
  await db.query("INSERT INTO notification_devices (user_id, token, platform) VALUES ($1, 'ad09-device-token', 'ios')", [deletedUserId]);
  await db.query(`INSERT INTO notifications (id, recipient_user_id, actor_user_id, type, payload)
    VALUES ($1, $2, $3, 'follow', $4::jsonb)`, [notificationId, recipientId, deletedUserId, JSON.stringify({ displayName: 'Private name', privateNote: 'secret' })]);
  await db.query(`INSERT INTO notification_push_jobs (notification_id, recipient_user_id, type)
    VALUES ($1, $2, 'follow')`, [notificationId, recipientId]);
  await db.query(`INSERT INTO notifications (recipient_user_id, actor_user_id, type, payload)
    VALUES ($1, $2, 'follow', '{}'::jsonb)`, [recipientId, unrelatedActorId]);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await purgeAccountNotifications(operationId)).done) break;
  }

  const notification = await db.query('SELECT id FROM notifications WHERE id = $1', [notificationId]);
  const job = await db.query('SELECT id FROM notification_push_jobs WHERE notification_id = $1', [notificationId]);
  const devices = await db.query('SELECT id FROM notification_devices WHERE user_id = $1', [deletedUserId]);
  const preferences = await db.query('SELECT user_id FROM notification_preferences WHERE user_id = $1', [deletedUserId]);
  const unreadCount = await countUnreadNotifications(recipientId);
  assert.equal(notification.rowCount, 0);
  assert.equal(job.rowCount, 0);
  assert.equal(devices.rowCount, 0);
  assert.equal(preferences.rowCount, 0);
  assert.equal(unreadCount, 1);
});

test('claimed_push_cannot_recreate_job', async () => {
  const deletedUserId = await createUser();
  const recipientId = await createUser();
  const operationId = await createOperation(deletedUserId);
  const notificationId = randomUUID();
  await db.query(`INSERT INTO notifications (id, recipient_user_id, actor_user_id, type)
    VALUES ($1, $2, $3, 'follow')`, [notificationId, recipientId, deletedUserId]);
  const claimed = (await db.query<{ id: string; notificationId: string; recipientUserId: string; type: string; pollId: string | null; commentId: string | null; attempts: number; maxAttempts: number }>(
    `INSERT INTO notification_push_jobs (notification_id, recipient_user_id, type, status, claimed_at)
     VALUES ($1, $2, 'follow', 'sending', now())
     RETURNING id, notification_id AS "notificationId", recipient_user_id AS "recipientUserId", type,
       poll_id AS "pollId", comment_id AS "commentId", attempts, max_attempts AS "maxAttempts"`,
    [notificationId, recipientId]
  )).rows[0];

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await purgeAccountNotifications(operationId)).done) break;
  }
  let providerCalls = 0;
  await deliverClaimedPushJob(claimed, { send: async () => { providerCalls += 1; return 'sent'; } });

  const job = await db.query('SELECT id FROM notification_push_jobs WHERE id = $1', [claimed.id]);
  assert.equal(providerCalls, 0);
  assert.equal(job.rowCount, 0);
});
