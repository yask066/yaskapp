import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { closeDatabaseConnection } from '../config/database.js';
import { deleteExpiredFeedSnapshots } from '../modules/polls/poll-feed-snapshots.repository.js';
import { recordPaginationMetric } from '../observability/pagination-logging.js';

const loopMode = process.argv.includes('--loop') || process.env.WORKER_LOOP === 'true';
const intervalMs = Math.max(Number(process.env.WORKER_INTERVAL_MS ?? '300000') || 300_000, 5_000);

let stopping = false;
let sleepTimer: ReturnType<typeof setTimeout> | undefined;
let wakeSleep: (() => void) | undefined;

function requestStop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Poll feed snapshot cleanup received ${signal}; stopping gracefully.`);
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = undefined;
  }
  wakeSleep?.();
}

function sleepInterruptible(ms: number) {
  return new Promise<void>((resolve) => {
    if (stopping) {
      resolve();
      return;
    }
    wakeSleep = () => {
      wakeSleep = undefined;
      resolve();
    };
    sleepTimer = setTimeout(() => {
      sleepTimer = undefined;
      wakeSleep = undefined;
      resolve();
    }, ms);
  });
}

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

async function runOnce() {
  const startedAt = performance.now();
  const deleted = await deleteExpiredFeedSnapshots();
  recordPaginationMetric({
    event: 'pagination.snapshot_expiry',
    surface: 'feed',
    sort: 'popular',
    pageNumber: null,
    durationMs: performance.now() - startedAt,
    itemCount: 0,
    errorCode: null,
    requestId: randomUUID(),
    deletedSnapshotCount: deleted
  });
}

try {
  do {
    try {
      await runOnce();
    } catch (error) {
      console.error('Poll feed snapshot cleanup failed.');
      console.error(error);
      if (!loopMode) {
        process.exitCode = 1;
        break;
      }
    }

    if (loopMode && !stopping) {
      await sleepInterruptible(intervalMs);
    }
  } while (loopMode && !stopping);
} finally {
  await closeDatabaseConnection();
}
