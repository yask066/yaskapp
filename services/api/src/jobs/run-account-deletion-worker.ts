import { closeAccountDeletionJournalDatabase } from '../config/account-deletion-journal-database.js';
import { closeDatabaseConnection } from '../config/database.js';
import { closeRedisConnection } from '../config/redis.js';
import { closeStorageConnection } from '../config/storage.js';
import {
  accountDeletionStepHandlers,
  assertDeletionStepHandlersReady,
  processDeletionBatch
} from '../modules/account-deletion/account-deletion.worker.js';
import { dispatchPendingRelationshipEvents } from '../modules/account-deletion/account-deletion.relationships.js';
import { collectAccountDeletionMetrics } from '../modules/account-deletion/account-deletion.metrics.js';
import { cleanupDeletionRetention } from '../modules/account-deletion/account-deletion.retention.js';

const POLL_INTERVAL_MS = 1_000;
let stopping = false;
let lastMetricsAt = 0;
const METRICS_INTERVAL_MS = 60_000;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

async function run() {
  assertDeletionStepHandlersReady(accountDeletionStepHandlers);
  while (!stopping) {
    try {
      const result = await processDeletionBatch({
        limit: 10,
        now: new Date(),
        nowProvider: () => new Date()
      });
      await dispatchPendingRelationshipEvents();
      const now = Date.now();
      if (now - lastMetricsAt >= METRICS_INTERVAL_MS) {
        lastMetricsAt = now;
        const retention = await cleanupDeletionRetention(new Date(now));
        if (retention.deleted > 0) {
          console.info(JSON.stringify({ event: 'account_deletion.retention', deleted: retention.deleted }));
        }
        const metrics = await collectAccountDeletionMetrics(new Date(now));
        console.info(JSON.stringify({ event: 'account_deletion.metrics', ...metrics }));
        if (metrics.alerts.retryOlderThanHour > 0 || metrics.alerts.deadlineExceeded > 0) {
          console.error(JSON.stringify({
            event: 'account_deletion.alert',
            retryOlderThanHour: metrics.alerts.retryOlderThanHour,
            deadlineExceeded: metrics.alerts.deadlineExceeded
          }));
        }
      }
      if (result.processed === 0 || (result.completed === 0 && result.retrying > 0)) {
        await wait(POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: 'account_deletion.worker_batch_failed',
        message: error instanceof Error ? error.message : String(error),
        code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
      }));
      await wait(POLL_INTERVAL_MS);
    }
  }
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Account deletion worker could not start.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([
      closeDatabaseConnection(),
      closeAccountDeletionJournalDatabase(),
      closeRedisConnection()
    ]);
    closeStorageConnection();
  });
