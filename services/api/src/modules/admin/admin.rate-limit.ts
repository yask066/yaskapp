import { rateLimit, type RateLimitOptions } from '../../config/rate-limit.js';

export const ADMIN_MUTATION_RATE_LIMIT_OPTIONS: RateLimitOptions = {
  keyPrefix: 'admin-mutation',
  keyBy: 'user',
  limit: 30,
  windowMs: 60_000,
  errorCode: 'rate_limit_exceeded'
};

export const adminMutationRateLimit = rateLimit(ADMIN_MUTATION_RATE_LIMIT_OPTIONS);
