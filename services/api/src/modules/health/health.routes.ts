import type { FastifyInstance } from 'fastify';

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

export function registerHealthRoutes(app: FastifyInstance, checks: Partial<HealthReadinessChecks> = {}) {
  const readiness = {
    checkDatabaseConnection,
    checkRedisConnection,
    checkStorageConnection,
    assertJournalReady: assertAccountDeletionJournalReady,
    ...checks
  };

  app.get('/health', async () => ({
    status: 'ok',
    service: 'api'
  }));

  app.get('/health/db', async () => {
    const database = await checkDatabaseConnection();

    return {
      status: 'ok',
      service: 'api',
      database
    };
  });

  app.get('/health/ready', async (request, reply) => {
    try {
      const [database, redis, storage] = await Promise.all([
        readiness.checkDatabaseConnection(),
        readiness.checkRedisConnection(),
        readiness.checkStorageConnection(),
        env.ACCOUNT_DELETION_ENABLED && env.ACCOUNT_DELETION_JOURNAL_ENABLED
          ? readiness.assertJournalReady() : Promise.resolve()
      ]);

      return {
        status: 'ready',
        service: 'api',
        database,
        redis,
        storage
      };
    } catch (error) {
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

  app.get('/health/metrics', async () => ({
    status: 'ok',
    service: 'api',
    notifications: getNotificationMetrics()
  }));
}
