import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { authenticate } from '../auth/auth.utils.js';
import { moderationPermissionsForRole, requirePermission } from '../auth/permissions.js';
import { AdminCursorError } from '../admin/pagination.js';
import { adminMutationRateLimit } from '../admin/admin.rate-limit.js';
import {
  AdminCommentNotFoundError,
  AdminPollNotFoundError,
  deleteAdminComment,
  deleteAdminPoll
} from '../admin/admin.service.js';
import { broadcastCommentDeleted, broadcastPollDeleted } from '../../realtime/realtime.hub.js';
import {
  ModerationCaseConflictError,
  ModerationCaseNotFoundError,
  reportCategories,
  reportTargetTypes,
  ModerationTargetNotFoundError
} from './moderation.repository.js';
import {
  IdempotencyConflictError,
  SanctionCaseConflictError,
  SanctionTargetNotFoundError
} from './sanctions.repository.js';
import {
  addModerationNote,
  assignModerationCase,
  createReport,
  getModerationCase,
  listModerationCases,
  takeoverModerationCase,
  transitionModerationCase,
  issueSanction,
  revokeSanction
} from './moderation.service.js';

const reportBodySchema = z.object({
  targetType: z.enum(reportTargetTypes),
  targetId: z.string().uuid(),
  category: z.enum(reportCategories),
  description: z.string().trim().min(1).max(2000)
}).strict();

const casesQuerySchema = z.object({
  status: z.enum(['open', 'triaged', 'in_review', 'resolved', 'dismissed', 'escalated', 'duplicate']).optional(),
  category: z.enum(reportCategories).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  assigneeId: z.string().uuid().optional(),
  targetType: z.enum(reportTargetTypes).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().max(512).optional()
}).strict();

const caseParamsSchema = z.object({ caseId: z.string().uuid() }).strict();
const noteBodySchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict();
const transitionBodySchema = z.object({
  resolutionCode: z.string().trim().min(1).max(100).optional(),
  note: z.string().trim().min(1).max(500).optional()
}).strict();
const contentParamsSchema = z.object({
  type: z.enum(['poll', 'comment']),
  id: z.string().uuid()
}).strict();
const removeContentBodySchema = z.object({
  caseId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500)
}).strict();
const userParamsSchema = z.object({ userId: z.string().uuid() }).strict();
const sanctionBodySchema = z.object({
  caseId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
  restrictionType: z.enum(['posting_restriction', 'comment_restriction']).optional(),
  durationHours: z.coerce.number().int().min(1).max(8760).optional()
}).strict();
const revokeParamsSchema = z.object({ sanctionId: z.string().uuid() }).strict();

function validationError(reply: FastifyReply) {
  return reply.status(400).send({
    error: 'validation_error',
    message: 'Request input is invalid.'
  });
}

function requestFingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function moderationError(reply: FastifyReply, error: unknown) {
  if (error instanceof ModerationCaseNotFoundError || error instanceof ModerationTargetNotFoundError || error instanceof AdminPollNotFoundError || error instanceof AdminCommentNotFoundError) {
    return reply.status(404).send({ error: 'not_found', message: error.message });
  }
  if (error instanceof ModerationCaseConflictError || error instanceof SanctionCaseConflictError || error instanceof IdempotencyConflictError) {
    return reply.status(409).send({ error: 'moderation_conflict', message: error.message });
  }
  if (error instanceof SanctionTargetNotFoundError) return reply.status(404).send({ error: 'not_found', message: error.message });
  throw error;
}

async function actorContext(request: Parameters<typeof authenticate>[0]) {
  const actor = await request.getCurrentUser();
  return { actorId: request.user.sub, actorRole: actor?.role ?? 'user' } as const;
}

