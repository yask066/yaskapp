import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { checkDatabaseConnection } from '../../config/database.js';
import { checkRedisConnection } from '../../config/redis.js';
import { checkStorageConnection } from '../../config/storage.js';
import { getNotificationMetrics } from '../notifications/notifications.metrics.js';
import { env } from '../../config/env.js';
import { assertAccountDeletionJournalReady } from '../account-deletion/account-deletion.journal.js';

type HealthReadinessChecks = {
  checkDatabaseConnection: typeof checkDatabaseConnection;
  checkRedisConnection: typeof checkRedisConnection;
  checkStorageConnection: typeof checkStorageConnection;
  assertJournalReady: typeof assertAccountDeletionJournalReady;
};

function isInternalIp(rawIp: string | undefined): boolean {
  if (!rawIp) return false;
  const ip = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith('fc') ||
    ip.startsWith('fd')
  );
}

async function requireInternalHealthAccess(request: FastifyRequest, reply: FastifyReply) {
  if (env.NODE_ENV === 'test' || isInternalIp(request.ip)) return;
  return reply.status(403).send({
    error: 'forbidden',
    message: 'Internal health endpoint is restricted.'
  });
}

export function registerHealthRoutes(app: FastifyInstance, checks: Partial<HealthReadinessChecks> = {}) {
  const readiness = {
    checkDatabaseConnection,
    checkRedisConnection,
    checkStorageConnection,
    assertJournalReady: assertAccountDeletionJournalReady,
    ...checks
  };
  let cachedReady: { expiresAt: number; payload: Record<string, unknown> } | null = null;

  app.get('/health', async () => ({
    status: 'ok',
    service: 'api'
  }));

  app.get('/health/db', { preHandler: requireInternalHealthAccess }, async (request, reply) => {
    try {
      const database = await readiness.checkDatabaseConnection();
      return {
        status: 'ok',
        service: 'api',
        database: { connected: database.connected }
      };
    } catch (error) {
      request.log.error({ err: error }, 'Database health check failed');
      return reply.code(503).send({
        status: 'unavailable',
        service: 'api'
      });
    }
  });

  app.get('/health/ready', async (request, reply) => {
    if (env.NODE_ENV !== 'test' && cachedReady && cachedReady.expiresAt > Date.now()) {
      return cachedReady.payload;
    }

    try {
      const [database, redis, storage] = await Promise.all([
        readiness.checkDatabaseConnection(),
        readiness.checkRedisConnection(),
        readiness.checkStorageConnection(),
        env.ACCOUNT_DELETION_ENABLED && env.ACCOUNT_DELETION_JOURNAL_ENABLED
          ? readiness.assertJournalReady() : Promise.resolve()
      ]);

      const payload = {
        status: 'ready',
        service: 'api',
        database: { connected: database.connected },
        redis: { connected: redis.connected },
        storage: { connected: storage.connected }
      };
      if (env.NODE_ENV !== 'test') {
        cachedReady = { expiresAt: Date.now() + 1_000, payload };
      }
      return payload;
    } catch (error) {
      cachedReady = null;
      const errorCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined;
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      request.log.error({ errorName, errorCode }, 'API readiness check failed');

      return reply.code(503).send({
        status: 'unavailable',
        service: 'api'
      });
    }
  });

  app.get('/health/metrics', { preHandler: requireInternalHealthAccess }, async () => ({
    status: 'ok',
    service: 'api',
    notifications: getNotificationMetrics()
  }));
}
