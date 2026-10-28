import { db } from '../../config/database.js';

export type AccountDeletionMetrics = {
  counts: Record<'not_started' | 'pending' | 'processing' | 'retrying' | 'completed', number>;
  durationMs: { p50: number; p95: number; max: number };
  stepErrors: Array<{ step: string; code: string; count: number }>;
  remainders: { mediaManifest: number; liveContentTargets: number; contentReferences: number; counterDiscrepancies: number };
  alerts: { retryOlderThanHour: number; deadlineExceeded: number };
};

export type AccountDeletionMetricsRepository = {
  collect(now: Date): Promise<AccountDeletionMetrics>;
};

function durationPercentile(values: number[], percentile: number) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.ceil(percentile * ordered.length) - 1;
  return ordered[Math.max(0, index)] ?? 0;
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function collectDatabaseMetrics(executor: typeof db, now: Date): Promise<AccountDeletionMetrics> {
  const [statuses, durations, errors, remainders, alerts] = await Promise.all([
    executor.query<{ status: string; count: number }>(
      'SELECT status, count(*)::int AS count FROM account_deletion_operations GROUP BY status'
    ),
    executor.query<{ duration_ms: number | string }>(
      `SELECT EXTRACT(EPOCH FROM (completed_at - accepted_at)) * 1000 AS duration_ms
       FROM account_deletion_operations WHERE status = 'completed' AND accepted_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 10000`
    ),
    executor.query<{ step_key: string; code: string; count: number }>(
      `SELECT step_key, code, sum(count)::int AS count FROM (
         SELECT step_key, last_error_code AS code, count(*)::int AS count
         FROM account_deletion_steps WHERE last_error_code IS NOT NULL
         GROUP BY step_key, last_error_code
         UNION ALL
         SELECT 'media' AS step_key, last_error_code AS code, count(*)::int AS count
         FROM account_deletion_media_manifest
         WHERE status = 'retrying' AND last_error_code IS NOT NULL
         GROUP BY last_error_code
       ) errors GROUP BY step_key, code ORDER BY step_key, code`
    ),
    executor.query<{ media_manifest: number; live_content_targets: number; content_references: number; counter_discrepancies: number }>(
      `SELECT
         (SELECT count(*)::int FROM account_deletion_media_manifest WHERE status <> 'completed') AS media_manifest,
         (SELECT count(*)::int FROM account_deletion_deleted_content_targets target
           JOIN account_deletion_operations operation ON operation.id = target.operation_id
           WHERE (target.target_type = 'poll' AND EXISTS (
                    SELECT 1 FROM polls WHERE id = target.target_id AND author_id = operation.user_id))
              OR (target.target_type = 'comment' AND EXISTS (
                    SELECT 1 FROM comments WHERE id = target.target_id AND author_id = operation.user_id))) AS live_content_targets,
         (SELECT count(*)::int FROM notifications notification
           WHERE notification.poll_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'poll')
              OR notification.comment_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'comment'))
           + (SELECT count(*)::int FROM notification_push_jobs job
              WHERE job.poll_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'poll')
                 OR job.comment_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'comment'))
           + (SELECT count(*)::int FROM reports report
              WHERE (report.target_type = 'poll' AND report.target_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'poll'))
                 OR (report.target_type = 'comment' AND report.target_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'comment')))
           + (SELECT count(*)::int FROM moderation_cases case_row
              WHERE (case_row.target_type = 'poll' AND case_row.target_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'poll'))
                 OR (case_row.target_type = 'comment' AND case_row.target_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'comment')))
           + (SELECT count(*)::int FROM admin_audit_log audit
              WHERE (audit.target_type = 'poll' AND audit.target_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'poll'))
                 OR (audit.target_type = 'comment' AND audit.target_id IN (SELECT target_id FROM account_deletion_deleted_content_targets WHERE target_type = 'comment'))) AS content_references,
         (SELECT count(*)::int FROM polls poll
           WHERE poll.votes_count <> (SELECT count(*)::int FROM poll_votes WHERE poll_id = poll.id)
              OR poll.likes_count <> (SELECT count(*)::int FROM likes WHERE poll_id = poll.id)
              OR poll.comments_count <> (
                SELECT count(*)::int FROM comments comment
                JOIN users author ON author.id = comment.author_id
                WHERE comment.poll_id = poll.id AND comment.deleted_at IS NULL
                  AND author.status = 'active' AND author.deleted_at IS NULL
              ))
           + (SELECT count(*)::int FROM poll_options option
              WHERE option.votes_count <> (SELECT count(*)::int FROM poll_votes WHERE option_id = option.id))
           + (SELECT count(*)::int FROM comments comment
              WHERE comment.replies_count <> (
                SELECT count(*)::int FROM comments reply
                JOIN users author ON author.id = reply.author_id
                WHERE reply.parent_comment_id = comment.id AND reply.deleted_at IS NULL
                  AND author.status = 'active' AND author.deleted_at IS NULL
              ) OR comment.likes_count <> (SELECT count(*)::int FROM likes WHERE comment_id = comment.id))
           + (SELECT count(*)::int FROM profiles profile
              WHERE profile.followers_count <> (SELECT count(*)::int FROM follows WHERE followee_id = profile.user_id)
                 OR profile.following_count <> (SELECT count(*)::int FROM follows WHERE follower_id = profile.user_id))
           AS counter_discrepancies`
    ),
    executor.query<{ retry_older_than_hour: number; deadline_exceeded: number }>(
      `SELECT
         (SELECT count(DISTINCT operation.id)::int FROM account_deletion_operations operation
          WHERE (operation.status = 'retrying' AND operation.retry_started_at <= $1::timestamptz - interval '1 hour')
             OR EXISTS (SELECT 1 FROM account_deletion_media_manifest manifest
                        WHERE manifest.operation_id = operation.id AND manifest.status = 'retrying'
                          AND manifest.last_failed_at <= $1::timestamptz - interval '1 hour')) AS retry_older_than_hour,
         count(*) FILTER (WHERE status <> 'completed' AND accepted_at IS NOT NULL AND deadline_at < $1)::int AS deadline_exceeded
       FROM account_deletion_operations`,
      [now]
    )
  ]);

  const counts: AccountDeletionMetrics['counts'] = {
    not_started: 0, pending: 0, processing: 0, retrying: 0, completed: 0
  };
  for (const row of statuses.rows) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = numeric(row.count);
  }
  const samples = durations.rows.map((row) => numeric(row.duration_ms));
  const remainder = remainders.rows[0];
  const alert = alerts.rows[0];
  return {
    counts,
    durationMs: {
      p50: durationPercentile(samples, 0.5),
      p95: durationPercentile(samples, 0.95),
      max: samples.length ? Math.max(...samples) : 0
    },
    stepErrors: errors.rows.map((row) => ({ step: row.step_key, code: row.code, count: numeric(row.count) })),
    remainders: {
      mediaManifest: numeric(remainder?.media_manifest),
      liveContentTargets: numeric(remainder?.live_content_targets),
      contentReferences: numeric(remainder?.content_references),
      counterDiscrepancies: numeric(remainder?.counter_discrepancies)
    },
    alerts: {
      retryOlderThanHour: numeric(alert?.retry_older_than_hour),
      deadlineExceeded: numeric(alert?.deadline_exceeded)
    }
  };
}

export function createAccountDeletionMetricsService(repository: AccountDeletionMetricsRepository) {
  return { collectAccountDeletionMetrics: (now = new Date()) => repository.collect(now) };
}

export function createAccountDeletionMetricsRepository(executor: typeof db = db): AccountDeletionMetricsRepository {
  return { collect: (now) => collectDatabaseMetrics(executor, now) };
}

const metricsService = createAccountDeletionMetricsService(createAccountDeletionMetricsRepository());

export const collectAccountDeletionMetrics = metricsService.collectAccountDeletionMetrics;

export const accountDeletionMetricsTestUtils = { durationPercentile };
