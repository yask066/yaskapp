import type { PoolClient } from 'pg';
import { db } from '../../config/database.js';
import { AdminCursorError, decodeAdminCursor, pageWithCursor } from '../admin/pagination.js';

export async function snapshotDeletedAccount(
  client: PoolClient, userId: string, deletedAt: Date, source: 'self_service' | 'admin'
) {
  await client.query(
    `WITH related_cases AS MATERIALIZED (
       SELECT mc.* FROM moderation_cases mc WHERE
         (mc.target_type = 'user' AND mc.target_id = $1)
         OR (mc.target_type = 'poll' AND EXISTS (SELECT 1 FROM polls p WHERE p.id = mc.target_id AND p.author_id = $1))
         OR (mc.target_type = 'comment' AND EXISTS (
           SELECT 1 FROM comments c JOIN polls p ON p.id = c.poll_id
           WHERE c.id = mc.target_id AND (c.author_id = $1 OR p.author_id = $1)))
     )
     INSERT INTO deleted_account_archives (user_id, source, deleted_at, expires_at, profile, ips, evidence)
     SELECT u.id, $3, $2::timestamptz, $2::timestamptz + interval '30 days',
       jsonb_build_object('username', u.username, 'email', u.email, 'role', u.role,
         'displayName', p.display_name, 'bio', p.bio, 'countryCode', p.country_code, 'createdAt', u.created_at),
       COALESCE((SELECT jsonb_agg(jsonb_build_object('ip', host(h.ip), 'firstSeenAt', h.first_seen_at,
         'lastSeenAt', h.last_seen_at) ORDER BY h.last_seen_at DESC, h.ip)
         FROM account_ip_history h WHERE h.user_id = u.id AND h.last_seen_at > $2::timestamptz - interval '30 days'), '[]'::jsonb),
       jsonb_build_object('cases', COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'id', mc.id, 'targetType', mc.target_type, 'targetId', mc.target_id,
         'status', mc.status, 'priority', mc.priority, 'createdAt', mc.created_at,
         'resolutionCode', mc.resolution_code, 'resolutionNote', mc.resolution_note,
         'content', CASE mc.target_type
           WHEN 'poll' THEN (SELECT jsonb_build_object('question', cp.question, 'description', cp.description) FROM polls cp WHERE cp.id = mc.target_id)
           WHEN 'comment' THEN (SELECT jsonb_build_object('body', cc.body) FROM comments cc WHERE cc.id = mc.target_id)
           ELSE NULL END,
         'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('body', n.body, 'createdAt', n.created_at) ORDER BY n.created_at, n.id)
           FROM moderation_case_notes n WHERE n.case_id = mc.id), '[]'::jsonb),
         'reports', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', r.category, 'description', r.description, 'createdAt', r.created_at) ORDER BY r.created_at, r.id)
           FROM reports r JOIN moderation_case_reports cr ON cr.report_id = r.id WHERE cr.case_id = mc.id), '[]'::jsonb)
       ) ORDER BY mc.created_at, mc.id) FROM related_cases mc), '[]'::jsonb),
       'sanctions', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', s.type, 'reason', s.reason,
         'status', s.status, 'createdAt', s.created_at, 'expiresAt', s.expires_at) ORDER BY s.created_at, s.id)
         FROM sanctions s WHERE s.user_id = u.id), '[]'::jsonb),
       'appeals', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', a.reason, 'status', a.status,
         'decisionNote', a.decision_note, 'createdAt', a.created_at) ORDER BY a.created_at, a.id)
         FROM appeals a WHERE a.user_id = u.id), '[]'::jsonb))
     FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1
     ON CONFLICT (user_id) DO NOTHING`, [userId, deletedAt, source]
  );
}

type ArchiveRow = {
  user_id: string; source: string; deleted_at: Date; expires_at: Date;
  profile: Record<string, unknown>; ips: Array<{ ip: string; firstSeenAt: string; lastSeenAt: string }>;
  evidence: Record<string, unknown>;
};

function mapArchive(row: ArchiveRow) {
  return { userId: row.user_id, source: row.source, deletedAt: row.deleted_at.toISOString(),
    expiresAt: row.expires_at.toISOString(), profile: row.profile, ips: row.ips, evidence: row.evidence };
}

export async function listDeletedAccountArchives(input: { limit: number; query?: string; cursor?: string }) {
  const values: unknown[] = [];
  const conditions = ['expires_at > now()'];
  if (input.query) {
    values.push(input.query);
    conditions.push(`(strpos(lower(profile->>'username'), lower($${values.length})) > 0
      OR strpos(lower(profile->>'email'), lower($${values.length})) > 0 OR user_id::text = $${values.length})`);
  }
  if (input.cursor) {
    const cursor = decodeAdminCursor(input.cursor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)) throw new AdminCursorError('Invalid archive cursor.');
    values.push(cursor.createdAt, cursor.id);
    conditions.push(`(deleted_at, user_id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
  }
  values.push(input.limit + 1);
  // The list excludes IPs/evidence. Detailed access is separately audited.
  const result = await db.query<ArchiveRow>(`SELECT user_id, source, deleted_at, expires_at, profile
    FROM deleted_account_archives WHERE ${conditions.join(' AND ')} ORDER BY deleted_at DESC, user_id DESC LIMIT $${values.length}`, values);
  return pageWithCursor(result.rows.map((row) => ({ userId: row.user_id, source: row.source, profile: row.profile,
    deletedAt: row.deleted_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    id: row.user_id, createdAt: row.deleted_at.toISOString() })), input.limit);
}

export async function readDeletedAccountArchive(userId: string, actorId: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<ArchiveRow>(
      'SELECT * FROM deleted_account_archives WHERE user_id = $1 AND expires_at > now() FOR SHARE', [userId]);
    if (!result.rows[0]) { await client.query('COMMIT'); return null; }
    await client.query(`INSERT INTO deleted_account_archive_access (archived_user_id, actor_user_id, action) VALUES ($1, $2, 'read')`, [userId, actorId]);
    await client.query('COMMIT');
    return mapArchive(result.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function cleanupDeletedAccountArchives(now: Date) {
  const result = await db.query('DELETE FROM deleted_account_archives WHERE expires_at <= $1', [now]);
  await db.query("DELETE FROM account_ip_history WHERE last_seen_at <= $1::timestamptz - interval '30 days'", [now]);
  return result.rowCount ?? 0;
}
