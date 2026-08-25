import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import type { UserRole } from '../auth/auth.repository.js';
import { recordAdminAudit } from '../admin/audit.repository.js';

export type SanctionType = 'warning' | 'strike' | 'posting_restriction' | 'comment_restriction' | 'temporary_ban' | 'permanent_ban';
export type SanctionStatus = 'active' | 'expired' | 'revoked';

export class SanctionTargetNotFoundError extends Error {}
export class SanctionCaseConflictError extends Error {}
export class IdempotencyConflictError extends Error {}
export class UserSanctionedError extends Error {
  constructor(public readonly capability: 'login' | 'poll' | 'comment', message: string) {
    super(message);
  }
}

type SanctionRow = {
  id: string;
  user_id: string | null;
  case_id: string | null;
  type: SanctionType;
  status: SanctionStatus;
  reason: string;
  metadata: Record<string, unknown>;
  starts_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};

function mapSanction(row: SanctionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    caseId: row.case_id,
    type: row.type,
    status: row.status,
    reason: row.reason,
    metadata: row.metadata,
    startsAt: row.starts_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}
export type Sanction = ReturnType<typeof mapSanction>;

export async function getActiveUserSanctions(userId: string) {
  const result = await db.query<SanctionRow>(
    `SELECT id, user_id, case_id, type, status, reason, metadata,
            starts_at, expires_at, revoked_at, created_at
       FROM sanctions
      WHERE user_id = $1
        AND status = 'active'
        AND starts_at <= now()
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC, id DESC`,
    [userId]
  );
  return result.rows.map(mapSanction);
}

export async function listUserSanctions(userId: string) {
  const result = await db.query<SanctionRow>(
    `SELECT id, user_id, case_id, type, status, reason, metadata,
            starts_at, expires_at, revoked_at, created_at
       FROM sanctions
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC`,
    [userId]
  );
  return result.rows.map(mapSanction);
}

export function userHasSanction(sanctions: Awaited<ReturnType<typeof getActiveUserSanctions>>, type: SanctionType) {
  return sanctions.some((sanction) => sanction.type === type);
}

export async function assertUserCanAuthenticate(userId: string) {
  const sanctions = await getActiveUserSanctions(userId);
  if (userHasSanction(sanctions, 'temporary_ban') || userHasSanction(sanctions, 'permanent_ban')) {
    throw new UserSanctionedError('login', 'Account access is temporarily restricted.');
  }
}

export async function assertUserCanCreatePoll(userId: string) {
  const sanctions = await getActiveUserSanctions(userId);
  if (userHasSanction(sanctions, 'posting_restriction') || userHasSanction(sanctions, 'temporary_ban') || userHasSanction(sanctions, 'permanent_ban')) {
    throw new UserSanctionedError('poll', 'Creating polls is temporarily restricted.');
  }
}

export async function assertUserCanComment(userId: string) {
  const sanctions = await getActiveUserSanctions(userId);
  if (userHasSanction(sanctions, 'comment_restriction') || userHasSanction(sanctions, 'temporary_ban') || userHasSanction(sanctions, 'permanent_ban')) {
    throw new UserSanctionedError('comment', 'Creating comments is temporarily restricted.');
  }
}

async function getPolicy(client: PoolClient) {
  const result = await client.query<{
    posting_restriction_strikes: number;
    temporary_ban_strikes: number;
    strike_retention_days: number;
    default_restriction_hours: number;
    default_temporary_ban_hours: number;
  }>('SELECT posting_restriction_strikes, temporary_ban_strikes, strike_retention_days, default_restriction_hours, default_temporary_ban_hours FROM moderation_policies WHERE id = TRUE FOR UPDATE');
  if (!result.rows[0]) throw new Error('Moderation policy is not configured.');
  return result.rows[0];
}

