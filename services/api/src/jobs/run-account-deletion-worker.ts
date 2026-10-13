import { closeDatabaseConnection } from '../config/database.js';
import {
  accountDeletionStepHandlers,
  assertDeletionStepHandlersReady,
  processDeletionBatch
} from '../modules/account-deletion/account-deletion.worker.js';

const POLL_INTERVAL_MS = 1_000;
let stopping = false;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

async function run() {
  assertDeletionStepHandlersReady(accountDeletionStepHandlers);
  while (!stopping) {
    try {
      const result = await processDeletionBatch({ limit: 100, now: new Date() });
      if (result.processed === 0) await wait(POLL_INTERVAL_MS);
    } catch {
      console.error('Account deletion worker batch failed; it will retry.');
      await wait(POLL_INTERVAL_MS);
    }
  }
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Account deletion worker could not start.');
    process.exitCode = 1;
  })
  .finally(closeDatabaseConnection);
