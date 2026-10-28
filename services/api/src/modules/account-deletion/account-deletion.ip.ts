import { isIP } from 'node:net';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { db } from '../../config/database.js';

export async function recordAccountIp(userId: string, ip: string, executor: Pick<Pool | PoolClient, 'query'> = db) {
  if (!isIP(ip)) throw new Error('invalid_account_ip');
  await executor.query(
    `WITH account AS (
       SELECT id FROM users WHERE id = $1 AND status <> 'deleted' AND deleted_at IS NULL FOR UPDATE
     )
     INSERT INTO account_ip_history (user_id, ip)
     SELECT id, normalize_account_ip($2::inet) FROM account
     ON CONFLICT (user_id, ip) DO UPDATE SET
       first_seen_at = CASE WHEN account_ip_history.last_seen_at <= now() - interval '30 days'
         THEN now() ELSE account_ip_history.first_seen_at END, last_seen_at = now()`, [userId, ip]
  );
}

export async function enforcePlatformIpBan(request: FastifyRequest, reply: FastifyReply) {
  const path = request.url.split('?', 1)[0];
  // Account deletion remains available even to banned addresses.
  if (path === '/health' || path?.startsWith('/health/')
    || (request.method === 'DELETE' && path === '/auth/me')
    || (request.method === 'POST' && path === '/auth/account-deletion/verification')
    || (request.method === 'GET' && path === '/auth/account-deletion/status')) return;
  const result = await db.query(
    'SELECT id FROM platform_ip_bans WHERE ip = normalize_account_ip($1::inet) AND revoked_at IS NULL', [request.ip]);
  if (result.rowCount) {
    return reply.status(403).send({ error: 'ip_blocked', message: 'Access from this network address is blocked.' });
  }
}

export class ArchiveIpBanError extends Error {
  constructor(readonly code: 'not_found' | 'ip_not_in_archive' | 'own_ip') { super(code); }
}

export async function banArchivedIp(input: { userId: string; ip: string; actorId: string; actorIp: string; reason: string }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const archive = await client.query<{ ips: Array<{ ip: string }> }>(
      'SELECT ips FROM deleted_account_archives WHERE user_id=$1 AND expires_at > now() FOR SHARE', [input.userId]);
    if (!archive.rows[0]) throw new ArchiveIpBanError('not_found');
    const matches = await client.query<{ own: boolean; belongs: boolean }>(
      `SELECT normalize_account_ip($1::inet) = normalize_account_ip($2::inet) AS own,
        EXISTS (SELECT 1 FROM unnest($3::text[]) AS address(ip) WHERE normalize_account_ip(address.ip::inet) = normalize_account_ip($1::inet)) AS belongs`,
      [input.ip, input.actorIp, archive.rows[0].ips.map((item) => item.ip)]);
    if (!matches.rows[0]?.belongs) throw new ArchiveIpBanError('ip_not_in_archive');
    if (matches.rows[0]?.own) throw new ArchiveIpBanError('own_ip');
    const result = await client.query(
      `INSERT INTO platform_ip_bans (ip, reason, created_by_user_id) VALUES (normalize_account_ip($1::inet), $2, $3)
       ON CONFLICT (ip) WHERE revoked_at IS NULL DO UPDATE SET ip = EXCLUDED.ip
       RETURNING id, host(ip) AS ip, reason, created_at AS "createdAt", revoked_at AS "revokedAt"`, [input.ip, input.reason, input.actorId]);
    await client.query(`INSERT INTO platform_ip_ban_events (ban_id, actor_user_id, action, reason) VALUES ($1, $2, 'created', $3)`, [result.rows[0].id, input.actorId, input.reason]);
    await client.query(`INSERT INTO deleted_account_archive_access (archived_user_id, actor_user_id, action) VALUES ($1, $2, 'ip_ban')`, [input.userId, input.actorId]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

export async function listPlatformIpBans(limit: number, cursor?: string) {
  const result = await db.query(
    `SELECT id, host(ip) AS ip, reason, created_at AS "createdAt", revoked_at AS "revokedAt"
     FROM platform_ip_bans WHERE revoked_at IS NULL AND ($2::uuid IS NULL OR id > $2::uuid)
     ORDER BY id LIMIT $1`, [limit + 1, cursor ?? null]);
  return { items: result.rows.slice(0, limit), nextCursor: result.rows.length > limit ? result.rows[limit - 1].id : null };
}

export async function revokePlatformIpBan(banId: string, actorId: string, reason: string) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('UPDATE platform_ip_bans SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id', [banId]);
    if (result.rowCount) await client.query(`INSERT INTO platform_ip_ban_events (ban_id, actor_user_id, action, reason) VALUES ($1, $2, 'revoked', $3)`, [banId, actorId, reason]);
    const exists = await client.query('SELECT id FROM platform_ip_bans WHERE id=$1', [banId]);
    await client.query('COMMIT');
    return Boolean(exists.rowCount);
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
