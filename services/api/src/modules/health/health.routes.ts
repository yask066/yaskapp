import type { FastifyInstance } from 'fastify';

import { checkDatabaseConnection } from '../../config/database.js';

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
}
