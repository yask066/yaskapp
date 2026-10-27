import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { closeDatabaseConnection } from '../config/database.js';
import { deleteExpiredFeedSnapshots } from '../modules/polls/poll-feed-snapshots.repository.js';
import { recordPaginationMetric } from '../observability/pagination-logging.js';

try {
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
    deletedSnapshotCount: deleted,
  });
} catch (error) {
  console.error('Poll feed snapshot cleanup failed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
