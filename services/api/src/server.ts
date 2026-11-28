import { buildApp } from './app.js';
import { closeAccountDeletionJournalDatabase } from './config/account-deletion-journal-database.js';
import { closeDatabaseConnection } from './config/database.js';
import { env } from './config/env.js';
import { closeRedisConnection } from './config/redis.js';
import { closeStorageConnection } from './config/storage.js';

const app = buildApp();
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals | 'uncaughtException' | 'unhandledRejection', exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  const forceExitTimer = setTimeout(() => {
    app.log.error({ signal }, 'Forced shutdown after timeout');
    process.exit(exitCode || 1);
  }, 10_000);
  forceExitTimer.unref?.();

  app.log.info({ signal }, 'Shutting down API service');

  const steps: Array<[string, () => unknown]> = [
    ['fastify', () => app.close()],
    ['database', () => closeDatabaseConnection()],
    ['account-deletion-journal-database', () => closeAccountDeletionJournalDatabase()],
    ['redis', () => closeRedisConnection()],
    ['storage', () => closeStorageConnection()]
  ];

  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      app.log.error({ err: error, step: name }, 'Error during shutdown step');
    }
  }

  clearTimeout(forceExitTimer);
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT', 0);
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM', 0);
});

process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  app.log.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
