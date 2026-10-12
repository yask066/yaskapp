import type { RealtimeEvent } from '@yaskapp/shared';

import { createRedisClient, realtimeChannel, type RedisClientLike } from '../config/redis.js';
import { recordRealtimeSubscribeError } from '../modules/notifications/notifications.metrics.js';

export { realtimeChannel };
export type { RedisClientLike } from '../config/redis.js';

export type RealtimeBusMessage = {
  recipientUserId: string;
  event: RealtimeEvent;
};

type RealtimeBusOptions = {
  createPublisher?: () => RedisClientLike;
  createSubscriber?: () => RedisClientLike;
};

function decodeMessage(message: string): RealtimeBusMessage | null {
  try {
    const parsed: unknown = JSON.parse(message);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as { recipientUserId?: unknown; event?: unknown };
    if (
      typeof candidate.recipientUserId !== 'string' ||
      candidate.recipientUserId.length === 0 ||
      typeof candidate.event !== 'object' ||
      candidate.event === null ||
      typeof (candidate.event as { type?: unknown }).type !== 'string'
    ) {
      return null;
    }

    return candidate as RealtimeBusMessage;
  } catch {
    return null;
  }
}

export class RealtimeBus {
  private readonly publisher: RedisClientLike;
  private readonly subscriber: RedisClientLike;
  private started = false;
  private starting: Promise<void> | undefined;
  private messageHandlerAttached = false;
  private onMessage: ((message: RealtimeBusMessage) => void) | undefined;

  constructor(options: RealtimeBusOptions = {}) {
    this.publisher = options.createPublisher?.() ?? createRedisClient();
    this.subscriber = options.createSubscriber?.() ?? createRedisClient();
  }

  async start(onMessage: (message: RealtimeBusMessage) => void) {
    if (this.started) return;
    this.onMessage = onMessage;
    if (this.starting) return this.starting;
    if (!this.messageHandlerAttached) {
      this.subscriber.on('message', (channel, message) => {
        if (channel !== realtimeChannel) return;
        const decoded = decodeMessage(message);
        if (decoded) this.onMessage?.(decoded);
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

  async publish(recipientUserId: string, event: RealtimeEvent) {
    if (!recipientUserId) throw new Error('Realtime recipient is required.');

    const envelope: RealtimeBusMessage = { recipientUserId, event };
    await this.publisher.publish(realtimeChannel, JSON.stringify(envelope));
  }

  async close() {
    this.started = false;
    await Promise.all([this.publisher, this.subscriber].map(async (client) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const closed = await Promise.race([
        Promise.resolve().then(() => client.quit()).then(() => true, () => false),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 500);
        })
      ]);
      if (timeout) clearTimeout(timeout);
      if (!closed) client.disconnect?.();
    }));
  }
}

export const realtimeBus = new RealtimeBus();
