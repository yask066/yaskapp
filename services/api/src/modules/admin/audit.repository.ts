import type { Pool, PoolClient } from 'pg';

import { db } from '../../config/database.js';
import type { UserRole } from '../auth/auth.repository.js';

export type AdminAuditAction =
  | 'user.blocked'
  | 'user.unblocked'
  | 'user.role_changed'
  | 'user.deleted'
  | 'poll.deleted_by_admin'
  | 'comment.deleted_by_admin';

export type AdminAuditTargetType = 'user' | 'poll' | 'comment';

export type AdminAuditRecordInput = {
  actorUserId: string;
  actorRole: UserRole;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  reason: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
};

type QueryExecutor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export async function recordAdminAudit(
  executor: QueryExecutor,
  input: AdminAuditRecordInput
) {
  await executor.query(
    `
      INSERT INTO admin_audit_log (
        actor_user_id,
        actor_role,
        action,
        target_type,
        target_id,
        reason,
        metadata,
        request_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `,
    [
      input.actorUserId,
      input.actorRole,
      input.action,
      input.targetType,
      input.targetId,
      input.reason,
      JSON.stringify(input.metadata ?? {}),
      input.requestId ?? null
    ]
  );
}

export async function listAdminAudit(input: {
  action?: AdminAuditAction;
  actorId?: string;
  targetType?: AdminAuditTargetType;
  targetId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}) {
  const values: unknown[] = [];
  const conditions = ['TRUE'];

  function addCondition(sql: string, value: unknown) {
    values.push(value);
    conditions.push(sql.replace('?', `$${values.length}`));
  }

  if (input.action) addCondition('action = ?', input.action);
  if (input.actorId) addCondition('actor_user_id = ?', input.actorId);
  if (input.targetType) addCondition('target_type = ?', input.targetType);
  if (input.targetId) addCondition('target_id = ?', input.targetId);
  if (input.from) addCondition('created_at >= ?::timestamptz', input.from);
  if (input.to) addCondition('created_at < ?::timestamptz', input.to);

  values.push(input.limit, input.offset);
  const result = await db.query<{
    id: string;
    actor_user_id: string | null;
    actor_role: UserRole;
    action: AdminAuditAction;
    target_type: AdminAuditTargetType;
    target_id: string;
    reason: string;
    metadata: Record<string, unknown>;
    request_id: string | null;
    created_at: Date;
  }>(
    `
      SELECT
        id,
        actor_user_id,
        actor_role,
        action,
        target_type,
        target_id,
        reason,
        metadata,
        request_id,
        created_at
      FROM admin_audit_log
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values
  );

  return result.rows.map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    metadata: row.metadata,
    requestId: row.request_id,
    createdAt: row.created_at.toISOString()
  }));
}
