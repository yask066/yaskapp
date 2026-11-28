import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { authenticate, authenticateForAppeal } from '../auth/auth.utils.js';
import { moderationPermissionsForRole, requirePermission } from '../auth/permissions.js';
import { AdminCursorError } from '../admin/pagination.js';
import { adminMutationRateLimit } from '../admin/admin.rate-limit.js';
import { rateLimit } from '../../config/rate-limit.js';
import {
  AdminCommentNotFoundError,
  AdminPollNotFoundError
} from '../admin/admin.service.js';
import {
  broadcastCommentDeleted,
  broadcastPollDeleted,
  broadcastModerationAppealCreated,
  broadcastModerationAppealResolved,
  broadcastModerationSanctionCreated,
  broadcastModerationSanctionRevoked,
  disconnectUser
} from '../../realtime/realtime.hub.js';
import { realtimeBus } from '../../realtime/realtime.bus.js';
import {
  ModerationCaseConflictError,
  ModerationCaseNotFoundError,
  removeModeratedContentAtomically,
  reportCategories,
  reportTargetTypes,
  ModerationTargetNotFoundError
} from './moderation.repository.js';
import {
  IdempotencyConflictError,
  SanctionCaseConflictError,
  SanctionPermissionError,
  SanctionTargetNotFoundError
} from './sanctions.repository.js';
import { AppealConflictError, AppealNotFoundError, AppealPermissionError } from './appeals.repository.js';
import {
  addModerationNote,
  assignModerationCase,
  createReport,
  getModerationCase,
  listModerationCases,
  listUserReports,
  takeoverModerationCase,
  transitionModerationCase,
  issueSanction,
  revokeSanction
} from './moderation.service.js';
import { createAppeal, listAppeals, resolveAppeal } from './appeals.service.js';
import { getModerationPolicy, updateModerationPolicy } from './policy.service.js';
import { PolicyIdempotencyConflictError } from './policy.repository.js';

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
  unassigned: z.coerce.boolean().optional(),
  targetType: z.enum(reportTargetTypes).optional(),
  search: z.string().trim().min(1).max(200).optional(),
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
const appealBodySchema = z.object({ sanctionId: z.string().uuid(), reason: z.string().trim().min(1).max(4000) }).strict();
const appealsQuerySchema = z.object({ status: z.enum(['open', 'upheld', 'reduced', 'revoked', 'request_more_info']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().trim().max(512).optional() }).strict();
const reportsQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().trim().max(512).optional() }).strict();
const appealParamsSchema = z.object({ appealId: z.string().uuid() }).strict();
const appealDecisionSchema = z.object({ status: z.enum(['upheld', 'reduced', 'revoked', 'request_more_info']), decisionNote: z.string().trim().min(1).max(4000) }).strict();
const policyBodySchema = z.object({
  postingRestrictionStrikes: z.coerce.number().int().min(1).max(100),
  temporaryBanStrikes: z.coerce.number().int().min(1).max(100),
  strikeRetentionDays: z.coerce.number().int().min(1).max(3650),
  defaultRestrictionHours: z.coerce.number().int().min(1).max(8760),
  defaultTemporaryBanHours: z.coerce.number().int().min(1).max(8760),
  reason: z.string().trim().min(1).max(500)
}).strict().superRefine((value, context) => {
  if (value.temporaryBanStrikes < value.postingRestrictionStrikes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['temporaryBanStrikes'], message: 'temporaryBanStrikes must be at least postingRestrictionStrikes.' });
  }
});

const idempotencyKeySchema = z.string().trim().min(8).max(200);
const reportRateLimit = rateLimit({
  keyPrefix: 'reports-create',
  limit: 20,
  windowMs: 15 * 60_000,
  keyBy: 'user'
});
const appealRateLimit = rateLimit({
  keyPrefix: 'appeals-create',
  limit: 10,
  windowMs: 15 * 60_000,
  keyBy: 'user'
});

function parseIdempotencyKey(header: unknown): string | null {
  const parsed = idempotencyKeySchema.safeParse(header);
  return parsed.success ? parsed.data : null;
}

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
  if (error instanceof SanctionPermissionError || error instanceof AppealPermissionError) {
    return reply.status(403).send({ error: 'forbidden', message: error.message });
  }
  if (error instanceof ModerationCaseNotFoundError || error instanceof ModerationTargetNotFoundError || error instanceof AdminPollNotFoundError || error instanceof AdminCommentNotFoundError) {
    return reply.status(404).send({ error: 'not_found', message: error.message });
  }
  if (error instanceof ModerationCaseConflictError || error instanceof SanctionCaseConflictError || error instanceof IdempotencyConflictError) {
    return reply.status(409).send({ error: 'moderation_conflict', message: error.message });
  }
  if (error instanceof SanctionTargetNotFoundError || error instanceof AppealNotFoundError) return reply.status(404).send({ error: 'not_found', message: error.message });
  if (error instanceof AppealConflictError || error instanceof PolicyIdempotencyConflictError) return reply.status(409).send({ error: 'moderation_conflict', message: error.message });
  throw error;
}