async function assertCaseTarget(client: PoolClient, caseId: string, userId: string) {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM moderation_cases
      WHERE id = $1 AND target_type = 'user' AND target_id = $2
        AND status IN ('open', 'triaged', 'in_review', 'escalated')
      FOR UPDATE`,
    [caseId, userId]
  );
  if (!result.rows[0]) throw new SanctionCaseConflictError('An open user moderation case is required.');
}

async function insertSanction(client: PoolClient, input: {
  userId: string;
  caseId: string;
  actorUserId: string;
  actorRole: UserRole;
  type: SanctionType;
  reason: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  const target = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [input.userId]
  );
  if (!target.rows[0]) throw new SanctionTargetNotFoundError('Sanction target was not found.');
  await assertCaseTarget(client, input.caseId, input.userId);
  const result = await client.query<SanctionRow>(
    `INSERT INTO sanctions (user_id, case_id, type, reason, expires_at, metadata, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING id, user_id, case_id, type, status, reason, metadata,
               starts_at, expires_at, revoked_at, created_at`,
    [input.userId, input.caseId, input.type, input.reason, input.expiresAt ?? null, JSON.stringify(input.metadata ?? {}), input.actorUserId]
  );
  const sanction = result.rows[0];
  if (!sanction) throw new Error('Sanction insert did not return a row.');
  await recordAdminAudit(client, {
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.type === 'permanent_ban' ? 'moderation.permanent_ban_issued' : 'moderation.sanction_issued',
    targetType: 'user',
    targetId: input.userId,
    reason: input.reason,
    metadata: { sanctionId: sanction.id, caseId: input.caseId, type: input.type }
  });
  return mapSanction(sanction);
}

async function evaluateStrikePolicy(client: PoolClient, input: {
  userId: string;
  caseId: string;
  actorUserId: string;
  actorRole: UserRole;
}) {
  const policy = await getPolicy(client);
  const activeStrikes = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM user_strikes
      WHERE user_id = $1 AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())`,
    [input.userId]
  );
  const strikeCount = Number(activeStrikes.rows[0]?.count ?? 0);
  const automaticType = strikeCount >= policy.temporary_ban_strikes
    ? 'temporary_ban'
    : strikeCount >= policy.posting_restriction_strikes
      ? 'posting_restriction'
      : null;
  if (!automaticType) return;
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM sanctions
      WHERE user_id = $1 AND type = $2 AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [input.userId, automaticType]
  );
  if (existing.rows[0]) return;
  const durationHours = automaticType === 'temporary_ban'
    ? policy.default_temporary_ban_hours
    : policy.default_restriction_hours;
  const reason = `Policy threshold reached: ${strikeCount} active strike(s).`;
  const result = await client.query<SanctionRow>(
    `INSERT INTO sanctions (user_id, case_id, type, reason, expires_at, metadata, created_by_user_id)
     VALUES ($1, $2, $3, $4, now() + ($5::text || ' hours')::interval, $6::jsonb, $7)
     RETURNING id, user_id, case_id, type, status, reason, metadata,
               starts_at, expires_at, revoked_at, created_at`,
    [input.userId, input.caseId, automaticType, reason, durationHours, JSON.stringify({ automatic: true, strikeCount }), input.actorUserId]
  );
  const sanction = result.rows[0];
  if (!sanction) throw new Error('Policy sanction insert did not return a row.');
  if (automaticType === 'temporary_ban') await client.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [input.userId]);
  await recordAdminAudit(client, {
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: 'moderation.policy_evaluated',
    targetType: 'user',
    targetId: input.userId,
    reason,
    metadata: { sanctionId: sanction.id, caseId: input.caseId, strikeCount, sanctionType: automaticType }
  });
}

async function finalizeIdempotency(client: PoolClient, actorUserId: string, key: string, fingerprint: string, response: unknown, statusCode = 201) {
  await client.query(
    `UPDATE moderation_idempotency_keys
        SET request_fingerprint = $3, status_code = $4, response = $5::jsonb
      WHERE actor_user_id = $1 AND idempotency_key = $2`,
    [actorUserId, key, fingerprint, statusCode, JSON.stringify(response)]
  );
}

