import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';

const PURGE_BATCH_SIZE = 100;
const REDACTED_TEXT = 'Removed during account deletion.';

async function loadDeletion(client: PoolClient, operationId: string) {
  const result = await client.query<{ user_id: string }>(
    'SELECT user_id FROM account_deletion_operations WHERE id = $1',
    [operationId]
  );
  const userId = result.rows[0]?.user_id;
  if (!userId) throw new Error('account_deletion_operation_not_found');
  const [targets, ownedPolls, ownedComments] = await Promise.all([
    client.query<{ target_type: 'poll' | 'comment'; target_id: string }>(
    `SELECT target_type, target_id FROM account_deletion_content_targets
      WHERE operation_id = $1 ORDER BY target_type, target_id`,
    [operationId]
    ),
    client.query<{ id: string }>('SELECT id FROM polls WHERE author_id = $1', [userId]),
    client.query<{ id: string }>(
      `SELECT c.id FROM comments c LEFT JOIN polls p ON p.id = c.poll_id
        WHERE c.author_id = $1 OR p.author_id = $1`,
      [userId]
    )
  ]);
  const pollIds = [...new Set([
    ...targets.rows.filter((row) => row.target_type === 'poll').map((row) => row.target_id),
    ...ownedPolls.rows.map((row) => row.id)
  ])];
  const commentIds = [...new Set([
    ...targets.rows.filter((row) => row.target_type === 'comment').map((row) => row.target_id),
    ...ownedComments.rows.map((row) => row.id)
  ])];
  const cases = await client.query<{ id: string }>(
    `SELECT id FROM moderation_cases
      WHERE (target_type = 'user' AND target_id = $1)
         OR (target_type = 'poll' AND target_id = ANY($2::uuid[]))
         OR (target_type = 'comment' AND target_id = ANY($3::uuid[]))`,
    [userId, pollIds, commentIds]
  );
  return {
    userId,
    pollIds,
    commentIds,
    caseIds: cases.rows.map((row) => row.id)
  };
}

