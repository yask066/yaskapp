import type { FastifyInstance } from 'fastify';

import { checkDatabaseConnection } from '../../config/database.js';
import { checkRedisConnection } from '../../config/redis.js';

export function registerHealthRoutes(app: FastifyInstance) {
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
      const [database, redis] = await Promise.all([
        checkDatabaseConnection(),
        checkRedisConnection()
      ]);

      return {
        status: 'ready',
        service: 'api',
        database,
        redis
      };
    } catch (error) {
      request.log.error(error, 'API readiness check failed');

      return reply.code(503).send({
        status: 'unavailable',
        service: 'api'
      });
    }
  });
}