export function registerModerationRoutes(app: FastifyInstance) {
  app.get(
    '/moderation/capabilities',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = await request.getCurrentUser();
      const permissions = user ? moderationPermissionsForRole(user.role) : [];
      if (permissions.length === 0) {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'You do not have permission to access moderation capabilities.'
        });
      }
      return reply.send({ permissions });
    }
  );

  const sanctionRoutes = [
    ['warning', 'moderation.warning.issue'],
    ['strike', 'moderation.strike.issue'],
    ['restriction', 'moderation.restriction.issue'],
    ['temporary-ban', 'moderation.user.ban']
  ] as const;
  for (const [action, permission] of sanctionRoutes) {
    app.post(
      `/moderation/users/:userId/${action}`,
      { preHandler: [authenticate, adminMutationRateLimit, requirePermission(permission)] },
      async (request, reply) => {
        const parsedParams = userParamsSchema.safeParse(request.params);
        const parsedBody = sanctionBodySchema.safeParse(request.body);
        const idempotencyKey = request.headers['idempotency-key'];
        if (!parsedParams.success || !parsedBody.success || typeof idempotencyKey !== 'string') return validationError(reply);
        const type = action === 'temporary-ban' ? 'temporary_ban' : action === 'restriction' ? parsedBody.data.restrictionType ?? 'posting_restriction' : action as 'warning' | 'strike';
        if ((type === 'posting_restriction' || type === 'temporary_ban') && !parsedBody.data.durationHours) return validationError(reply);
        try {
          const actor = await actorContext(request);
          const result = await issueSanction({
            userId: parsedParams.data.userId,
            caseId: parsedBody.data.caseId,
            actorUserId: actor.actorId,
            actorRole: actor.actorRole,
            type,
            reason: parsedBody.data.reason,
            expiresAt: parsedBody.data.durationHours ? new Date(Date.now() + parsedBody.data.durationHours * 60 * 60 * 1000) : undefined,
            idempotencyKey,
            fingerprint: requestFingerprint({ action, params: parsedParams.data, body: parsedBody.data })
          });
          return reply.status(result.replayed ? 200 : 201).send(result);
        } catch (error) {
          return moderationError(reply, error);
        }
      }
    );
  }

  app.post(
    '/moderation/sanctions/:sanctionId/revoke',
    { preHandler: [authenticate, adminMutationRateLimit, requirePermission('moderation.sanction.revoke')] },
    async (request, reply) => {
      const parsedParams = revokeParamsSchema.safeParse(request.params);
      const parsedBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict().safeParse(request.body);
      const idempotencyKey = request.headers['idempotency-key'];
      if (!parsedParams.success || !parsedBody.success || typeof idempotencyKey !== 'string') return validationError(reply);
      try {
        const actor = await actorContext(request);
        const result = await revokeSanction({
          sanctionId: parsedParams.data.sanctionId,
          actorUserId: actor.actorId,
          actorRole: actor.actorRole,
          reason: parsedBody.data.reason,
          idempotencyKey,
          fingerprint: requestFingerprint({ params: parsedParams.data, body: parsedBody.data })
        });
        return reply.status(result.replayed ? 200 : 200).send(result);
      } catch (error) {
        return moderationError(reply, error);
      }
    }
  );

  app.post(
    '/moderation/content/:type/:id/remove',
    { preHandler: [authenticate, requirePermission('moderation.content.delete')] },
    async (request, reply) => {
      const parsedParams = contentParamsSchema.safeParse(request.params);
      const parsedBody = removeContentBodySchema.safeParse(request.body);
      if (!parsedParams.success || !parsedBody.success) return validationError(reply);

      try {
        const moderationCase = await getModerationCase(parsedBody.data.caseId);
        if (moderationCase.case.targetType !== parsedParams.data.type || moderationCase.case.targetId !== parsedParams.data.id) {
          return reply.status(409).send({ error: 'moderation_conflict', message: 'Case target does not match content target.' });
        }
        const actor = await actorContext(request);
        if (parsedParams.data.type === 'poll') {
          const status = await deleteAdminPoll({
            pollId: parsedParams.data.id,
            actorUserId: actor.actorId,
            actorRole: actor.actorRole,
            reason: parsedBody.data.reason,
            requestId: request.id
          });
          if (status === 'deleted') broadcastPollDeleted({ pollId: parsedParams.data.id });
          if (status === 'deleted') await transitionModerationCase(parsedBody.data.caseId, actor.actorId, actor.actorRole, 'resolve', { resolutionCode: 'content_removed', note: parsedBody.data.reason });
          return reply.status(204).send();
        }

        const result = await deleteAdminComment({
          commentId: parsedParams.data.id,
          actorUserId: actor.actorId,
          actorRole: actor.actorRole,
          reason: parsedBody.data.reason,
          requestId: request.id
        });
        if (result.status === 'deleted') {
          broadcastCommentDeleted({ commentId: parsedParams.data.id, pollId: result.pollId });
          await transitionModerationCase(parsedBody.data.caseId, actor.actorId, actor.actorRole, 'resolve', { resolutionCode: 'content_removed', note: parsedBody.data.reason });
        }
        return reply.status(204).send();
      } catch (error) {
        return moderationError(reply, error);
      }
    }
  );

  app.get(
    '/moderation/cases/:caseId',
    { preHandler: [authenticate, requirePermission('moderation.case.read')] },
    async (request, reply) => {
      const parsedParams = caseParamsSchema.safeParse(request.params);
      if (!parsedParams.success) return validationError(reply);
      try {
        return reply.send(await getModerationCase(parsedParams.data.caseId));
      } catch (error) {
        return moderationError(reply, error);
      }
    }
  );

  app.post(
    '/moderation/cases/:caseId/assign',
    { preHandler: [authenticate, requirePermission('moderation.case.assign')] },
    async (request, reply) => {
      const parsedParams = caseParamsSchema.safeParse(request.params);
      if (!parsedParams.success) return validationError(reply);
      try {
        const actor = await actorContext(request);
        return reply.send(await assignModerationCase(parsedParams.data.caseId, actor.actorId, actor.actorRole));
      } catch (error) {
        return moderationError(reply, error);
      }
    }
  );

  app.post(
    '/moderation/cases/:caseId/takeover',
    { preHandler: [authenticate, requirePermission('moderation.case.assign')] },
    async (request, reply) => {
      const parsedParams = caseParamsSchema.safeParse(request.params);
      if (!parsedParams.success) return validationError(reply);
      try {
        const actor = await actorContext(request);
        return reply.send(await takeoverModerationCase(parsedParams.data.caseId, actor.actorId, actor.actorRole));
      } catch (error) {
        return moderationError(reply, error);
      }
    }
  );

  app.post(
    '/moderation/cases/:caseId/notes',
    { preHandler: [authenticate, requirePermission('moderation.case.resolve')] },
    async (request, reply) => {
      const parsedParams = caseParamsSchema.safeParse(request.params);
      const parsedBody = noteBodySchema.safeParse(request.body);
      if (!parsedParams.success || !parsedBody.success) return validationError(reply);
      try {
        const actor = await actorContext(request);
        return reply.status(201).send({ note: await addModerationNote(parsedParams.data.caseId, actor.actorId, actor.actorRole, parsedBody.data.body) });
      } catch (error) {
        return moderationError(reply, error);
      }
    }
  );

  for (const transition of ['resolve', 'dismiss', 'escalate'] as const) {
    app.post(
      `/moderation/cases/:caseId/${transition}`,
      { preHandler: [authenticate, requirePermission('moderation.case.resolve')] },
      async (request, reply) => {
        const parsedParams = caseParamsSchema.safeParse(request.params);
        const parsedBody = transitionBodySchema.safeParse(request.body);
        if (!parsedParams.success || !parsedBody.success) return validationError(reply);
        try {
          const actor = await actorContext(request);
          return reply.send(await transitionModerationCase(parsedParams.data.caseId, actor.actorId, actor.actorRole, transition, parsedBody.data));
        } catch (error) {
          return moderationError(reply, error);
        }
      }
    );
  }

  app.post(
    '/reports',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsedBody = reportBodySchema.safeParse(request.body);
      if (!parsedBody.success) return validationError(reply);

      try {
        const result = await createReport({
          reporterUserId: request.user.sub,
          ...parsedBody.data
        });
        return reply.status(result.deduplicated ? 200 : 201).send(result);
      } catch (error) {
        if (error instanceof ModerationTargetNotFoundError) {
          return reply.status(404).send({ error: 'not_found', message: error.message });
        }
        throw error;
      }
    }
  );

  app.get(
    '/moderation/cases',
    { preHandler: [authenticate, requirePermission('moderation.queue.read')] },
    async (request, reply) => {
      const parsedQuery = casesQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) return validationError(reply);

      try {
        return reply.send(await listModerationCases(parsedQuery.data));
      } catch (error) {
        if (error instanceof AdminCursorError) return validationError(reply);
        throw error;
      }
    }
  );
}
