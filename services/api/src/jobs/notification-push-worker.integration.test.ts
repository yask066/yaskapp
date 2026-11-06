import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test, type TestContext } from 'node:test';

const databaseUrl = process.env.NOTIFICATION_WORKER_TEST_DATABASE_URL;

if (!databaseUrl) {
  test('push worker integration (requires NOTIFICATION_WORKER_TEST_DATABASE_URL)', {
    skip: 'set NOTIFICATION_WORKER_TEST_DATABASE_URL to a dedicated migrated PostgreSQL database'
  }, () => {});
} else {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  const [{ db }, { deliverPendingPushNotifications }] = await Promise.all([
    import('../config/database.js'),
    import('./notification-push-worker.js')
  ]);
  after(() => db.end());

  async function createJob(context: TestContext, withDevice = true) {
    const userId = randomUUID();
    await db.query(
      'INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)',
      [userId, `${userId}@yaskapp.test`, userId.replaceAll('-', '').slice(0, 24), 'test-hash']
    );
    context.after(() => db.query('DELETE FROM users WHERE id = $1', [userId]));
    if (withDevice) {
      await db.query("INSERT INTO notification_devices (user_id, token, platform) VALUES ($1, $2, 'android')", [userId, userId]);
    }
    const notification = await db.query(
      "INSERT INTO notifications (recipient_user_id, type) VALUES ($1, 'follow') RETURNING id", [userId]
    );
    const job = await db.query(
      `INSERT INTO notification_push_jobs (notification_id, recipient_user_id, type, max_attempts)
       VALUES ($1, $2, 'follow', 3) RETURNING id`, [notification.rows[0].id, userId]
    );
    return job.rows[0].id as string;
  }

  async function readJob(id: string) {
    return (await db.query(
      `SELECT status, attempts, claimed_at, last_error, sent_at,
              extract(epoch FROM available_at)::float8 AS available_at
       FROM notification_push_jobs WHERE id = $1`, [id]
    )).rows[0];
  }

  test('failed push sends increase backoff and stop at the attempt limit', async (context) => {
    const id = await createJob(context);
    let calls = 0;
    const provider = { async send(): Promise<'sent'> { calls += 1; throw new Error('Provider unavailable'); } };

    for (const [attempts, delay] of [[1, 1], [2, 2], [3, 0]]) {
      await db.query("UPDATE notification_push_jobs SET available_at = now() - interval '1 second' WHERE id = $1", [id]);
      const before = (await db.query('SELECT extract(epoch FROM clock_timestamp())::float8 AS time')).rows[0].time;
      assert.deepEqual(await deliverPendingPushNotifications(provider), { processed: 1, delivered: 0 });
      const after = (await db.query('SELECT extract(epoch FROM clock_timestamp())::float8 AS time')).rows[0].time;
      const job = await readJob(id);
      assert.equal(job.attempts, attempts);
      assert.equal(job.status, attempts < 3 ? 'pending' : 'failed');
      assert.equal(job.claimed_at, null);
      assert.equal(job.last_error, 'Provider unavailable');
      assert.ok(job.available_at >= before + delay && job.available_at <= after + delay);
    }
    assert.deepEqual(await deliverPendingPushNotifications(provider), { processed: 0, delivered: 0 });
    assert.equal(calls, 3);
  });

  test('push jobs without active devices stop at the attempt limit', async (context) => {
    const id = await createJob(context, false);
    const provider = { async send(): Promise<'sent'> { assert.fail('No device should be contacted'); } };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await db.query("UPDATE notification_push_jobs SET available_at = now() - interval '1 second' WHERE id = $1", [id]);
      await deliverPendingPushNotifications(provider);
    }
    const job = await readJob(id);
    assert.equal(job.attempts, 3);
    assert.equal(job.status, 'failed');
    assert.equal(job.last_error, 'No active notification devices.');
    assert.deepEqual(await deliverPendingPushNotifications(provider), { processed: 0, delivered: 0 });
  });

  test('successful push jobs are sent once', async (context) => {
    const id = await createJob(context);
    let calls = 0;
    const provider = { async send() { calls += 1; return 'sent' as const; } };
    assert.deepEqual(await deliverPendingPushNotifications(provider), { processed: 1, delivered: 1 });
    assert.deepEqual(await deliverPendingPushNotifications(provider), { processed: 0, delivered: 0 });
    const job = await readJob(id);
    assert.equal(job.status, 'sent');
    assert.equal(job.attempts, 1);
    assert.ok(job.sent_at);
    assert.equal(calls, 1);
  });

  test('recovering an expired sending lease counts another attempt', async (context) => {
    const id = await createJob(context);
    await db.query(
      "UPDATE notification_push_jobs SET status = 'sending', attempts = 1, claimed_at = now() - interval '3 minutes' WHERE id = $1", [id]
    );
    assert.deepEqual(await deliverPendingPushNotifications({ async send() { return 'sent'; } }), { processed: 1, delivered: 1 });
    const job = await readJob(id);
    assert.equal(job.attempts, 2);
    assert.equal(job.status, 'sent');
  });

  test('an expired final sending lease fails without another send', async (context) => {
    const id = await createJob(context);
    await db.query(
      "UPDATE notification_push_jobs SET status = 'sending', attempts = 3, claimed_at = now() - interval '3 minutes' WHERE id = $1", [id]
    );
    const provider = { async send(): Promise<'sent'> { assert.fail('Attempt limit was reached'); } };
    assert.deepEqual(await deliverPendingPushNotifications(provider), { processed: 0, delivered: 0 });
    const job = await readJob(id);
    assert.equal(job.status, 'failed');
    assert.equal(job.attempts, 3);
    assert.equal(job.claimed_at, null);
    assert.equal(job.last_error, 'Push delivery lease expired.');
  });

  test('a locked expired final lease does not block unrelated push jobs', async (context) => {
    const lockedId = await createJob(context);
    const pendingId = await createJob(context);
    await db.query(
      "UPDATE notification_push_jobs SET status = 'sending', attempts = 3, claimed_at = now() - interval '3 minutes' WHERE id = $1", [lockedId]
    );
    const lock = await db.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM notification_push_jobs WHERE id = $1 FOR UPDATE', [lockedId]);
    const delivery = deliverPendingPushNotifications({ async send() { return 'sent'; } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        delivery,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Unrelated push job blocked by expired lease')), 2_000);
        })
      ]);
      assert.equal((await readJob(pendingId)).status, 'sent');
      assert.equal((await readJob(lockedId)).status, 'sending');
    } finally {
      clearTimeout(timer);
      await lock.query('ROLLBACK');
      lock.release();
      await delivery;
    }
  });
}
