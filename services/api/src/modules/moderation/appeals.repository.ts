import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { decodeAdminCursor, pageWithCursor } from '../admin/pagination.js';
import { recordAdminAudit } from '../admin/audit.repository.js';
import type { UserRole } from '../auth/auth.repository.js';

export type AppealStatus = 'open' | 'upheld' | 'reduced' | 'revoked' | 'request_more_info';

export class AppealNotFoundError extends Error {}
export class AppealConflictError extends Error {}

type AppealRow = {
  id: string;
  sanction_id: string;
  user_id: string;
  status: AppealStatus;
  reason: string;
  decision_note: string | null;
  resolved_by_user_id: string | null;
  created_at: Date;
  resolved_at: Date | null;
};

function mapAppeal(row: AppealRow) {
  return {
    id: row.id,
    sanctionId: row.sanction_id,
    userId: row.user_id,
    status: row.status,
    reason: row.reason,
    decisionNote: row.decision_note,
    resolvedByUserId: row.resolved_by_user_id,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null
  };
}

async function claimIdempotency(client: PoolClient, actorUserId: string, key: string, fingerprint: string) {
  const existing = await client.query<{ request_fingerprint: string; response: unknown }>(
    'SELECT request_fingerprint, response FROM moderation_idempotency_keys WHERE actor_user_id = $1 AND idempotency_key = $2 FOR UPDATE',
    [actorUserId, key]
  );
  if (existing.rows[0]) {
    if (existing.rows[0].request_fingerprint !== fingerprint) throw new AppealConflictError('Idempotency-Key was already used with a different request.');
    if (existing.rows[0].response) return { replayed: true, response: existing.rows[0].response as { appeal: ReturnType<typeof mapAppeal> } };
    return { replayed: false };
  }
  await client.query(
    `INSERT INTO moderation_idempotency_keys (actor_user_id, idempotency_key, request_fingerprint, expires_at)
     VALUES ($1, $2, $3, now() + interval '24 hours')`,
    [actorUserId, key, fingerprint]
  );
  return { replayed: false };
}

async function saveIdempotency(client: PoolClient, actorUserId: string, key: string, response: unknown) {
  await client.query(
    `UPDATE moderation_idempotency_keys SET status_code = 201, response = $3::jsonb
      WHERE actor_user_id = $1 AND idempotency_key = $2`,
    [actorUserId, key, JSON.stringify(response)]
  );
}

export async function createAppeal(input: { sanctionId: string; userId: string; reason: string; idempotencyKey: string; fingerprint: string }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const idempotency = await claimIdempotency(client, input.userId, input.idempotencyKey, input.fingerprint);
    if (idempotency.replayed) {
      await client.query('COMMIT');
      return { replayed: true as const, ...idempotency.response };
    }
    const sanction = await client.query<{ user_id: string | null; status: string; expires_at: Date | null }>(
      `SELECT user_id, status, expires_at FROM sanctions WHERE id = $1 FOR UPDATE`,
      [input.sanctionId]
    );
    const target = sanction.rows[0];
    if (!target || target.user_id !== input.userId) throw new AppealNotFoundError('Sanction was not found for this user.');
    if (target.status !== 'active' || (target.expires_at && target.expires_at <= new Date())) throw new AppealConflictError('Only an active sanction can be appealed.');
    const result = await client.query<AppealRow>(
      `INSERT INTO appeals (sanction_id, user_id, reason) VALUES ($1, $2, $3)
       RETURNING id, sanction_id, user_id, status, reason, decision_note,
                 resolved_by_user_id, created_at, resolved_at`,
      [input.sanctionId, input.userId, input.reason]
    );
    const appeal = result.rows[0];
    if (!appeal) throw new Error('Appeal insert did not return a row.');
    await recordAdminAudit(client, {
      actorUserId: input.userId,
      actorRole: 'user',
      action: 'moderation.appeal_created',
      targetType: 'user',
      targetId: input.userId,
      reason: 'Appeal submitted.',
      metadata: { appealId: appeal.id, sanctionId: input.sanctionId }
    });
    const response = { appeal: mapAppeal(appeal) };
    await saveIdempotency(client, input.userId, input.idempotencyKey, response);
    await client.query('COMMIT');
    return { replayed: false as const, ...response };
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new AppealConflictError('An active appeal already exists for this sanction.');
    throw error;
  } finally {
    client.release();
  }
}

