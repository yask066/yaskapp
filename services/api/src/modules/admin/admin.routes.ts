import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../auth/auth.utils.js';
import { requirePermission } from '../auth/permissions.js';
import {
  AdminProtectedUserError,
  AdminSelfActionError,
  AdminUserNotFoundError,
  blockUser
} from './admin.service.js';
import { getBlockedUser } from './admin.repository.js';

const userParamsSchema = z.object({
  userId: z.string().uuid()
}).strict();

const blockBodySchema = z.object({
  reason: z.string().trim().min(1).max(500)
}).strict();

function adminError(reply: FastifyReply, error: unknown) {
  if (error instanceof AdminUserNotFoundError) {
    return reply.status(404).send({
      error: 'not_found',
      message: error.message
    });
  }

  if (error instanceof AdminSelfActionError || error instanceof AdminProtectedUserError) {
    return reply.status(409).send({
      error: 'invalid_admin_transition',
      message: error.message
    });
  }

  throw error;
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.post(
    '/admin/users/:userId/block',
    {
      preHandler: [authenticate, requirePermission('admin.users.block')]
    },
    async (request, reply) => {
      const parsedParams = userParamsSchema.safeParse(request.params);
      const parsedBody = blockBodySchema.safeParse(request.body);

      if (!parsedParams.success || !parsedBody.success) {
        return reply.status(400).send({
          error: 'validation_error',
          message: 'Request input is invalid.'
        });
      }

      try {
        const result = await blockUser(
          request.user.sub,
          parsedParams.data.userId
        );
        const user = await getBlockedUser(parsedParams.data.userId);

        return reply.send({
          user,
          status: result.status
        });
      } catch (error) {
        return adminError(reply, error);
      }
    }
  );
}
