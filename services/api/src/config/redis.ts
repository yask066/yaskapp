import { Redis } from 'ioredis';

import { env } from './env.js';

export type RedisClientLike = {
  subscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): RedisClientLike;
  publish(channel: string, message: string): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect?(): void;
};

export const realtimeChannel = 'yaskapp:realtime:v1';

let lastRedisErrorLogAt = 0;

function logRedisError(label: string, error: unknown) {
  if (env.NODE_ENV === 'test') return;
  const now = Date.now();
  if (now - lastRedisErrorLogAt < 10_000) return;
  lastRedisErrorLogAt = now;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[redis:${label}] ${message}`);
}

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 2_000,
  commandTimeout: 500
});
redis.on('error', (error) => logRedisError('main', error));

export function createRedisClient(): RedisClientLike {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 2_000
  });
  client.on('error', (error) => logRedisError('realtime', error));
  return client as unknown as RedisClientLike;
}

export function createRedisPublisherClient(): RedisClientLike {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 1_000
  });
  client.on('error', (error) => logRedisError('realtime-pub', error));
  return client as unknown as RedisClientLike;
}

export async function checkRedisConnection() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis health check timed out.')), 2_000);
        timeout.unref?.();
      })
    ]);

    if (result !== 'PONG') {
      throw new Error(`Unexpected Redis health response: ${result}`);
    }

    return {
      connected: true
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function closeRedisConnection() {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const closed = await Promise.race([
    Promise.resolve()
      .then(() => redis.quit())
      .then(() => true, () => false),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), 500);
      timeout.unref?.();
    })
  ]);
  if (timeout) clearTimeout(timeout);
  if (!closed) {
    redis.disconnect();
  }
}
