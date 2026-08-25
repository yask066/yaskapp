import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { decodeAdminCursor, pageWithCursor } from '../admin/pagination.js';
import type { UserRole } from '../auth/auth.repository.js';
import { recordAdminAudit } from '../admin/audit.repository.js';
import { listUserSanctions } from './sanctions.repository.js';

export const reportTargetTypes = ['user', 'poll', 'comment'] as const;
export type ReportTargetType = (typeof reportTargetTypes)[number];

export const reportCategories = [
  'spam',
  'harassment',
  'hate_or_discrimination',
  'sexual_content',
  'violence_or_threat',
  'fraud_or_scam',
  'impersonation',
  'other'
] as const;
export type ReportCategory = (typeof reportCategories)[number];

export type ModerationCaseStatus =
  | 'open'
  | 'triaged'
  | 'in_review'
  | 'resolved'
  | 'dismissed'
  | 'escalated'
  | 'duplicate';
export type ModerationCasePriority = 'low' | 'normal' | 'high' | 'critical';

export class ModerationTargetNotFoundError extends Error {}
export class ModerationCaseNotFoundError extends Error {}
export class ModerationCaseConflictError extends Error {}

type ReportRow = {
  id: string;
  reporter_user_id: string;
  target_type: ReportTargetType;
  target_id: string;
  category: ReportCategory;
  description: string;
  status: string;
  created_at: Date;
  updated_at: Date;
};

type CaseRow = {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  status: ModerationCaseStatus;
  priority: ModerationCasePriority;
  assigned_to_user_id: string | null;
  reports_count?: number;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
};

function mapReport(row: ReportRow) {
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    category: row.category,
    description: row.description,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapCase(row: CaseRow) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    status: row.status,
    priority: row.priority,
    assignedToUserId: row.assigned_to_user_id,
    reportsCount: Number(row.reports_count ?? 0),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null
  };
}

async function lockReportableTarget(client: PoolClient, targetType: ReportTargetType, targetId: string) {
  if (targetType === 'user') {
    const result = await client.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [targetId]);
    return result.rowCount === 1;
  }

  if (targetType === 'poll') {
    const result = await client.query('SELECT id FROM polls WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [targetId]);
    return result.rowCount === 1;
  }

  const result = await client.query(
    `SELECT c.id
       FROM comments c
       JOIN polls p ON p.id = c.poll_id AND p.deleted_at IS NULL
      WHERE c.id = $1 AND c.deleted_at IS NULL
      FOR UPDATE OF c`,
    [targetId]
  );
  return result.rowCount === 1;
}