async function purgeModerationBatch(client: PoolClient, userId: string, pollIds: string[], commentIds: string[], caseIds: string[]) {
  let changed = 0;

  const ownReports = await client.query(
    `WITH batch AS (
       SELECT id FROM reports WHERE reporter_user_id = $1
        ORDER BY created_at, id LIMIT $2 FOR UPDATE
     )
     DELETE FROM reports r USING batch WHERE r.id = batch.id`,
    [userId, PURGE_BATCH_SIZE]
  );
  changed += ownReports.rowCount ?? 0;

  const foreignReports = await client.query(
    `WITH batch AS (
       SELECT id FROM reports
        WHERE reporter_user_id <> $1 AND (
          (target_type = 'user' AND target_id = $1)
          OR (target_type = 'poll' AND target_id = ANY($2::uuid[]))
          OR (target_type = 'comment' AND target_id = ANY($3::uuid[]))
        )
        ORDER BY created_at, id LIMIT $4 FOR UPDATE
     )
     UPDATE reports r
        SET target_id = NULL, description = $5, updated_at = now()
       FROM batch WHERE r.id = batch.id`,
    [userId, pollIds, commentIds, PURGE_BATCH_SIZE, REDACTED_TEXT]
  );
  changed += foreignReports.rowCount ?? 0;

  const foreignAppeals = await client.query(
    `WITH batch AS (
       SELECT a.id
         FROM appeals a
         JOIN sanctions s ON s.id = a.sanction_id
        WHERE a.user_id <> $1 AND (
          s.user_id = $1 OR s.created_by_user_id = $1 OR s.revoked_by_user_id = $1
          OR a.resolved_by_user_id = $1 OR s.case_id = ANY($4::uuid[])
        ) AND (a.reason <> $5 OR a.decision_note IS NOT NULL OR a.resolved_by_user_id = $1)
        ORDER BY a.created_at, a.id LIMIT $6 FOR UPDATE OF a
     )
     UPDATE appeals a
        SET reason = $5, decision_note = NULL,
            resolved_by_user_id = CASE WHEN a.resolved_by_user_id = $1 THEN NULL ELSE a.resolved_by_user_id END
       FROM batch WHERE a.id = batch.id`,
    [userId, pollIds, commentIds, caseIds, REDACTED_TEXT, PURGE_BATCH_SIZE]
  );
  changed += foreignAppeals.rowCount ?? 0;

  const releasedCases = await client.query(
    `WITH batch AS (
       SELECT id FROM moderation_cases WHERE assigned_to_user_id = $1
        ORDER BY created_at, id LIMIT $2 FOR UPDATE
     )
     UPDATE moderation_cases mc SET assigned_to_user_id = NULL, resolution_note = NULL
       FROM batch WHERE mc.id = batch.id`,
    [userId, PURGE_BATCH_SIZE]
  );
  changed += releasedCases.rowCount ?? 0;

  const authoredNotes = await client.query(
    `WITH batch AS (
       SELECT id FROM moderation_case_notes WHERE author_user_id = $1
        ORDER BY created_at, id LIMIT $2 FOR UPDATE
     )
     UPDATE moderation_case_notes n
        SET author_user_id = NULL, body = $3
       FROM batch WHERE n.id = batch.id`,
    [userId, PURGE_BATCH_SIZE, REDACTED_TEXT]
  );
  changed += authoredNotes.rowCount ?? 0;

  const ownAppeals = await client.query(
    `WITH batch AS (
       SELECT id FROM appeals WHERE user_id = $1
        ORDER BY created_at, id LIMIT $2 FOR UPDATE
     )
     DELETE FROM appeals a USING batch WHERE a.id = batch.id`,
    [userId, PURGE_BATCH_SIZE]
  );
  changed += ownAppeals.rowCount ?? 0;

  const sanctions = await client.query(
    `WITH batch AS (
       SELECT id FROM sanctions
        WHERE user_id = $1 OR created_by_user_id = $1 OR revoked_by_user_id = $1
           OR (case_id = ANY($2::uuid[]) AND (reason <> $4 OR metadata <> '{}'::jsonb))
        ORDER BY created_at, id LIMIT $3 FOR UPDATE
     )
     UPDATE sanctions s
        SET user_id = CASE WHEN s.user_id = $1 THEN NULL ELSE s.user_id END,
            created_by_user_id = NULL, revoked_by_user_id = NULL,
            reason = $4, metadata = '{}'::jsonb
       FROM batch WHERE s.id = batch.id`,
    [userId, caseIds, PURGE_BATCH_SIZE, REDACTED_TEXT]
  );
  changed += sanctions.rowCount ?? 0;

  const strikes = await client.query(
    `WITH batch AS (
       SELECT id FROM user_strikes WHERE user_id = $1
        ORDER BY created_at, id LIMIT $2 FOR UPDATE
     )
     UPDATE user_strikes s SET user_id = NULL
       FROM batch WHERE s.id = batch.id`,
    [userId, PURGE_BATCH_SIZE]
  );
  changed += strikes.rowCount ?? 0;

  const idempotency = await client.query(
    `WITH batch AS (
       SELECT actor_user_id, idempotency_key FROM moderation_idempotency_keys WHERE actor_user_id = $1
        ORDER BY created_at, idempotency_key LIMIT $2 FOR UPDATE
     )
     DELETE FROM moderation_idempotency_keys k USING batch
      WHERE k.actor_user_id = batch.actor_user_id AND k.idempotency_key = batch.idempotency_key`,
    [userId, PURGE_BATCH_SIZE]
  );
  changed += idempotency.rowCount ?? 0;

  const audits = await client.query(
    `WITH batch AS (
       SELECT id FROM admin_audit_log
        WHERE actor_user_id = $1 OR (target_type = 'user' AND target_id = $1)
           OR (target_type = 'poll' AND target_id = ANY($2::uuid[]))
           OR (target_type = 'comment' AND target_id = ANY($3::uuid[]))
           OR (target_type = 'case' AND target_id = ANY($4::uuid[]))
        ORDER BY created_at, id LIMIT $5 FOR UPDATE
     )
     UPDATE admin_audit_log a
        SET actor_user_id = NULL,
            target_id = CASE
              WHEN (a.target_type = 'user' AND a.target_id = $1)
                OR (a.target_type = 'poll' AND a.target_id = ANY($2::uuid[]))
                OR (a.target_type = 'comment' AND a.target_id = ANY($3::uuid[]))
                OR (a.target_type = 'case' AND a.target_id = ANY($4::uuid[]))
              THEN NULL ELSE a.target_id END,
            reason = $6,
            metadata = '{}'::jsonb, request_id = NULL
       FROM batch WHERE a.id = batch.id`,
    [userId, pollIds, commentIds, caseIds, PURGE_BATCH_SIZE, REDACTED_TEXT]
  );
  changed += audits.rowCount ?? 0;

  const policy = await client.query('UPDATE moderation_policies SET updated_by_user_id = NULL WHERE updated_by_user_id = $1', [userId]);
  changed += policy.rowCount ?? 0;

  const dependentSnapshots = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM sanctions
        WHERE case_id = ANY($1::uuid[]) AND (reason <> $2 OR metadata <> '{}'::jsonb)
     ) OR EXISTS (
       SELECT 1 FROM appeals a JOIN sanctions s ON s.id = a.sanction_id
        WHERE s.case_id = ANY($1::uuid[])
          AND (a.reason <> $2 OR a.decision_note IS NOT NULL OR a.resolved_by_user_id = $3)
     ) OR EXISTS (
       SELECT 1 FROM admin_audit_log
        WHERE target_type = 'case' AND target_id = ANY($1::uuid[])
          AND (target_id IS NOT NULL OR reason <> $2 OR metadata <> '{}'::jsonb OR request_id IS NOT NULL OR actor_user_id = $3)
     ) AS exists`,
    [caseIds, REDACTED_TEXT, userId]
  );
  const detachedCases = dependentSnapshots.rows[0]?.exists
    ? { rows: [{ count: 0 }] }
    : await client.query<{ count: number }>(
    `WITH batch AS MATERIALIZED (
       SELECT id FROM moderation_cases
        WHERE (target_type = 'user' AND target_id = $1)
           OR (target_type = 'poll' AND target_id = ANY($2::uuid[]))
           OR (target_type = 'comment' AND target_id = ANY($3::uuid[]))
        ORDER BY created_at, id LIMIT $4 FOR UPDATE
     ), redacted_notes AS (
       UPDATE moderation_case_notes n SET body = $5
        WHERE n.case_id IN (SELECT id FROM batch) AND n.body <> $5
       RETURNING n.id
     ), updated AS (
       UPDATE moderation_cases mc
          SET target_id = NULL, resolution_note = NULL
         WHERE mc.id IN (SELECT id FROM batch)
       RETURNING mc.id
     )
     SELECT count(*)::int AS count FROM updated`,
    [userId, pollIds, commentIds, PURGE_BATCH_SIZE, REDACTED_TEXT]
  );
  changed += detachedCases.rows[0]?.count ?? 0;

  return changed;
}

export async function purgeAccountModerationData(operationId: string): Promise<{ done: boolean }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { userId, pollIds, commentIds, caseIds } = await loadDeletion(client, operationId);
    if (caseIds.length) {
      await client.query(
        `INSERT INTO account_deletion_moderation_identifiers (operation_id, moderation_case_id, expires_at)
         SELECT $1, target.id, operation.accepted_at + interval '30 days'
         FROM account_deletion_operations operation
         CROSS JOIN unnest($2::uuid[]) AS target(id)
         WHERE operation.id = $1 AND operation.accepted_at IS NOT NULL
         ON CONFLICT (operation_id, moderation_case_id) DO NOTHING`,
        [operationId, caseIds]
      );
    }
    const changed = await purgeModerationBatch(client, userId, pollIds, commentIds, caseIds);
    const remaining = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM reports WHERE reporter_user_id = $1 OR
          (target_type = 'user' AND target_id = $1) OR
          (target_type = 'poll' AND target_id = ANY($2::uuid[])) OR
          (target_type = 'comment' AND target_id = ANY($3::uuid[])))
       OR EXISTS (SELECT 1 FROM moderation_cases WHERE assigned_to_user_id = $1 OR
          (target_type = 'user' AND target_id = $1) OR
          (target_type = 'poll' AND target_id = ANY($2::uuid[])) OR
          (target_type = 'comment' AND target_id = ANY($3::uuid[])))
       OR EXISTS (SELECT 1 FROM moderation_case_notes WHERE author_user_id = $1)
       OR EXISTS (SELECT 1 FROM appeals WHERE user_id = $1 OR resolved_by_user_id = $1 OR
          sanction_id IN (SELECT id FROM sanctions WHERE user_id = $1 OR created_by_user_id = $1 OR revoked_by_user_id = $1))
       OR EXISTS (SELECT 1 FROM sanctions WHERE user_id = $1 OR created_by_user_id = $1 OR revoked_by_user_id = $1)
       OR EXISTS (SELECT 1 FROM user_strikes WHERE user_id = $1)
       OR EXISTS (SELECT 1 FROM moderation_idempotency_keys WHERE actor_user_id = $1)
       OR EXISTS (SELECT 1 FROM admin_audit_log WHERE actor_user_id = $1 OR
          (target_type = 'user' AND target_id = $1) OR
          (target_type = 'poll' AND target_id = ANY($2::uuid[])) OR
          (target_type = 'comment' AND target_id = ANY($3::uuid[])) OR
          (target_type = 'case' AND target_id = ANY($4::uuid[])))
       OR EXISTS (SELECT 1 FROM moderation_policies WHERE updated_by_user_id = $1) AS exists`,
      [userId, pollIds, commentIds, caseIds]
    );
    await client.query('COMMIT');
    return { done: changed === 0 && remaining.rows[0]?.exists !== true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