async function actorContext(request: Parameters<typeof authenticate>[0]) {
  const actor = await request.getCurrentUser();
  return { actorId: request.user.sub, actorRole: actor?.role ?? 'user' } as const;
}

export function registerModerationRoutes(app: FastifyInstance) {
  app.get('/moderation/policy', { preHandler: [authenticate, requirePermission('moderation.policy.read')] }, async (_request, reply) => {
    return reply.send({ policy: await getModerationPolicy() });
  });

  app.patch('/moderation/policy', { preHandler: [authenticate, adminMutationRateLimit, requirePermission('moderation.policy.update')] }, async (request, reply) => {
    const parsedBody = policyBodySchema.safeParse(request.body);
    const idempotencyKey = parseIdempotencyKey(request.headers['idempotency-key']);
    if (!parsedBody.success || !idempotencyKey) return validationError(reply);
    try {
      const actor = await actorContext(request);
      const result = await updateModerationPolicy({
        ...parsedBody.data,
        actorUserId: actor.actorId,
        actorRole: actor.actorRole,
        idempotencyKey,
        fingerprint: requestFingerprint({ route: 'PATCH /moderation/policy', body: parsedBody.data })
      });
      return reply.status(200).send(result);
    } catch (error) {
      return moderationError(reply, error);
    }
  });

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
    ['temporary-ban', 'moderation.user.ban'],
    ['permanent-ban', 'moderation.permanent_ban.issue']
  ] as const;
  for (const [action, permission] of sanctionRoutes) {
    app.post(
      `/moderation/users/:userId/${action}`,
      { preHandler: [authenticate, adminMutationRateLimit, requirePermission(permission)] },
      async (request, reply) => {
        const parsedParams = userParamsSchema.safeParse(request.params);
        const parsedBody = sanctionBodySchema.safeParse(request.body);
        const idempotencyKey = parseIdempotencyKey(request.headers['idempotency-key']);
        if (!parsedParams.success || !parsedBody.success || !idempotencyKey) return validationError(reply);
        const type = action === 'temporary-ban' ? 'temporary_ban' : action === 'permanent-ban' ? 'permanent_ban' : action === 'restriction' ? parsedBody.data.restrictionType ?? 'posting_restriction' : action as 'warning' | 'strike';
        if ((type === 'posting_restriction' || type === 'comment_restriction' || type === 'temporary_ban') && !parsedBody.data.durationHours) return validationError(reply);
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
            fingerprint: requestFingerprint({ route: `POST /moderation/users/:userId/${action}`, params: parsedParams.data, body: parsedBody.data })
          });
          if (!result.replayed) {
            const targetUserId = result.sanction.userId ?? parsedParams.data.userId;
            broadcastModerationSanctionCreated({
              sanctionId: result.sanction.id,
              userId: targetUserId,
              sanctionType: result.sanction.type,
              status: result.sanction.status
            });
            if (result.sessionRevoked) {
              disconnectUser(targetUserId, 'session_revoked');
              void realtimeBus
                .publish(targetUserId, { type: 'session.revoked', payload: { userId: targetUserId, reason: 'sanctioned' } })
                .catch(() => undefined);
            }
          }
          return reply.status(result.replayed ? 200 : 201).send({
            replayed: result.replayed,
            sanction: result.sanction
          });
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
      const idempotencyKey = parseIdempotencyKey(request.headers['idempotency-key']);
      if (!parsedParams.success || !parsedBody.success || !idempotencyKey) return validationError(reply);
      try {
        const actor = await actorContext(request);
        const result = await revokeSanction({
          sanctionId: parsedParams.data.sanctionId,
          actorUserId: actor.actorId,
          actorRole: actor.actorRole,
          reason: parsedBody.data.reason,
          idempotencyKey,
          fingerprint: requestFingerprint({ route: 'POST /moderation/sanctions/:sanctionId/revoke', params: parsedParams.data, body: parsedBody.data })
        });
        if (!result.replayed) broadcastModerationSanctionRevoked({
          sanctionId: result.sanction.id,
          userId: result.sanction.userId ?? actor.actorId,
          sanctionType: result.sanction.type
        });
        return reply.status(200).send(result);
      } catch (error) {
        return moderationError(reply, error);
      }
    }
  );

  app.post(
    '/appeals',
    { preHandler: [authenticateForAppeal, appealRateLimit] },
    async (request, reply) => {
      const parsedBody = appealBodySchema.safeParse(request.body);
      const idempotencyKey = parseIdempotencyKey(request.headers['idempotency-key']);
      if (!parsedBody.success || !idempotencyKey) return validationError(reply);
      try {
        const result = await createAppeal({
          sanctionId: parsedBody.data.sanctionId,
          userId: request.user.sub,
          reason: parsedBody.data.reason,
          idempotencyKey,
          fingerprint: requestFingerprint({ route: 'POST /appeals', body: parsedBody.data })
        });
        if (!result.replayed) broadcastModerationAppealCreated({
          appealId: result.appeal.id,
          sanctionId: result.appeal.sanctionId,
          userId: result.appeal.userId
        });
        return reply.status(result.replayed ? 200 : 201).send(result);
      } catch (error) {
        return moderationError(reply, error);
      }
    }
  );

  app.get(
    '/moderation/appeals',
    { preHandler: [authenticate, requirePermission('moderation.appeal.read')] },
    async (request, reply) => {
      const parsedQuery = appealsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) return validationError(reply);
      try {
        return reply.send(await listAppeals(parsedQuery.data));
      } catch (error) {
        if (error instanceof AdminCursorError) return validationError(reply);
        throw error;
      }
    }
  );

  app.post(
    '/moderation/appeals/:appealId/resolve',
    { preHandler: [authenticate, adminMutationRateLimit, requirePermission('moderation.appeal.resolve')] },
    async (request, reply) => {
      const parsedParams = appealParamsSchema.safeParse(request.params);
      const parsedBody = appealDecisionSchema.safeParse(request.body);
      const idempotencyKey = parseIdempotencyKey(request.headers['idempotency-key']);
      if (!parsedParams.success || !parsedBody.success || !idempotencyKey) return validationError(reply);
      try {
        const actor = await actorContext(request);
        const result = await resolveAppeal({
          appealId: parsedParams.data.appealId,
          actorUserId: actor.actorId,
          actorRole: actor.actorRole,
          status: parsedBody.data.status,
          decisionNote: parsedBody.data.decisionNote,
          idempotencyKey,
          fingerprint: requestFingerprint({ route: 'POST /moderation/appeals/:appealId/resolve', params: parsedParams.data, body: parsedBody.data })
        });
        if (!result.replayed) broadcastModerationAppealResolved({
          appealId: result.appeal.id,
          sanctionId: result.appeal.sanctionId,
          userId: result.appeal.userId,
          status: result.appeal.status
        });
        return reply.status(200).send(result);
      } catch (error) {
        return moderationError(reply, error);
      }
    }
  );

  app.post(
    '/moderation/content/:type/:id/remove',
    { preHandler: [authenticate, adminMutationRateLimit, requirePermission('moderation.content.delete')] },
    async (request, reply) => {
      const parsedParams = contentParamsSchema.safeParse(request.params);
      const parsedBody = removeContentBodySchema.safeParse(request.body);
      if (!parsedParams.success || !parsedBody.success) return validationError(reply);

      try {
        const actor = await actorContext(request);
        const removed = await removeModeratedContentAtomically({
          caseId: parsedBody.data.caseId,
          targetType: parsedParams.data.type,
          targetId: parsedParams.data.id,
          actorUserId: actor.actorId,
          actorRole: actor.actorRole,
          reason: parsedBody.data.reason,
          requestId: request.id
        });
        if (removed.status === 'deleted') {
          if (removed.targetType === 'poll' && removed.visibility === 'public') {
            broadcastPollDeleted({ pollId: parsedParams.data.id });
          } else if (removed.targetType === 'comment') {
            broadcastCommentDeleted({ commentId: parsedParams.data.id, pollId: removed.pollId });
          }
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
    { preHandler: [authenticate, adminMutationRateLimit, requirePermission('moderation.case.assign')] },
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
    { preHandler: [authenticate, adminMutationRateLimit, requirePermission('moderation.case.assign')] },
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
    { preHandler: [authenticate, adminMutationRateLimit, requirePermission('moderation.case.resolve')] },
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
      { preHandler: [authenticate, adminMutationRateLimit, requirePermission('moderation.case.resolve')] },
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
    { preHandler: [authenticate, reportRateLimit] },
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
    '/reports/mine',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsedQuery = reportsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) return validationError(reply);
      try {
        return reply.send(await listUserReports({ reporterUserId: request.user.sub, ...parsedQuery.data }));
      } catch (error) {
        if (error instanceof AdminCursorError) return validationError(reply);
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
