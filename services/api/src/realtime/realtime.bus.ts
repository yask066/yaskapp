import type { RealtimeEvent } from '@yaskapp/shared';

import { createRedisClient, realtimeChannel, type RedisClientLike } from '../config/redis.js';

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

  constructor(options: RealtimeBusOptions = {}) {
    this.publisher = options.createPublisher?.() ?? createRedisClient();
    this.subscriber = options.createSubscriber?.() ?? createRedisClient();
  }

  async start(onMessage: (message: RealtimeBusMessage) => void) {
    if (this.started) return;

    this.subscriber.on('message', (channel, message) => {
      if (channel !== realtimeChannel) return;
      const decoded = decodeMessage(message);
      if (decoded) onMessage(decoded);
    });
    await this.subscriber.subscribe(realtimeChannel);
    this.started = true;
  }

  async publish(recipientUserId: string, event: RealtimeEvent) {
    if (!recipientUserId) throw new Error('Realtime recipient is required.');

    const envelope: RealtimeBusMessage = { recipientUserId, event };
    await this.publisher.publish(realtimeChannel, JSON.stringify(envelope));
  }

  async close() {
    this.started = false;
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}

export const realtimeBus = new RealtimeBus();
