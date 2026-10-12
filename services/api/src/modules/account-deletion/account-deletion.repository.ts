import type { AccountDeletionStatus, AccountDeletionStatusResponse } from '@yaskapp/shared';
import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';

type Executor = Pick<PoolClient, 'query'>;
type OperationRow = {
  id: string;
  status: AccountDeletionStatus;
  accepted_at: Date | null;
  deadline_at: Date | null;
  completed_at: Date | null;
};

const publicColumns = 'id, status, accepted_at, deadline_at, completed_at';

function mapOperation(row: OperationRow): AccountDeletionStatusResponse {
  return {
    operationId: row.id,
    status: row.status,
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    deadlineAt: row.deadline_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null
  };
}

export async function getDeletionOperation(
  operationId: string,
  executor: Executor = db
): Promise<AccountDeletionStatusResponse | null> {
  const result = await executor.query<OperationRow>(
    `SELECT ${publicColumns} FROM account_deletion_operations WHERE id = $1`,
    [operationId]
  );
  return result.rows[0] ? mapOperation(result.rows[0]) : null;
}

export type PrepareDeletionOperationInput = {
  userId: string;
  deletionTokenHash: string;
  statusTokenHash: string;
  deletionTokenExpiresAt: Date;
  statusTokenExpiresAt: Date;
};

// The caller owns BEGIN/COMMIT/ROLLBACK. Share this user lock with acceptance (AD-04).
// Credentials must already have been verified, and raw tokens hashed, by AD-03.
export async function prepareDeletionOperation(
  input: PrepareDeletionOperationInput,
  client: PoolClient
): Promise<AccountDeletionStatusResponse> {
  const user = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [input.userId]);
  if (!user.rows[0]) {
    throw new Error('account_deletion_user_not_found');
  }
  const existing = await client.query<OperationRow>(
    `SELECT ${publicColumns} FROM account_deletion_operations
     WHERE user_id = $1 AND status <> 'not_started' ORDER BY created_at DESC LIMIT 1`,
    [input.userId]
  );
  if (existing.rows[0]) {
    return mapOperation(existing.rows[0]);
  }

  // Cascading only from the operation removes all superseded, unused permissions.
  await client.query("DELETE FROM account_deletion_operations WHERE user_id = $1 AND status = 'not_started'", [input.userId]);
  const result = await client.query<OperationRow>(
    `INSERT INTO account_deletion_operations (user_id) VALUES ($1) RETURNING ${publicColumns}`,
    [input.userId]
  );
  const operation = result.rows[0];
  await client.query(
    `INSERT INTO account_deletion_permissions (operation_id, scope, token_hash, expires_at)
     VALUES ($1, 'delete', $2, $3), ($1, 'status', $4, $5)`,
    [operation.id, input.deletionTokenHash, input.deletionTokenExpiresAt, input.statusTokenHash, input.statusTokenExpiresAt]
  );
  return mapOperation(operation);
}

export type DeletionPermission = {
  operationId: string;
  userId: string;
  scope: 'delete' | 'status';
  expiresAt: Date;
  consumedAt: Date | null;
};

export async function getDeletionPermission(
  tokenHash: string,
  scope: DeletionPermission['scope'],
  executor: Executor = db,
  lock = false
): Promise<DeletionPermission | null> {
  const result = await executor.query<{
    operation_id: string;
    user_id: string;
    scope: DeletionPermission['scope'];
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `SELECT permission.operation_id, operation.user_id, permission.scope,
            permission.expires_at, permission.consumed_at
     FROM account_deletion_permissions permission
     JOIN account_deletion_operations operation ON operation.id = permission.operation_id
     WHERE permission.token_hash = $1 AND permission.scope = $2
       AND permission.revoked_at IS NULL AND permission.expires_at > now()
     ${lock ? 'FOR UPDATE OF permission' : ''}`,
    [tokenHash, scope]
  );
  const row = result.rows[0];
  return row ? {
    operationId: row.operation_id,
    userId: row.user_id,
    scope: row.scope,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at
  } : null;
}

export async function consumeDeletionPermission(tokenHash: string, client: PoolClient) {
  const result = await client.query(
    `UPDATE account_deletion_permissions SET consumed_at = COALESCE(consumed_at, now())
     WHERE token_hash = $1 AND scope = 'delete' AND revoked_at IS NULL AND expires_at > now()
     RETURNING id`,
    [tokenHash]
  );
  return result.rowCount === 1;
}

// Persistence only. AD-04 must validate/consume the permission, close the account,
// and insert cleanup steps/outbox events within the same transaction before commit.
export async function acceptDeletionOperation(
  input: { operationId: string; userId: string; acceptedAt: Date; deadlineAt: Date },
  client: PoolClient
): Promise<AccountDeletionStatusResponse | null> {
  const updated = await client.query<OperationRow>(
    `UPDATE account_deletion_operations
     SET status = 'pending', accepted_at = $3, deadline_at = $4, available_at = $3, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status = 'not_started'
     RETURNING ${publicColumns}`,
    [input.operationId, input.userId, input.acceptedAt, input.deadlineAt]
  );
  if (updated.rows[0]) {
    return mapOperation(updated.rows[0]);
  }
  // Replay uses the durable operation/owner pair; it never needs a users row.
  const existing = await client.query<OperationRow>(
    `SELECT ${publicColumns} FROM account_deletion_operations WHERE id = $1 AND user_id = $2`,
    [input.operationId, input.userId]
  );
  return existing.rows[0] ? mapOperation(existing.rows[0]) : null;
}
