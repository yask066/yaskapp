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

test('comment_reply reaches only the root author on both API nodes', async () => {
  const pollAuthor = await registerUser('reply_poll');
  const rootAuthor = await registerUser('reply_root');
  const replier = await registerUser('reply_actor');
  const unrelated = await registerUser('reply_other');
  const rootAuthorFirstEvents = firstNode.connect(rootAuthor.user.id);
  const rootAuthorSecondEvents = secondNode.connect(rootAuthor.user.id);
  const pollAuthorFirstEvents = firstNode.connect(pollAuthor.user.id);
  const pollAuthorSecondEvents = secondNode.connect(pollAuthor.user.id);
  const unrelatedFirstEvents = firstNode.connect(unrelated.user.id);
  const unrelatedSecondEvents = secondNode.connect(unrelated.user.id);
  await Promise.all([firstNode.start(), secondNode.start()]);

  const pollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(pollAuthor.accessToken),
    payload: { question: 'Multi-node reply notification', options: ['One', 'Two'] }
  });
  assert.equal(pollResponse.statusCode, 201, pollResponse.body);
  const poll = pollResponse.json<{ poll: { id: string } }>().poll;
  const rootResponse = await app.inject({
    method: 'POST',
    url: `/polls/${poll.id}/comments`,
    headers: bearer(rootAuthor.accessToken),
    payload: { body: 'Reply events belong to this author.' }
  });
  assert.equal(rootResponse.statusCode, 201, rootResponse.body);
  const root = rootResponse.json<{ comment: { id: string } }>().comment;
  await Promise.all([
    waitForEvent(pollAuthorFirstEvents, 'notification.created'),
    waitForEvent(pollAuthorSecondEvents, 'notification.created')
  ]);
  for (const events of [
    rootAuthorFirstEvents,
    rootAuthorSecondEvents,
    pollAuthorFirstEvents,
    pollAuthorSecondEvents,
    unrelatedFirstEvents,
    unrelatedSecondEvents
  ]) events.splice(0);

  const replyBody = 'Do not copy this private reply into an event.';
  const replyResponse = await app.inject({
    method: 'POST',
    url: `/polls/${poll.id}/comments`,
    headers: bearer(replier.accessToken),
    payload: { body: replyBody, parentCommentId: root.id }
  });
  assert.equal(replyResponse.statusCode, 201, replyResponse.body);
  const reply = replyResponse.json<{ comment: { id: string } }>().comment;
  const storedRows = await db.query<{
    id: string;
    recipient_user_id: string;
    type: string;
    poll_id: string | null;
    comment_id: string | null;
    payload: Record<string, unknown>;
  }>(
    `SELECT id, recipient_user_id, type, poll_id, comment_id, payload
     FROM notifications WHERE type = 'comment_reply' AND comment_id = $1`,
    [reply.id]
  );
  assert.equal(storedRows.rows.length, 1);
  const notification = storedRows.rows[0];
  assert.equal(notification?.recipient_user_id, rootAuthor.user.id);
  assert.equal(notification?.type, 'comment_reply');
  assert.equal(notification?.poll_id, poll.id);
  assert.equal(notification?.comment_id, reply.id);
  assert.deepEqual(notification?.payload, {});

  const [rootAuthorFirst, rootAuthorSecond] = await Promise.all([
    waitForEvent(rootAuthorFirstEvents, 'notification.created'),
    waitForEvent(rootAuthorSecondEvents, 'notification.created')
  ]);
  const firstCreated = rootAuthorFirst as Extract<RealtimeEvent, { type: 'notification.created' }>;
  const secondCreated = rootAuthorSecond as Extract<RealtimeEvent, { type: 'notification.created' }>;
  assert.equal(firstCreated.payload.notification.id, notification?.id);
  assert.equal(firstCreated.payload.notification.type, 'comment_reply');
  assert.equal(firstCreated.payload.notification.pollId, poll.id);
  assert.equal(firstCreated.payload.notification.commentId, reply.id);
  assert.deepEqual(firstCreated.payload.notification.payload, {});
  assert.deepEqual(secondCreated, firstCreated);
  assert.equal(JSON.stringify(firstCreated).includes(replyBody), false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(countEventType(rootAuthorFirstEvents, 'notification.created'), 1);
  assert.equal(countEventType(rootAuthorSecondEvents, 'notification.created'), 1);
  assert.equal(countEventType(pollAuthorFirstEvents, 'notification.created'), 0);
  assert.equal(countEventType(pollAuthorSecondEvents, 'notification.created'), 0);
  assert.equal(countEventType(unrelatedFirstEvents, 'notification.created'), 0);
  assert.equal(countEventType(unrelatedSecondEvents, 'notification.created'), 0);
});
