import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.NODE_ENV = 'test';

const [{ buildApp }, { db, closeDatabaseConnection }, { closeRedisConnection }, { closeStorageConnection }, { createNotification }] = await Promise.all([
  import('../../app.js'),
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('../../config/storage.js'),
  import('./notifications.repository.js')
]);

const app = buildApp();

after(async () => {
  await app.close();
  await closeDatabaseConnection();
  await closeRedisConnection();
  await closeStorageConnection();
});

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

test('notifications API is authenticated, cursor-based and owner-scoped', async () => {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const registration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `notification_${suffix}@yaskapp.test`,
      username: `ntf_${suffix}`,
      password: 'password123',
      displayName: 'Notification User',
      countryCode: 'BY'
    }
  });
  assert.equal(registration.statusCode, 201, registration.body);
  const auth = registration.json<{ user: { id: string }; accessToken: string }>();

  const defaults = await app.inject({ method: 'GET', url: '/notification-preferences', headers: bearer(auth.accessToken) });
  assert.equal(defaults.statusCode, 200, defaults.body);
  assert.equal(defaults.json<{ follow: { inApp: boolean; push: boolean } }>().follow.inApp, true);

  const updatedPreferences = await app.inject({
    method: 'PATCH',
    url: '/notification-preferences',
    headers: bearer(auth.accessToken),
    payload: { follow: { inApp: false, push: true } }
  });
  assert.equal(updatedPreferences.statusCode, 200, updatedPreferences.body);
  assert.deepEqual(updatedPreferences.json<{ follow: { inApp: boolean; push: boolean } }>().follow, { inApp: false, push: true });

  const suppressed = await createNotification({
    recipientUserId: auth.user.id,
    type: 'follow',
    deduplicationKey: `suppressed:${suffix}`
  });
  assert.equal(suppressed.created, false);

  const reenabledPreferences = await app.inject({
    method: 'PATCH',
    url: '/notification-preferences',
    headers: bearer(auth.accessToken),
    payload: { follow: { inApp: true } }
  });
  assert.equal(reenabledPreferences.statusCode, 200, reenabledPreferences.body);

  await db.query(
    `INSERT INTO notifications (recipient_user_id, type, payload, deduplication_key)
     VALUES ($1, 'follow', '{}'::jsonb, $2)`,
    [auth.user.id, `test:${suffix}`]
  );

  const duplicate = await createNotification({
    recipientUserId: auth.user.id,
    type: 'follow',
    deduplicationKey: `test:${suffix}`
  });
  assert.equal(duplicate.created, false);

  const list = await app.inject({ method: 'GET', url: '/notifications', headers: bearer(auth.accessToken) });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json<{ items: unknown[]; unreadCount: number }>().items.length, 1);
  assert.equal(list.json<{ unreadCount: number }>().unreadCount, 1);

  const notificationId = list.json<{ items: Array<{ id: string }> }>().items[0].id;
  const read = await app.inject({
    method: 'POST',
    url: `/notifications/${notificationId}/read`,
    headers: bearer(auth.accessToken)
  });
  assert.equal(read.statusCode, 204, read.body);

  const repeatedRead = await app.inject({
    method: 'POST',
    url: `/notifications/${notificationId}/read`,
    headers: bearer(auth.accessToken)
  });
  assert.equal(repeatedRead.statusCode, 204, repeatedRead.body);

  const invalidCursor = await app.inject({
    method: 'GET',
    url: '/notifications?cursor=invalid',
    headers: bearer(auth.accessToken)
  });
  assert.equal(invalidCursor.statusCode, 422, invalidCursor.body);

  const missing = await app.inject({
    method: 'POST',
    url: '/notifications/00000000-0000-0000-0000-000000000000/read',
    headers: bearer(auth.accessToken)
  });
  assert.equal(missing.statusCode, 404, missing.body);

  const unread = await app.inject({
    method: 'GET',
    url: '/notifications?unreadOnly=true',
    headers: bearer(auth.accessToken)
  });
  assert.equal(unread.statusCode, 200, unread.body);
  assert.equal(unread.json<{ items: unknown[]; unreadCount: number }>().items.length, 0);
  assert.equal(unread.json<{ unreadCount: number }>().unreadCount, 0);

  const unauthenticated = await app.inject({ method: 'GET', url: '/notifications' });
  assert.equal(unauthenticated.statusCode, 401);
});
