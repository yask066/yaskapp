import { buildApp } from './app.js';
import { closeDatabaseConnection } from './config/database.js';
import { env } from './config/env.js';

const app = buildApp();

async function shutdown(signal: NodeJS.Signals) {
  app.log.info({ signal }, 'Shutting down API service');

  await app.close();
  await closeDatabaseConnection();

  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
