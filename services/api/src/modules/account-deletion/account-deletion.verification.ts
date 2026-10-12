import { createHash, randomBytes } from 'node:crypto';
import { redis } from '../../config/redis.js';

export const deletionTokenLifetimeMs = 10 * 60_000;
export const statusTokenLifetimeMs = 48 * 60 * 60_000;
export const failedVerificationWindowMs = 15 * 60_000;
export const failedVerificationLimit = 5;

const reserveVerificationAttemptScript = `
  local accountCount = tonumber(redis.call('GET', KEYS[1]) or '0')
  local ipCount = tonumber(redis.call('GET', KEYS[2]) or '0')
  local limit = tonumber(ARGV[1])
  if accountCount >= limit or ipCount >= limit then
    return { 0, math.max(redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2]), 1) }
  end
  for i = 1, 2 do
    local current = redis.call('INCR', KEYS[i])
    if current == 1 then redis.call('PEXPIRE', KEYS[i], ARGV[2]) end
  end
  return { 1, tonumber(ARGV[2]) }
`;

const releaseVerificationAttemptScript = `
  for i = 1, 2 do
    if redis.call('EXISTS', KEYS[i]) == 1 then
      local current = redis.call('DECR', KEYS[i])
      if current <= 0 then redis.call('DEL', KEYS[i]) end
    end
  end
  return 1
`;

export function hashDeletionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function buildDeletionTokenPair(now = new Date()) {
  const deletionToken = randomBytes(32).toString('base64url');
  const statusToken = randomBytes(32).toString('base64url');

  return {
    deletionToken,
    statusToken,
    deletionTokenHash: hashDeletionToken(deletionToken),
    statusTokenHash: hashDeletionToken(statusToken),
    deletionTokenExpiresAt: new Date(now.getTime() + deletionTokenLifetimeMs),
    statusTokenExpiresAt: new Date(now.getTime() + statusTokenLifetimeMs)
  };
}

function verificationRateLimitKeys(accountKey: string, ip: string) {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  return [
    `ratelimit:account-deletion-verification:account:${hash(accountKey)}`,
    `ratelimit:account-deletion-verification:ip:${hash(ip)}`
  ] as const;
}

export async function reserveVerificationAttempt(accountKey: string, ip: string) {
  const keys = verificationRateLimitKeys(accountKey, ip);
  const result = await redis.eval(
    reserveVerificationAttemptScript,
    keys.length,
    ...keys,
    failedVerificationLimit,
    failedVerificationWindowMs
  ) as [number, number];
  return { allowed: Number(result[0]) === 1, retryAfterSeconds: Math.max(Math.ceil(Number(result[1]) / 1000), 1), keys };
}

export async function releaseVerificationAttempt(keys: readonly [string, string]) {
  await redis.eval(releaseVerificationAttemptScript, keys.length, ...keys);
}
