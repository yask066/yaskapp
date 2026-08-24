import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import type { UserRole, UserStatus } from '../auth/auth.repository.js';
import { recordAdminAudit } from './audit.repository.js';

export type AdminUser = {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  deletedAt: string | null;
  profile: {
    displayName: string;
    bio: string | null;
    countryCode: string | null;
    pollsCount: number;
    followersCount: number;
    followingCount: number;
  };
};

type AdminUserRow = {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date | null;
  deleted_at: Date | null;
  display_name: string;
  bio: string | null;
  country_code: string | null;
  polls_count: number;
  followers_count: number;
  following_count: number;
};

function mapAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    profile: {
      displayName: row.display_name,
      bio: row.bio,
      countryCode: row.country_code,
      pollsCount: row.polls_count,
      followersCount: row.followers_count,
      followingCount: row.following_count
    }
  };
}

const adminUserSelect = `
  SELECT
    u.id,
    u.email::text AS email,
    u.username::text AS username,
    u.role,
    u.status,
    u.created_at,
    u.updated_at,
    u.last_seen_at,
    u.deleted_at,
    p.display_name,
    p.bio,
    p.country_code,
    p.polls_count,
    p.followers_count,
    p.following_count
  FROM users u
  JOIN profiles p ON p.user_id = u.id
`;

export async function listAdminUsers(input: {
  limit: number;
  offset: number;
  query?: string;
  status?: UserStatus | 'all';
  role?: UserRole | 'all';
}) {
  const values: unknown[] = [];
  const conditions = ['TRUE'];

  if (input.query) {
    values.push(`%${input.query}%`);
    conditions.push(`(u.email::text ILIKE $${values.length} OR u.username::text ILIKE $${values.length} OR p.display_name ILIKE $${values.length})`);
  }
  if (input.status && input.status !== 'all') {
    values.push(input.status);
    conditions.push(`u.status = $${values.length}`);
  }
  if (input.role && input.role !== 'all') {
    values.push(input.role);
    conditions.push(`u.role = $${values.length}`);
  }

  values.push(input.limit, input.offset);
  const result = await db.query<AdminUserRow>(
    `${adminUserSelect}
      WHERE ${conditions.join(' AND ')}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}`,
    values
  );

  return result.rows.map(mapAdminUser);
}

export async function getAdminUser(userId: string) {
  const result = await db.query<AdminUserRow>(
    `${adminUserSelect} WHERE u.id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0] ? mapAdminUser(result.rows[0]) : null;
}

type AuditInput = {
  actorUserId: string;
  actorRole: UserRole;
  reason: string;
  requestId?: string;
};

type UserMutationResult =
  | { status: 'updated' }
  | { status: 'already_active' | 'already_deleted' | 'unchanged' }
  | { status: 'not_found' | 'self' | 'protected' | 'last_superadmin' };

async function lockedUsers(client: PoolClient, actorId: string, targetId: string) {
  const actorResult = await client.query<{ role: UserRole }>(
    'SELECT role FROM users WHERE id = $1 FOR UPDATE', [actorId]
  );
  const targetResult = await client.query<{ role: UserRole; status: UserStatus; deleted_at: Date | null }>(
    'SELECT role, status, deleted_at FROM users WHERE id = $1 FOR UPDATE', [targetId]
  );
  return { actor: actorResult.rows[0], target: targetResult.rows[0] };
}

async function activeSuperadminCount(client: PoolClient) {
  const result = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM users WHERE role = 'superadmin' AND status <> 'deleted' AND deleted_at IS NULL"
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function unblockUser(actorId: string, targetId: string, audit: AuditInput): Promise<UserMutationResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { actor, target } = await lockedUsers(client, actorId, targetId);
    if (!actor || !target) return await rollback(client, 'not_found');
    if (actorId === targetId) return await rollback(client, 'self');
    if (target.deleted_at || target.status === 'deleted' || target.role === 'superadmin' || (actor.role === 'moderator' && target.role !== 'user')) {
      return await rollback(client, 'protected');
    }
    if (target.status === 'active') return await commit(client, 'already_active');

    await client.query("UPDATE users SET status = 'active', updated_at = now() WHERE id = $1", [targetId]);
    await recordAdminAudit(client, { ...audit, action: 'user.unblocked', targetType: 'user', targetId });
    await client.query('COMMIT');
    return { status: 'updated' };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function deleteAdminUser(actorId: string, targetId: string, audit: AuditInput): Promise<UserMutationResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { actor, target } = await lockedUsers(client, actorId, targetId);
    if (!actor || !target) return await rollback(client, 'not_found');
    if (actorId === targetId) return await rollback(client, 'self');
    if (target.role === 'superadmin' && await activeSuperadminCount(client) <= 1) return await rollback(client, 'last_superadmin');
    if (target.status === 'deleted' || target.deleted_at) return await commit(client, 'already_deleted');

    await client.query("UPDATE users SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1", [targetId]);
    await recordAdminAudit(client, { ...audit, action: 'user.deleted', targetType: 'user', targetId });
    await client.query('COMMIT');
    return { status: 'updated' };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function changeUserRole(actorId: string, targetId: string, role: UserRole, audit: AuditInput): Promise<UserMutationResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { actor, target } = await lockedUsers(client, actorId, targetId);
    if (!actor || !target) return await rollback(client, 'not_found');
    if (actorId === targetId) return await rollback(client, 'self');
    if (target.status === 'deleted' || target.deleted_at) return await rollback(client, 'protected');
    if (target.role === role) return await commit(client, 'unchanged');
    if (target.role === 'superadmin' && role !== 'superadmin' && await activeSuperadminCount(client) <= 1) return await rollback(client, 'last_superadmin');

    await client.query('UPDATE users SET role = $1, updated_at = now() WHERE id = $2', [role, targetId]);
    await recordAdminAudit(client, { ...audit, action: 'user.role_changed', targetType: 'user', targetId, metadata: { fromRole: target.role, toRole: role } });
    await client.query('COMMIT');
    return { status: 'updated' };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

async function rollback(client: PoolClient, status: Extract<UserMutationResult, { status: 'not_found' | 'self' | 'protected' | 'last_superadmin' }>["status"]): Promise<UserMutationResult> {
  await client.query('ROLLBACK');
  return { status };
}

async function commit(client: PoolClient, status: Extract<UserMutationResult, { status: 'already_active' | 'already_deleted' | 'unchanged' }>["status"]): Promise<UserMutationResult> {
  await client.query('COMMIT');
  return { status };
}
