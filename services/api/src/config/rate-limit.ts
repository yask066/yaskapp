import type { FastifyReply, FastifyRequest } from 'fastify';

import { redis } from './redis.js';

const consumeScript = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return { current, redis.call('PTTL', KEYS[1]) }
`;

export type RateLimitOptions = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
  errorCode?: string;
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const result = (await redis.eval(consumeScript, 1, key, windowMs)) as [number, number];
  const current = Number(result[0]);
  const ttlMs = Math.max(Number(result[1]), 0);

  return {
    allowed: current <= limit,
    limit,
    remaining: Math.max(limit - current, 0),
    retryAfterSeconds: Math.max(Math.ceil(ttlMs / 1000), 1)
  };
}

function clientKey(request: FastifyRequest, keyPrefix: string) {
  return `ratelimit:${keyPrefix}:${request.ip}`;
}

export function rateLimit(options: RateLimitOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Integration tests exercise business routes without throttling the test suite.
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    try {
      const result = await consumeRateLimit(
        clientKey(request, options.keyPrefix),
        options.limit,
        options.windowMs
      );

      reply.header('RateLimit-Limit', result.limit);
      reply.header('RateLimit-Remaining', result.remaining);
      reply.header('RateLimit-Reset', result.retryAfterSeconds);

      if (!result.allowed) {
        reply.header('Retry-After', result.retryAfterSeconds);

        return reply.status(429).send({
          error: options.errorCode ?? 'rate_limit_exceeded',
          message: 'Too many requests. Try again later.'
        });
      }
    } catch (error) {
      // Rate limiting must not make the API unavailable when Redis is restarting.
      request.log.error({ err: error }, 'Rate limit check failed');
    }
  };
}
