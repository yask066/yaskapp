import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../auth/auth.utils.js';
import { moderationPermissionsForRole, requirePermission } from '../auth/permissions.js';
import { AdminCursorError } from '../admin/pagination.js';
import {
  reportCategories,
  reportTargetTypes,
  ModerationTargetNotFoundError
} from './moderation.repository.js';
import { createReport, listModerationCases } from './moderation.service.js';

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

function validationError(reply: FastifyReply) {
  return reply.status(400).send({
    error: 'validation_error',
    message: 'Request input is invalid.'
  });
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
