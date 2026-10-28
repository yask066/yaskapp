import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Database } from '../../config/database.js';
import { accountDeletionMetricsTestUtils, createAccountDeletionMetricsRepository } from './account-deletion.metrics.js';

test('duration_percentiles_are_bounded_and_empty_is_zero', () => {
  const percentile = accountDeletionMetricsTestUtils.durationPercentile;
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([40, 10, 30, 20], 0.5), 20);
  assert.equal(percentile([40, 10, 30, 20], 0.95), 40);
});

test('media_retry_age_and_errors_are_included_in_worker_metrics', async () => {
  const queries: string[] = [];
  const fakeDatabase = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('GROUP BY status')) return { rows: [{ status: 'pending', count: 1 }] };
      if (sql.includes('duration_ms')) return { rows: [] };
      if (sql.includes('account_deletion_media_manifest') && sql.includes('UNION ALL')) {
        return { rows: [{ step_key: 'media', code: 'storage_delete_failed', count: 2 }] };
      }
      if (sql.includes('counter_discrepancies')) {
        return { rows: [{ media_manifest: 2, live_content_targets: 0, content_references: 0, counter_discrepancies: 0 }] };
      }
      if (sql.includes('retry_older_than_hour')) return { rows: [{ retry_older_than_hour: 1, deadline_exceeded: 0 }] };
      throw new Error('unexpected_metrics_query');
    }
  } as unknown as Database;
  const repository = createAccountDeletionMetricsRepository(fakeDatabase);

  const metrics = await repository.collect(new Date('2026-10-13T12:00:00Z'));

  assert.deepEqual(metrics.stepErrors, [{ step: 'media', code: 'storage_delete_failed', count: 2 }]);
  assert.equal(metrics.alerts.retryOlderThanHour, 1);
  assert.match(queries.find((sql) => sql.includes('retry_older_than_hour')) ?? '', /manifest\.last_failed_at <= \$1::timestamptz - interval '1 hour'/);
});
