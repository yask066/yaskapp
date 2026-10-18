import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/auth.utils.js';
import { requirePermission } from '../auth/permissions.js';
import { adminMutationRateLimit } from './admin.rate-limit.js';
import { AdminCursorError } from './pagination.js';
import { listDeletedAccountArchives, readDeletedAccountArchive } from '../account-deletion/account-deletion.archive.js';
import { ArchiveIpBanError, banArchivedIp, listPlatformIpBans, revokePlatformIpBan } from '../account-deletion/account-deletion.ip.js';

const userParams = z.object({ userId: z.string().uuid() }).strict();
const banParams = z.object({ banId: z.string().uuid() }).strict();
const reasonBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const banBody = reasonBody.extend({ ip: z.string().ip() }).strict();
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30),
  query: z.string().trim().max(320).optional(), cursor: z.string().max(512).optional() }).strict();
const banListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().uuid().optional() }).strict();

function invalid(reply: FastifyReply) {
  return reply.status(400).send({ error: 'validation_error', message: 'Request input is invalid.' });
}

export function registerDeletedAccountArchiveRoutes(app: FastifyInstance) {
  const archiveAccess = [authenticate, requirePermission('admin.deleted_accounts.read')];
  const banAccess = [authenticate, requirePermission('admin.ip_bans.manage'), adminMutationRateLimit];
  // Includes denied/error responses: browsers and intermediaries must never cache archives/IPs.
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/admin/deleted-accounts') || request.url.startsWith('/admin/ip-bans')) {
      reply.header('cache-control', 'no-store');
    }
  });
  app.get('/admin/deleted-accounts', { preHandler: archiveAccess }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return invalid(reply);
    try { return await listDeletedAccountArchives(parsed.data); }
    catch (error) { if (error instanceof AdminCursorError) return invalid(reply); throw error; }
  });
  app.get('/admin/deleted-accounts/:userId', { preHandler: archiveAccess }, async (request, reply) => {
    const parsed = userParams.safeParse(request.params);
    if (!parsed.success) return invalid(reply);
    const account = await readDeletedAccountArchive(parsed.data.userId, request.user.sub);
    if (!account) return reply.status(404).send({ error: 'not_found', message: 'The archive is unavailable or expired.' });
    return { account };
  });
  app.post('/admin/deleted-accounts/:userId/ip-bans', { preHandler: banAccess }, async (request, reply) => {
    const params = userParams.safeParse(request.params);
    const body = banBody.safeParse(request.body);
    if (!params.success || !body.success) return invalid(reply);
    try {
      const ban = await banArchivedIp({ userId: params.data.userId, ...body.data, actorId: request.user.sub, actorIp: request.ip });
      return reply.status(201).send({ ban });
    } catch (error) {
      if (!(error instanceof ArchiveIpBanError)) throw error;
      return reply.status(error.code === 'not_found' ? 404 : 409).send({ error: error.code,
        message: error.code === 'own_ip' ? 'You cannot block your current network address.'
          : error.code === 'not_found' ? 'The archive is unavailable or expired.' : 'This address is not in the archive.' });
    }
  });
  app.get('/admin/ip-bans', { preHandler: [authenticate, requirePermission('admin.ip_bans.manage')] }, async (request, reply) => {
    const query = banListQuery.safeParse(request.query);
    if (!query.success) return invalid(reply);
    return listPlatformIpBans(query.data.limit, query.data.cursor);
  });
  app.post('/admin/ip-bans/:banId/revoke', { preHandler: banAccess }, async (request, reply) => {
    const params = banParams.safeParse(request.params);
    const body = reasonBody.safeParse(request.body);
    if (!params.success || !body.success) return invalid(reply);
    if (!await revokePlatformIpBan(params.data.banId, request.user.sub, body.data.reason)) {
      return reply.status(404).send({ error: 'not_found', message: 'IP ban was not found.' });
    }
    return { status: 'revoked' };
  });
}