export async function issueSanction(input: {
  userId: string;
  caseId: string;
  actorUserId: string;
  actorRole: UserRole;
  type: SanctionType;
  reason: string;
  expiresAt?: Date;
  idempotencyKey: string;
  fingerprint: string;
}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ request_fingerprint: string; status_code: number | null; response: unknown }>(
      `SELECT request_fingerprint, status_code, response
         FROM moderation_idempotency_keys
        WHERE actor_user_id = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [input.actorUserId, input.idempotencyKey]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_fingerprint !== input.fingerprint) throw new IdempotencyConflictError('Idempotency-Key was already used with a different request.');
      if (existing.rows[0].response) {
        await client.query('COMMIT');
        return { replayed: true as const, sanction: existing.rows[0].response as Sanction };
      }
    } else {
      await client.query(
        `INSERT INTO moderation_idempotency_keys (actor_user_id, idempotency_key, request_fingerprint, expires_at)
         VALUES ($1, $2, $3, now() + interval '24 hours')`,
        [input.actorUserId, input.idempotencyKey, input.fingerprint]
      );
    }

    const expiresAt = input.expiresAt;
    if (input.type === 'temporary_ban' && !expiresAt) throw new SanctionCaseConflictError('Temporary ban duration is required.');
    if (input.type === 'permanent_ban' && expiresAt) throw new SanctionCaseConflictError('Permanent ban cannot have an expiry.');
    const sanction = await insertSanction(client, input);
    if (input.type === 'strike') {
      await client.query(
        `INSERT INTO user_strikes (user_id, case_id, sanction_id, expires_at)
         VALUES ($1, $2, $3, now() + ($4::text || ' days')::interval)`,
        [input.userId, input.caseId, sanction.id, (await getPolicy(client)).strike_retention_days]
      );
      await evaluateStrikePolicy(client, input);
    }
    if (input.type === 'temporary_ban' || input.type === 'permanent_ban') {
      await client.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [input.userId]);
    }
    const response = { sanction };
    await finalizeIdempotency(client, input.actorUserId, input.idempotencyKey, input.fingerprint, response);
    await client.query('COMMIT');
    return { replayed: false as const, ...response };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeSanction(input: { sanctionId: string; actorUserId: string; actorRole: UserRole; reason: string; idempotencyKey: string; fingerprint: string }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ request_fingerprint: string; response: unknown }>(
      'SELECT request_fingerprint, response FROM moderation_idempotency_keys WHERE actor_user_id = $1 AND idempotency_key = $2 FOR UPDATE',
      [input.actorUserId, input.idempotencyKey]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_fingerprint !== input.fingerprint) throw new IdempotencyConflictError('Idempotency-Key was already used with a different request.');
      if (existing.rows[0].response) { await client.query('COMMIT'); return { replayed: true as const, ...existing.rows[0].response as { sanction: Sanction } }; }
    } else {
      await client.query(
        `INSERT INTO moderation_idempotency_keys (actor_user_id, idempotency_key, request_fingerprint, expires_at)
         VALUES ($1, $2, $3, now() + interval '24 hours')`,
        [input.actorUserId, input.idempotencyKey, input.fingerprint]
      );
    }
    const result = await client.query<SanctionRow>(
      `UPDATE sanctions SET status = 'revoked', revoked_at = now(), revoked_by_user_id = $1
        WHERE id = $2 AND status = 'active'
        RETURNING id, user_id, case_id, type, status, reason, metadata, starts_at, expires_at, revoked_at, created_at`,
      [input.actorUserId, input.sanctionId]
    );
    if (!result.rows[0]) throw new SanctionTargetNotFoundError('Active sanction was not found.');
    const sanction = mapSanction(result.rows[0]);
    await recordAdminAudit(client, {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'moderation.sanction_revoked',
      targetType: 'user',
      targetId: sanction.userId ?? input.actorUserId,
      reason: input.reason,
      metadata: { sanctionId: sanction.id }
    });
    if ((sanction.type === 'temporary_ban' || sanction.type === 'permanent_ban') && sanction.userId) await client.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [sanction.userId]);
    const response = { sanction };
    await finalizeIdempotency(client, input.actorUserId, input.idempotencyKey, input.fingerprint, response);
    await client.query('COMMIT');
    return { replayed: false as const, ...response };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
