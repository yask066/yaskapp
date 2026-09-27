import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import type { RealtimeEvent } from '@yaskapp/shared';

process.env.NODE_ENV = 'test';

const [
  { buildApp },
  { db, closeDatabaseConnection },
  { closeRedisConnection },
  { closeStorageConnection },
  { createNotification },
  { publishNotificationAfterCommit },
  { RealtimeBus },
  { RealtimeHub }
] = await Promise.all([
  import('../../app.js'),
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('../../config/storage.js'),
  import('./notifications.repository.js'),
  import('./notifications.publisher.js'),
  import('../../realtime/realtime.bus.js'),
  import('../../realtime/realtime.hub.js')
]);

const app = buildApp();

function createApiNode() {
  const hub = new RealtimeHub();
  const removeClients: Array<() => void> = [];
  const bus = new RealtimeBus();

  return {
    connect(userId: string) {
      const events: RealtimeEvent[] = [];
      removeClients.push(hub.addRealtimeClient({
        readyState: 1,
        send(data) {
          events.push(JSON.parse(data) as RealtimeEvent);
        }
      }, userId));
      // The connection.ready handshake is not part of the notification assertions.
      events.length = 0;
      return events;
    },
    async start() {
      await bus.start(({ recipientUserId, event }) => hub.sendToUser(recipientUserId, event));
    },
    async close() {
      removeClients.splice(0).forEach((remove) => remove());
      await bus.close();
    }
  };
}

const firstNode = createApiNode();
const secondNode = createApiNode();

after(async () => {
  await Promise.all([firstNode.close(), secondNode.close(), app.close()]);
  await closeDatabaseConnection();
  await closeRedisConnection();
  await closeStorageConnection();
});

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function registerUser(usernamePrefix: string) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const username = `${usernamePrefix}_${Math.random().toString(36).slice(2, 8)}`;
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `${usernamePrefix}_${suffix}@yaskapp.test`,
      username,
      password: 'password123',
      displayName: 'Realtime Test User',
      countryCode: 'BY'
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ user: { id: string }; accessToken: string }>();
}

async function waitForEvent(
  events: RealtimeEvent[],
  type: RealtimeEvent['type'],
  occurrence = 1,
  timeoutMs = 2_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.filter((event) => event.type === type)[occurrence - 1];
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${type}; received ${events.map((event) => event.type).join(', ')}`);
}

function countEventType(events: RealtimeEvent[], type: string) {
  return events.map((event) => String(event.type)).filter((eventType) => eventType === type).length;
}

test('two API nodes fan out committed create, read and read-all events only to recipient sockets', async () => {
  const recipient = await registerUser('mn_recipient');
  const unrelated = await registerUser('mn_other');
  const firstRecipientEvents = firstNode.connect(recipient.user.id);
  const firstUnrelatedEvents = firstNode.connect(unrelated.user.id);
  const secondRecipientEvents = secondNode.connect(recipient.user.id);
  const secondUnrelatedEvents = secondNode.connect(unrelated.user.id);
  await Promise.all([firstNode.start(), secondNode.start()]);

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const transaction = await db.connect();
  let createdNotificationId: string;
  try {
    await transaction.query('BEGIN');
    const created = await createNotification({
      recipientUserId: recipient.user.id,
      type: 'follow',
      deduplicationKey: `multinode-uncommitted:${suffix}`
    }, transaction);
    assert.equal(created.created, true);
    assert.ok(created.id);
    createdNotificationId = created.id;

    await publishNotificationAfterCommit(recipient.user.id, createdNotificationId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(firstRecipientEvents, []);
    assert.deepEqual(secondRecipientEvents, []);

    await transaction.query('COMMIT');
  } catch (error) {
    await transaction.query('ROLLBACK');
    throw error;
  } finally {
    transaction.release();
  }

  await publishNotificationAfterCommit(recipient.user.id, createdNotificationId);
  const [firstCreated, secondCreated] = await Promise.all([
    waitForEvent(firstRecipientEvents, 'notification.created'),
    waitForEvent(secondRecipientEvents, 'notification.created')
  ]);
  assert.equal(firstCreated.type, 'notification.created');
  assert.equal(secondCreated.type, 'notification.created');
  assert.equal(firstCreated.payload.notification.id, createdNotificationId);
  assert.deepEqual(secondCreated, firstCreated);
  assert.equal(firstUnrelatedEvents.length, 0);
  assert.equal(secondUnrelatedEvents.length, 0);

  const read = await app.inject({
    method: 'POST',
    url: `/notifications/${createdNotificationId}/read`,
    headers: bearer(recipient.accessToken)
  });
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json<{ unreadCount: number }>().unreadCount, 0);
  const [firstRead, secondRead] = await Promise.all([
    waitForEvent(firstRecipientEvents, 'notification.read'),
    waitForEvent(secondRecipientEvents, 'notification.read')
  ]);
  const readResult = read.json<{ notificationId: string; readAt: string; unreadCount: number }>();
  const readEvent = {
    version: 1,
    type: 'notification.read',
    payload: readResult
  };
  assert.deepEqual(firstRead, readEvent);
  assert.deepEqual(secondRead, readEvent);
  assert.equal(countEventType(firstRecipientEvents, 'notification.read'), 1);
  assert.equal(countEventType(secondRecipientEvents, 'notification.read'), 1);
  const readState = await db.query<{ read_at: Date | null }>(
    'SELECT read_at FROM notifications WHERE id = $1',
    [createdNotificationId]
  );
  assert.ok(readState.rows[0]?.read_at);
  assert.equal(readState.rows[0]?.read_at?.toISOString(), readResult.readAt);

  const nextNotification = await createNotification({
    recipientUserId: recipient.user.id,
    type: 'follow',
    deduplicationKey: `multinode-read-all:${suffix}`
  });
  assert.equal(nextNotification.created, true);
  assert.ok(nextNotification.id);
  await publishNotificationAfterCommit(recipient.user.id, nextNotification.id);
  await Promise.all([
    waitForEvent(firstRecipientEvents, 'notification.created', 2),
    waitForEvent(secondRecipientEvents, 'notification.created', 2)
  ]);

  const readAll = await app.inject({
    method: 'POST',
    url: '/notifications/read-all',
    headers: bearer(recipient.accessToken)
  });
  assert.equal(readAll.statusCode, 200, readAll.body);
  assert.equal(readAll.json<{ unreadCount: number }>().unreadCount, 0);
  assert.equal(readAll.json<{ updatedCount: number }>().updatedCount, 1);
  const [firstReadAll, secondReadAll] = await Promise.all([
    waitForEvent(firstRecipientEvents, 'notifications.read_all'),
    waitForEvent(secondRecipientEvents, 'notifications.read_all')
  ]);
  const readAllResult = readAll.json<{ readAt: string; unreadCount: number }>();
  const readAllEvent = {
    version: 1,
    type: 'notifications.read_all',
    payload: { readAt: readAllResult.readAt, unreadCount: readAllResult.unreadCount }
  };
  assert.deepEqual(firstReadAll, readAllEvent);
  assert.deepEqual(secondReadAll, readAllEvent);
  assert.equal(countEventType(firstRecipientEvents, 'notifications.read_all'), 1);
  assert.equal(countEventType(secondRecipientEvents, 'notifications.read_all'), 1);
  assert.equal(firstUnrelatedEvents.length, 0);
  assert.equal(secondUnrelatedEvents.length, 0);

  const unread = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL',
    [recipient.user.id]
  );
  assert.equal(unread.rows[0]?.count, '0');
});
