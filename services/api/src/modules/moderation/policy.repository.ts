import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import type { UserRole } from '../auth/auth.repository.js';
import { recordAdminAudit } from '../admin/audit.repository.js';

export class PolicyIdempotencyConflictError extends Error {}

type PolicyRow = {
  posting_restriction_strikes: number;
  temporary_ban_strikes: number;
  strike_retention_days: number;
  default_restriction_hours: number;
  default_temporary_ban_hours: number;
  updated_by_user_id: string | null;
  updated_at: Date;
};

function mapPolicy(row: PolicyRow) {
  return {
    postingRestrictionStrikes: row.posting_restriction_strikes,
    temporaryBanStrikes: row.temporary_ban_strikes,
    strikeRetentionDays: row.strike_retention_days,
    defaultRestrictionHours: row.default_restriction_hours,
    defaultTemporaryBanHours: row.default_temporary_ban_hours,
    updatedByUserId: row.updated_by_user_id,
    updatedAt: row.updated_at.toISOString()
  };
}

const policyColumns = `posting_restriction_strikes, temporary_ban_strikes,
  strike_retention_days, default_restriction_hours, default_temporary_ban_hours,
  updated_by_user_id, updated_at`;

export async function getModerationPolicy() {
  const result = await db.query<PolicyRow>(`SELECT ${policyColumns} FROM moderation_policies WHERE id = TRUE`);
  if (!result.rows[0]) throw new Error('Moderation policy is not configured.');
  return mapPolicy(result.rows[0]);
}

export async function updateModerationPolicy(input: {
  actorUserId: string;
  actorRole: UserRole;
  reason: string;
  idempotencyKey: string;
  fingerprint: string;
  postingRestrictionStrikes: number;
  temporaryBanStrikes: number;
  strikeRetentionDays: number;
  defaultRestrictionHours: number;
  defaultTemporaryBanHours: number;
}) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query<{ request_fingerprint: string; response: { policy: ReturnType<typeof mapPolicy> } | null }>(
      'SELECT request_fingerprint, response FROM moderation_idempotency_keys WHERE actor_user_id = $1 AND idempotency_key = $2 FOR UPDATE',
      [input.actorUserId, input.idempotencyKey]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_fingerprint !== input.fingerprint) throw new PolicyIdempotencyConflictError('Idempotency-Key was already used with a different request.');
      if (existing.rows[0].response) {
        await client.query('COMMIT');
        return { ...existing.rows[0].response, replayed: true };
      }
    } else {
      await client.query(
        `INSERT INTO moderation_idempotency_keys (actor_user_id, idempotency_key, request_fingerprint, expires_at)
         VALUES ($1, $2, $3, now() + interval '24 hours')`,
        [input.actorUserId, input.idempotencyKey, input.fingerprint]
      );
    }

    const result = await client.query<PolicyRow>(
      `UPDATE moderation_policies
          SET posting_restriction_strikes = $1,
              temporary_ban_strikes = $2,
              strike_retention_days = $3,
              default_restriction_hours = $4,
              default_temporary_ban_hours = $5,
              updated_by_user_id = $6,
              updated_at = now()
        WHERE id = TRUE
        RETURNING ${policyColumns}`,
      [input.postingRestrictionStrikes, input.temporaryBanStrikes, input.strikeRetentionDays, input.defaultRestrictionHours, input.defaultTemporaryBanHours, input.actorUserId]
    );
    if (!result.rows[0]) throw new Error('Moderation policy is not configured.');
    const response = { policy: mapPolicy(result.rows[0]) };
    await recordAdminAudit(client, {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'moderation.policy_updated',
      targetType: 'case',
      targetId: input.actorUserId,
      reason: input.reason,
      metadata: response.policy
    });
    await client.query(
      'UPDATE moderation_idempotency_keys SET status_code = 200, response = $3::jsonb WHERE actor_user_id = $1 AND idempotency_key = $2',
      [input.actorUserId, input.idempotencyKey, JSON.stringify(response)]
    );
    await client.query('COMMIT');
    return { ...response, replayed: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
