import { Redis } from 'ioredis';

import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true
});

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
