import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RealtimeEvent } from '@yaskapp/shared';
import { RealtimeBus, realtimeChannel, type RedisClientLike } from '../../realtime/realtime.bus.js';
import { RealtimeHub } from '../../realtime/realtime.hub.js';

class FakeRedis implements RedisClientLike {
  static subscribers: FakeRedis[] = [];
  static available = true;
  private readonly listeners: Array<(channel: string, message: string) => void> = [];

  async subscribe() {
    FakeRedis.subscribers.push(this);
  }

  on(_event: 'message', listener: (channel: string, message: string) => void) {
    this.listeners.push(listener);
    return this;
  }

  async publish(channel: string, message: string) {
    if (!FakeRedis.available) throw new Error('Redis unavailable');
    for (const subscriber of FakeRedis.subscribers) {
      for (const listener of subscriber.listeners) listener(channel, message);
    }
    return FakeRedis.subscribers.length;
  }

  async quit() {
    FakeRedis.subscribers = FakeRedis.subscribers.filter((subscriber) => subscriber !== this);
    return 'OK';
  }
}

function createNode(active: () => boolean) {
  const hub = new RealtimeHub({ canDeliverToUser: async () => active() });
  const bus = new RealtimeBus({ createPublisher: () => new FakeRedis(), createSubscriber: () => new FakeRedis() });
  const messages: string[] = [];
  const closeReasons: string[] = [];
  hub.addRealtimeClient({
    readyState: 1,
    send: (message) => messages.push(message),
    close: (_code, reason) => closeReasons.push(reason ?? '')
  }, 'deleted-user');
  messages.length = 0;

  return {
    hub,
    bus,
    messages,
    closeReasons,
    async start() {
      await bus.start(({ event }) => {
        if (event.type === 'account.deleted') {
          hub.disconnectUser(event.payload.userId, 'account_deleted', event);
        }
      });
    }
  };
}

test('redis_outage_does_not_leak_socket_delivery', async (context) => {
  FakeRedis.subscribers = [];
  FakeRedis.available = true;
  context.after(() => { FakeRedis.subscribers = []; FakeRedis.available = true; });
  let accountActive = true;
  const node = createNode(() => accountActive);
  await node.start();
  FakeRedis.available = false;
  accountActive = false;

  await node.hub.sendToUser('deleted-user', {
    type: 'notification.read',
    payload: { notificationId: 'private-notification', unreadCount: 0 }
  });

  assert.deepEqual(node.messages, []);
  assert.deepEqual(node.closeReasons, ['account_deleted']);
  assert.equal(node.hub.getConnectionMetrics().activeSockets, 0);
  await node.bus.close();
});

test('two_nodes_disconnect_same_account after durable event reaches Redis', async (context) => {
  FakeRedis.subscribers = [];
  FakeRedis.available = true;
  context.after(() => { FakeRedis.subscribers = []; FakeRedis.available = true; });
  const first = createNode(() => false);
  const second = createNode(() => false);
  await Promise.all([first.start(), second.start()]);

  const event: Extract<RealtimeEvent, { type: 'account.deleted' }> = {
    type: 'account.deleted',
    payload: { userId: 'deleted-user', operationId: 'operation-1' }
  };
  await first.bus.publish('deleted-user', event);

  assert.deepEqual(first.messages, [JSON.stringify(event)]);
  assert.deepEqual(second.messages, [JSON.stringify(event)]);
  assert.deepEqual(first.closeReasons, ['account_deleted']);
  assert.deepEqual(second.closeReasons, ['account_deleted']);
  assert.equal(first.hub.getConnectionMetrics().activeSockets, 0);
  assert.equal(second.hub.getConnectionMetrics().activeSockets, 0);
  await Promise.all([first.bus.close(), second.bus.close()]);
});
