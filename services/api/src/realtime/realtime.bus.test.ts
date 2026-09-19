import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RealtimeEvent } from '@yaskapp/shared';

import { RealtimeBus, realtimeChannel, type RedisClientLike } from './realtime.bus.js';
import { addRealtimeClient, sendToUser } from './realtime.hub.js';

class FakeRedis implements RedisClientLike {
  readonly published: Array<{ channel: string; message: string }> = [];
  private listeners: Array<(channel: string, message: string) => void> = [];
  subscribeCalls = 0;
  quitCalls = 0;
  peer?: FakeRedis;

  async subscribe(channel: string) {
    this.subscribeCalls += 1;
    assert.equal(channel, realtimeChannel);
  }

  on(event: 'message', listener: (channel: string, message: string) => void) {
    assert.equal(event, 'message');
    this.listeners.push(listener);
    return this;
  }

  async publish(channel: string, message: string) {
    this.published.push({ channel, message });
    this.peer?.emit(channel, message);
    return 1;
  }

  async quit() {
    this.quitCalls += 1;
    return 'OK';
  }

  emit(channel: string, message: string) {
    for (const listener of this.listeners) listener(channel, message);
  }
}

function event(): RealtimeEvent {
  return {
    version: 1,
    type: 'notification.created',
    payload: {
      notification: {
        id: 'notification-1',
        type: 'follow',
        actor: null,
        targetType: 'profile',
        pollId: null,
        commentId: null,
        payload: {},
        readAt: null,
        createdAt: '2026-09-19T10:00:00.000Z',
        isTargetAvailable: true
      },
      unreadCount: 1
    }
  };
}

test('publishes a recipient envelope and delivers it to the subscriber', async () => {
  const publisher = new FakeRedis();
  const subscriber = new FakeRedis();
  const received: Array<{ recipientUserId: string; event: RealtimeEvent }> = [];
  const bus = new RealtimeBus({ createPublisher: () => publisher, createSubscriber: () => subscriber });

  await bus.start((message) => received.push(message));
  await bus.publish('user-1', event());

  assert.deepEqual(JSON.parse(publisher.published[0]?.message ?? ''), {
    recipientUserId: 'user-1',
    event: event()
  });
  assert.deepEqual(received, []);
  subscriber.emit(realtimeChannel, publisher.published[0]?.message ?? '');
  assert.deepEqual(received, [{ recipientUserId: 'user-1', event: event() }]);
  await bus.close();
});

test('ignores malformed messages and does not subscribe twice', async () => {
  const subscriber = new FakeRedis();
  const bus = new RealtimeBus({ createPublisher: () => new FakeRedis(), createSubscriber: () => subscriber });
  const received: unknown[] = [];

  await bus.start((message) => received.push(message));
  await bus.start((message) => received.push(message));
  subscriber.emit(realtimeChannel, '{not-json');
  subscriber.emit(realtimeChannel, JSON.stringify({ recipientUserId: '', event: event() }));

  assert.equal(subscriber.subscribeCalls, 1);
  assert.deepEqual(received, []);
  await bus.close();
});

test('two bus instances deliver only to the recipient-specific local hub', async () => {
  const firstPublisher = new FakeRedis();
  const firstSubscriber = new FakeRedis();
  const secondPublisher = new FakeRedis();
  const secondSubscriber = new FakeRedis();
  firstPublisher.peer = secondSubscriber;
  secondPublisher.peer = firstSubscriber;
  const firstMessages: string[] = [];
  const secondMessages: string[] = [];
  const first = new RealtimeBus({ createPublisher: () => firstPublisher, createSubscriber: () => firstSubscriber });
  const second = new RealtimeBus({ createPublisher: () => secondPublisher, createSubscriber: () => secondSubscriber });

  const removeFirstSocket = addRealtimeClient({ readyState: 1, send: (message) => firstMessages.push(message) }, 'user-1');
  const removeSecondSocket = addRealtimeClient({ readyState: 1, send: (message) => secondMessages.push(message) }, 'user-2');
  firstMessages.length = 0;
  secondMessages.length = 0;
  await first.start(({ recipientUserId, event }) => sendToUser(recipientUserId, event));
  await second.start(({ recipientUserId, event }) => sendToUser(recipientUserId, event));
  await first.publish('user-2', event());

  assert.deepEqual(firstMessages, []);
  assert.deepEqual(JSON.parse(secondMessages[0] ?? ''), event());
  removeFirstSocket();
  removeSecondSocket();
  await first.close();
  await second.close();
});
