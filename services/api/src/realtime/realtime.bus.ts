import { randomUUID } from 'node:crypto';
import type { RealtimeEvent } from '@yaskapp/shared';

import { createRedisClient, createRedisPublisherClient, realtimeChannel, type RedisClientLike } from '../config/redis.js';
import { recordRealtimeSubscribeError } from '../modules/notifications/notifications.metrics.js';

export { realtimeChannel };
export type { RedisClientLike } from '../config/redis.js';

export type RealtimeBusControlEvent =
  | {
      type: 'session.revoked';
      payload: { userId: string; reason: 'logout' | 'sanctioned' | 'blocked' };
    }
  | {
      type: 'ip_ban.changed';
      payload: { ip?: string };
    };

export type RealtimeBusEvent = RealtimeEvent | RealtimeBusControlEvent;

export type RealtimeBusMessage = {
  recipientUserId: string;
  event: RealtimeBusEvent;
  originId?: string;
};

type RealtimeBusOptions = {
  createPublisher?: () => RedisClientLike;
  createSubscriber?: () => RedisClientLike;
  instanceId?: string;
};

function decodeMessage(message: string): RealtimeBusMessage | null {
  try {
    const parsed: unknown = JSON.parse(message);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as { recipientUserId?: unknown; event?: unknown; originId?: unknown };
    if (
      typeof candidate.recipientUserId !== 'string' ||
      candidate.recipientUserId.length === 0 ||
      typeof candidate.event !== 'object' ||
      candidate.event === null ||
      typeof (candidate.event as { type?: unknown }).type !== 'string'
    ) {
      return null;
    }

    const decoded: RealtimeBusMessage = {
      recipientUserId: candidate.recipientUserId,
      event: candidate.event as RealtimeEvent
    };
    if (typeof candidate.originId === 'string' && candidate.originId.length > 0) {
      decoded.originId = candidate.originId;
    }
    return decoded;
  } catch {
    return null;
  }
}

export class RealtimeBus {
  private readonly createPublisherFn: () => RedisClientLike;
  private readonly createSubscriberFn: () => RedisClientLike;
  private readonly instanceId: string;
  private publisher: RedisClientLike;
  private subscriber: RedisClientLike;
  private closed = false;
  private started = false;
  private starting: Promise<void> | undefined;
  private messageHandlerAttached = false;
  private onMessage: ((message: RealtimeBusMessage) => void) | undefined;

  constructor(options: RealtimeBusOptions = {}) {
    this.createPublisherFn = options.createPublisher ?? createRedisPublisherClient;
    this.createSubscriberFn = options.createSubscriber ?? createRedisClient;
    this.instanceId = options.instanceId ?? randomUUID();
    this.publisher = this.createPublisherFn();
    this.subscriber = this.createSubscriberFn();
  }

  private ensureClientsOpen() {
    if (!this.closed) return;
    this.publisher = this.createPublisherFn();
    this.subscriber = this.createSubscriberFn();
    this.messageHandlerAttached = false;
    this.closed = false;
  }

  async start(onMessage: (message: RealtimeBusMessage) => void) {
    if (this.started) return;
    this.ensureClientsOpen();
    this.onMessage = onMessage;
    if (this.starting) return this.starting;
    if (!this.messageHandlerAttached) {
      this.subscriber.on('message', (channel, message) => {
        if (channel !== realtimeChannel) return;
        const decoded = decodeMessage(message);
        if (!decoded) return;
        if (
          decoded.originId &&
          decoded.originId === this.instanceId &&
          decoded.event.type !== 'account.deleted'
        ) {
          return;
        }
        this.onMessage?.(decoded);
      });
      this.messageHandlerAttached = true;
    }
    this.starting = (async () => {
      try {
        await this.subscriber.subscribe(realtimeChannel);
        this.started = true;
      } catch (error) {
        recordRealtimeSubscribeError();
        throw error;
      } finally {
        this.starting = undefined;
      }
    })();
    return this.starting;
  }

  async publish(recipientUserId: string, event: RealtimeBusEvent) {
    if (!recipientUserId) throw new Error('Realtime recipient is required.');
    this.ensureClientsOpen();

    const envelope: RealtimeBusMessage = {
      recipientUserId,
      event,
      originId: this.instanceId
    };
    await this.publisher.publish(realtimeChannel, JSON.stringify(envelope));
  }

  async publishBroadcast(event: RealtimeBusEvent) {
    await this.publish('*', event);
  }

  async close() {
    this.started = false;
    this.closed = true;
    await Promise.all([this.publisher, this.subscriber].map(async (client) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const closed = await Promise.race([
        Promise.resolve().then(() => client.quit()).then(() => true, () => false),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 500);
          timeout.unref?.();
        })
      ]);
      if (timeout) clearTimeout(timeout);
      if (!closed) client.disconnect?.();
    }));
  }
}

export const realtimeBus = new RealtimeBus();
