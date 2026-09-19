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

  const deviceToken = `device-token-${suffix}-abcdefghijklmnop`;
  const registeredDevice = await app.inject({
    method: 'POST',
    url: '/notification-devices',
    headers: bearer(auth.accessToken),
    payload: { token: deviceToken, platform: 'android' }
  });
  assert.equal(registeredDevice.statusCode, 201, registeredDevice.body);
  assert.ok(registeredDevice.json<{ id: string }>().id);

  const repeatedDevice = await app.inject({
    method: 'POST',
    url: '/notification-devices',
    headers: bearer(auth.accessToken),
    payload: { token: deviceToken, platform: 'android' }
  });
  assert.equal(repeatedDevice.statusCode, 201, repeatedDevice.body);
  assert.equal(repeatedDevice.json<{ id: string }>().id, registeredDevice.json<{ id: string }>().id);

  const revokedDevice = await app.inject({
    method: 'DELETE',
    url: '/notification-devices',
    headers: bearer(auth.accessToken),
    payload: { token: deviceToken }
  });
  assert.equal(revokedDevice.statusCode, 204, revokedDevice.body);

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
  assert.deepEqual(list.json<{ items: Array<{ targetType: string; actor: unknown; payload: unknown; isTargetAvailable: boolean }> }>().items[0], {
    ...list.json<{ items: Array<Record<string, unknown>> }>().items[0],
    targetType: 'profile',
    actor: null,
    payload: {},
    isTargetAvailable: false
  });

  const unreadCount = await app.inject({ method: 'GET', url: '/notifications/unread-count', headers: bearer(auth.accessToken) });
  assert.equal(unreadCount.statusCode, 200, unreadCount.body);
  assert.deepEqual(unreadCount.json(), { unreadCount: 1 });

  const notificationId = list.json<{ items: Array<{ id: string }> }>().items[0].id;
  const otherRegistration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `notification_other_${suffix}@yaskapp.test`,
      username: `other_ntf_${suffix}`,
      password: 'password123',
      displayName: 'Other Notification User',
      countryCode: 'BY'
    }
  });
  assert.equal(otherRegistration.statusCode, 201, otherRegistration.body);
  const otherAuth = otherRegistration.json<{ accessToken: string }>();
  const foreignRead = await app.inject({
    method: 'POST',
    url: `/notifications/${notificationId}/read`,
    headers: bearer(otherAuth.accessToken)
  });
  assert.equal(foreignRead.statusCode, 404, foreignRead.body);

  const read = await app.inject({
    method: 'POST',
    url: `/notifications/${notificationId}/read`,
    headers: bearer(auth.accessToken)
  });
  assert.equal(read.statusCode, 200, read.body);
  const readResponse = read.json<{ notificationId: string; readAt: string; unreadCount: number }>();
  assert.deepEqual(Object.keys(readResponse).sort(), ['notificationId', 'readAt', 'unreadCount']);
  assert.equal(readResponse.notificationId, notificationId);
  assert.match(readResponse.readAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal(readResponse.unreadCount, 0);

  const repeatedRead = await app.inject({
    method: 'POST',
    url: `/notifications/${notificationId}/read`,
    headers: bearer(auth.accessToken)
  });
  assert.equal(repeatedRead.statusCode, 200, repeatedRead.body);
  assert.deepEqual(repeatedRead.json(), readResponse);

  await db.query(
    `INSERT INTO notifications (recipient_user_id, type, payload, deduplication_key)
     VALUES ($1, 'follow', '{"email":"private"}'::jsonb, $2)`,
    [auth.user.id, `test:read-all:${suffix}`]
  );
  const readAll = await app.inject({
    method: 'POST',
    url: '/notifications/read-all',
    headers: bearer(auth.accessToken)
  });
  assert.equal(readAll.statusCode, 200, readAll.body);
  const readAllResponse = readAll.json<{ readAt: string; updatedCount: number; unreadCount: 0 }>();
  assert.deepEqual(Object.keys(readAllResponse).sort(), ['readAt', 'unreadCount', 'updatedCount']);
  assert.match(readAllResponse.readAt, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal(readAllResponse.updatedCount, 1);
  assert.equal(readAllResponse.unreadCount, 0);

  const repeatedReadAll = await app.inject({
    method: 'POST',
    url: '/notifications/read-all',
    headers: bearer(auth.accessToken)
  });
  assert.equal(repeatedReadAll.statusCode, 200, repeatedReadAll.body);
  assert.equal(repeatedReadAll.json<{ updatedCount: number }>().updatedCount, 0);

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