export async function createReport(input: {
  reporterUserId: string;
  targetType: ReportTargetType;
  targetId: string;
  category: ReportCategory;
  description: string;
}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (!(await lockReportableTarget(client, input.targetType, input.targetId))) {
      throw new ModerationTargetNotFoundError('Report target was not found.');
    }

    const duplicate = await client.query<ReportRow>(
      `SELECT r.id, r.reporter_user_id, r.target_type, r.target_id, r.category,
              r.description, r.status, r.created_at, r.updated_at
         FROM reports r
        WHERE r.reporter_user_id = $1
          AND r.target_type = $2
          AND r.target_id = $3
          AND r.status IN ('open', 'triaged', 'in_review', 'escalated')
        ORDER BY r.created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.reporterUserId, input.targetType, input.targetId]
    );

    if (duplicate.rows[0]) {
      const existingCase = await client.query<CaseRow>(
        `SELECT mc.id, mc.target_type, mc.target_id, mc.status, mc.priority,
                mc.assigned_to_user_id, mc.created_at, mc.updated_at, mc.resolved_at,
                count(mcr.report_id)::int AS reports_count
           FROM moderation_cases mc
           JOIN moderation_case_reports mcr ON mcr.case_id = mc.id
          WHERE mcr.report_id = $1
          GROUP BY mc.id
          LIMIT 1`,
        [duplicate.rows[0].id]
      );
      await client.query('COMMIT');
      return {
        report: mapReport(duplicate.rows[0]),
        case: mapCase(existingCase.rows[0]),
        deduplicated: true
      };
    }

    const caseResult = await client.query<CaseRow>(
      `SELECT id, target_type, target_id, status, priority,
              assigned_to_user_id, created_at, updated_at, resolved_at
         FROM moderation_cases
        WHERE target_type = $1
          AND target_id = $2
          AND status IN ('open', 'triaged', 'in_review', 'escalated')
        LIMIT 1
        FOR UPDATE`,
      [input.targetType, input.targetId]
    );

    let moderationCase = caseResult.rows[0];
    if (moderationCase) {
      const countResult = await client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM moderation_case_reports WHERE case_id = $1',
        [moderationCase.id]
      );
      moderationCase = { ...moderationCase, reports_count: countResult.rows[0]?.count ?? 0 };
    } else {
      moderationCase = (await client.query<CaseRow>(
        `INSERT INTO moderation_cases (target_type, target_id)
         VALUES ($1, $2)
         RETURNING id, target_type, target_id, status, priority,
                   assigned_to_user_id, created_at, updated_at, resolved_at`,
        [input.targetType, input.targetId]
      )).rows[0];
    }

    const report = (await client.query<ReportRow>(
      `INSERT INTO reports (reporter_user_id, target_type, target_id, category, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, reporter_user_id, target_type, target_id, category,
                 description, status, created_at, updated_at`,
      [input.reporterUserId, input.targetType, input.targetId, input.category, input.description]
    )).rows[0];

    await client.query(
      'INSERT INTO moderation_case_reports (case_id, report_id) VALUES ($1, $2)',
      [moderationCase.id, report.id]
    );
    await client.query('COMMIT');

    return {
      report: mapReport(report),
      case: mapCase({ ...moderationCase, reports_count: Number(moderationCase.reports_count ?? 0) + 1 }),
      deduplicated: false
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listUserReports(input: {
  reporterUserId: string;
  limit: number;
  cursor?: string;
}) {
  const values: unknown[] = [input.reporterUserId];
  const conditions = ['r.reporter_user_id = $1'];

  if (input.cursor) {
    const cursor = decodeAdminCursor(input.cursor);
    values.push(cursor.createdAt, cursor.id);
    conditions.push(`(r.created_at, r.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
  }

  values.push(input.limit + 1);
  const result = await db.query<ReportRow>(
    `SELECT r.id, r.reporter_user_id, r.target_type, r.target_id, r.category,
            r.description, r.status, r.created_at, r.updated_at
       FROM reports r
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $${values.length}`,
    values
  );

  return pageWithCursor(result.rows.map(mapReport), input.limit);
}

export async function listModerationCases(input: {
  status?: ModerationCaseStatus;
  category?: ReportCategory;
  priority?: ModerationCasePriority;
  assigneeId?: string;
  targetType?: ReportTargetType;
  limit: number;
  cursor?: string;
}) {
  const values: unknown[] = [];
  const conditions = ['TRUE'];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  };

  if (input.status) add('mc.status = ?', input.status);
  if (input.priority) add('mc.priority = ?', input.priority);
  if (input.assigneeId) add('mc.assigned_to_user_id = ?', input.assigneeId);
  if (input.targetType) add('mc.target_type = ?', input.targetType);
  if (input.category) {
    values.push(input.category);
    conditions.push(`EXISTS (SELECT 1 FROM reports category_report WHERE category_report.target_type = mc.target_type AND category_report.target_id = mc.target_id AND category_report.category = $${values.length})`);
  }
  if (input.cursor) {
    const cursor = decodeAdminCursor(input.cursor);
    values.push(cursor.createdAt, cursor.id);
    conditions.push(`(mc.created_at, mc.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
  }

  values.push(input.limit + 1);
  const result = await db.query<CaseRow>(
    `SELECT mc.id, mc.target_type, mc.target_id, mc.status, mc.priority,
            mc.assigned_to_user_id, mc.created_at, mc.updated_at, mc.resolved_at,
            count(mcr.report_id)::int AS reports_count
       FROM moderation_cases mc
       LEFT JOIN moderation_case_reports mcr ON mcr.case_id = mc.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY mc.id
      ORDER BY mc.created_at DESC, mc.id DESC
      LIMIT $${values.length}`,
    values
  );

  return pageWithCursor(result.rows.map(mapCase), input.limit);
}

async function getCaseRow(executor: Pick<PoolClient, 'query'>, caseId: string) {
  const result = await executor.query<CaseRow>(
    `SELECT mc.id, mc.target_type, mc.target_id, mc.status, mc.priority,
            mc.assigned_to_user_id, mc.created_at, mc.updated_at, mc.resolved_at,
            count(mcr.report_id)::int AS reports_count
       FROM moderation_cases mc
       LEFT JOIN moderation_case_reports mcr ON mcr.case_id = mc.id
      WHERE mc.id = $1
      GROUP BY mc.id
      LIMIT 1`,
    [caseId]
  );
  return result.rows[0];
}

export async function getModerationCase(caseId: string) {
  const moderationCase = await getCaseRow(db, caseId);
  if (!moderationCase) throw new ModerationCaseNotFoundError('Moderation case was not found.');

  const [reports, notes, sanctions] = await Promise.all([
    db.query<ReportRow>(
      `SELECT r.id, r.reporter_user_id, r.target_type, r.target_id, r.category,
              r.description, r.status, r.created_at, r.updated_at
         FROM reports r
         JOIN moderation_case_reports mcr ON mcr.report_id = r.id
        WHERE mcr.case_id = $1
        ORDER BY r.created_at ASC, r.id ASC`,
      [caseId]
    ),
    db.query<{
      id: string;
      author_user_id: string | null;
      body: string;
      created_at: Date;
    }>(
      `SELECT id, author_user_id, body, created_at
         FROM moderation_case_notes
        WHERE case_id = $1
        ORDER BY created_at ASC, id ASC`,
      [caseId]
    ),
    moderationCase.target_type === 'user' ? listUserSanctions(moderationCase.target_id) : Promise.resolve([])
  ]);

  return {
    case: mapCase(moderationCase),
    reports: reports.rows.map(mapReport),
    sanctions,
    notes: notes.rows.map((note) => ({
      id: note.id,
      authorUserId: note.author_user_id,
      body: note.body,
      createdAt: note.created_at.toISOString()
    }))
  };
}

async function mutateCase(
  caseId: string,
  actorUserId: string,
  actorRole: UserRole,
  action: 'assign' | 'takeover' | 'resolve' | 'dismiss' | 'escalate',
  input?: { resolutionCode?: string; note?: string }
) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<CaseRow>(
      `SELECT id, target_type, target_id, status, priority,
              assigned_to_user_id, created_at, updated_at, resolved_at
         FROM moderation_cases
        WHERE id = $1
        FOR UPDATE`,
      [caseId]
    );
    const moderationCase = current.rows[0];
    if (!moderationCase) throw new ModerationCaseNotFoundError('Moderation case was not found.');

    if (['resolved', 'dismissed', 'duplicate'].includes(moderationCase.status)) {
      throw new ModerationCaseConflictError('Moderation case is already closed.');
    }
    if (action === 'assign' && moderationCase.assigned_to_user_id && moderationCase.assigned_to_user_id !== actorUserId) {
      throw new ModerationCaseConflictError('Moderation case is already assigned to another moderator.');
    }

    const nextStatus = action === 'resolve'
      ? 'resolved'
      : action === 'dismiss'
        ? 'dismissed'
        : action === 'escalate'
          ? 'escalated'
          : 'in_review';
    const auditAction = action === 'assign'
      ? 'moderation.case_assigned'
      : action === 'takeover'
        ? 'moderation.case_taken_over'
        : action === 'resolve'
          ? 'moderation.case_resolved'
          : action === 'dismiss'
            ? 'moderation.case_dismissed'
            : 'moderation.case_escalated';

    await client.query(
      `UPDATE moderation_cases
          SET assigned_to_user_id = $1,
              status = $2,
              resolution_code = $3,
              resolution_note = $4,
              resolved_at = CASE WHEN $2 IN ('resolved', 'dismissed') THEN now() ELSE NULL END
        WHERE id = $5`,
      [
        action === 'resolve' || action === 'dismiss' || action === 'escalate'
          ? moderationCase.assigned_to_user_id ?? actorUserId
          : actorUserId,
        nextStatus,
        input?.resolutionCode ?? null,
        input?.note ?? null,
        caseId
      ]
    );
    await recordAdminAudit(client, {
      actorUserId,
      actorRole,
      action: auditAction,
      targetType: 'case',
      targetId: caseId,
      reason: input?.note ?? `Moderation case ${action}.`
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getModerationCase(caseId);
}

export function assignModerationCase(caseId: string, actorUserId: string, actorRole: UserRole) {
  return mutateCase(caseId, actorUserId, actorRole, 'assign');
}

export function takeoverModerationCase(caseId: string, actorUserId: string, actorRole: UserRole) {
  return mutateCase(caseId, actorUserId, actorRole, 'takeover');
}

export function transitionModerationCase(
  caseId: string,
  actorUserId: string,
  actorRole: UserRole,
  action: 'resolve' | 'dismiss' | 'escalate',
  input: { resolutionCode?: string; note?: string }
) {
  return mutateCase(caseId, actorUserId, actorRole, action, input);
}

export async function addModerationNote(caseId: string, authorUserId: string, actorRole: UserRole, body: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const moderationCase = await client.query<{ id: string }>(
      `SELECT id FROM moderation_cases
        WHERE id = $1 AND status NOT IN ('resolved', 'dismissed', 'duplicate')
        FOR UPDATE`,
      [caseId]
    );
    if (!moderationCase.rows[0]) throw new ModerationCaseNotFoundError('Open moderation case was not found.');
    const note = (await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO moderation_case_notes (case_id, author_user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [caseId, authorUserId, body]
    )).rows[0];
    await recordAdminAudit(client, {
      actorUserId: authorUserId,
      actorRole,
      action: 'moderation.note_added',
      targetType: 'case',
      targetId: caseId,
      reason: 'Moderation note added.',
      metadata: { noteId: note.id }
    });
    await client.query('COMMIT');
    return { id: note.id, authorUserId, body, createdAt: note.created_at.toISOString() };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
