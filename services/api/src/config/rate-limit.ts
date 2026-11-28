import { isIP } from 'node:net';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { redis } from './redis.js';

const consumeScript = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 or redis.call('PTTL', KEYS[1]) < 0 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return { current, redis.call('PTTL', KEYS[1]) }
`;

export type RateLimitOptions = {
  keyPrefix: string;
  limit: number;
  windowMs: number;
  errorCode?: string;
  keyBy?: 'ip' | 'user';
  keyValue?: (request: FastifyRequest) => string | undefined;
  fallbackToMemory?: boolean;
  skipInTest?: boolean;
  skip?: (request: FastifyRequest) => boolean;
  onResponse?: (statusCode: number) => void;
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const memoryBuckets = new Map<string, { count: number; expiresAt: number }>();

function consumeMemoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (memoryBuckets.size >= 20_000) {
    for (const [k, entry] of memoryBuckets) {
      if (entry.expiresAt <= now) memoryBuckets.delete(k);
    }
    if (memoryBuckets.size >= 20_000) memoryBuckets.clear();
  }
  const existing = memoryBuckets.get(key);
  if (!existing || existing.expiresAt <= now) {
    memoryBuckets.set(key, { count: 1, expiresAt: now + windowMs });
    return {
      allowed: 1 <= limit,
      limit,
      remaining: Math.max(limit - 1, 0),
      retryAfterSeconds: Math.max(Math.ceil(windowMs / 1000), 1)
    };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    limit,
    remaining: Math.max(limit - existing.count, 0),
    retryAfterSeconds: Math.max(Math.ceil((existing.expiresAt - now) / 1000), 1)
  };
}

function expandIpv6(address: string): string[] | null {
  const zoneIndex = address.indexOf('%');
  const clean = (zoneIndex >= 0 ? address.slice(0, zoneIndex) : address).toLowerCase();
  const halves = clean.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 0) return null;
  const full = [...left, ...Array<string>(Math.max(missing, 0)).fill('0'), ...right];
  if (full.length !== 8) return null;
  return full.map((part) => part.padStart(4, '0'));
}

export function normalizeRateLimitIp(rawIp: string): string {
  const ip = rawIp.trim().toLowerCase();
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return mapped;
  }
  if (isIP(ip) === 6) {
    const groups = expandIpv6(ip);
    if (groups) return `${groups.slice(0, 4).join(':')}::/64`;
  }
  return ip;
}

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

export function rateLimitKey(
  request: FastifyRequest,
  keyPrefix: string,
  keyBy: 'ip' | 'user' = 'ip',
  customValue?: string
) {
  const identity =
    customValue ??
    (keyBy === 'user' ? request.user?.sub ?? normalizeRateLimitIp(request.ip) : normalizeRateLimitIp(request.ip));

  return `ratelimit:${keyPrefix}:${identity}`;
}

export function rateLimit(options: RateLimitOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (options.skip?.(request)) {
      return;
    }

    // Integration tests exercise business routes without throttling the test suite.
    if (process.env.NODE_ENV === 'test' && options.skipInTest !== false) {
      return;
    }

    const customValue = options.keyValue?.(request);
    if (options.keyValue && !customValue) {
      return;
    }
    const key = rateLimitKey(request, options.keyPrefix, options.keyBy, customValue);

    let result: RateLimitResult;
    try {
      result = await consumeRateLimit(key, options.limit, options.windowMs);
    } catch (error) {
      request.log.error({ err: error }, 'Rate limit check failed');
      if (!options.fallbackToMemory) {
        return;
      }
      result = consumeMemoryRateLimit(key, options.limit, options.windowMs);
    }

    reply.header('RateLimit-Limit', result.limit);
    reply.header('RateLimit-Remaining', result.remaining);
    reply.header('RateLimit-Reset', result.retryAfterSeconds);

    if (!result.allowed) {
      options.onResponse?.(429);
      reply.header('Retry-After', result.retryAfterSeconds);

      return reply.status(429).send({
        error: options.errorCode ?? 'rate_limit_exceeded',
        message: 'Too many requests. Try again later.'
      });
    }
    options.onResponse?.(200);
  };
}
