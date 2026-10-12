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

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true
});
redis.on('error', () => undefined);

export function createRedisClient(): RedisClientLike {
  const client = new Redis(env.REDIS_URL, { lazyConnect: true });
  client.on('error', () => undefined);
  return client as unknown as RedisClientLike;
}

export async function checkRedisConnection() {
  const result = await redis.ping();

  if (result !== 'PONG') {
    throw new Error(`Unexpected Redis health response: ${result}`);
  }

  return {
    connected: true
  };
}

export async function closeRedisConnection() {
  await redis.quit();
}