export async function listAppeals(input: { status?: AppealStatus; limit: number; cursor?: string }) {
  const values: unknown[] = [];
  const conditions = ['TRUE'];
  if (input.status) { values.push(input.status); conditions.push(`status = $${values.length}`); }
  if (input.cursor) {
    const cursor = decodeAdminCursor(input.cursor);
    values.push(cursor.createdAt, cursor.id);
    conditions.push(`(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
  }
  values.push(input.limit + 1);
  const result = await db.query<AppealRow>(
    `SELECT id, sanction_id, user_id, status, reason, decision_note,
            resolved_by_user_id, created_at, resolved_at
       FROM appeals WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
    values
  );
  return pageWithCursor(result.rows.map(mapAppeal), input.limit);
}

export async function resolveAppeal(input: {
  appealId: string;
  actorUserId: string;
  actorRole: UserRole;
  status: Exclude<AppealStatus, 'open'>;
  decisionNote: string;
  idempotencyKey: string;
  fingerprint: string;
}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const idempotency = await claimIdempotency(client, input.actorUserId, input.idempotencyKey, input.fingerprint);
    if (idempotency.replayed) { await client.query('COMMIT'); return { replayed: true as const, ...idempotency.response }; }
    const result = await client.query<AppealRow & { sanction_user_id: string | null; sanction_type: string }>(
      `SELECT a.id, a.sanction_id, a.user_id, a.status, a.reason, a.decision_note,
              a.resolved_by_user_id, a.created_at, a.resolved_at,
              s.user_id AS sanction_user_id, s.type AS sanction_type
         FROM appeals a JOIN sanctions s ON s.id = a.sanction_id
        WHERE a.id = $1 FOR UPDATE OF a, s`,
      [input.appealId]
    );
    const appeal = result.rows[0];
    if (!appeal) throw new AppealNotFoundError('Appeal was not found.');
    if (appeal.status !== 'open') throw new AppealConflictError('Appeal has already been resolved.');
    const resolved = (await client.query<AppealRow>(
      `UPDATE appeals SET status = $1, decision_note = $2, resolved_by_user_id = $3, resolved_at = now()
        WHERE id = $4
        RETURNING id, sanction_id, user_id, status, reason, decision_note,
                  resolved_by_user_id, created_at, resolved_at`,
      [input.status, input.decisionNote, input.actorUserId, input.appealId]
    )).rows[0];
    if (!resolved) throw new Error('Appeal update did not return a row.');
    if (input.status === 'reduced' || input.status === 'revoked') {
      await client.query(
        `UPDATE sanctions SET status = 'revoked', revoked_at = now(), revoked_by_user_id = $1
          WHERE id = $2 AND status = 'active'`,
        [input.actorUserId, appeal.sanction_id]
      );
      if ((appeal.sanction_type === 'temporary_ban' || appeal.sanction_type === 'permanent_ban') && appeal.sanction_user_id) {
        await client.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [appeal.sanction_user_id]);
      }
    }
    await recordAdminAudit(client, {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'moderation.appeal_resolved',
      targetType: 'user',
      targetId: appeal.user_id,
      reason: input.decisionNote,
      metadata: { appealId: input.appealId, sanctionId: appeal.sanction_id, decision: input.status }
    });
    const response = { appeal: mapAppeal(resolved) };
    await saveIdempotency(client, input.actorUserId, input.idempotencyKey, response);
    await client.query('COMMIT');
    return { replayed: false as const, ...response };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
