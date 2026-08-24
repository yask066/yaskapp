import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { broadcastCommentDeleted, broadcastPollDeleted } from '../../realtime/realtime.hub.js';
import { authenticate } from '../auth/auth.utils.js';
import { requirePermission } from '../auth/permissions.js';
import {
  AdminProtectedUserError,
  AdminCommentNotFoundError,
  AdminPollNotFoundError,
  AdminSelfActionError,
  AdminUserNotFoundError,
  blockUser,
  deleteAdminComment,
  deleteAdminPoll,
  getAdminPoll,
  listAdminPolls
} from './admin.service.js';
import { getBlockedUser } from './admin.repository.js';

const userParamsSchema = z.object({
  userId: z.string().uuid()
}).strict();

const blockBodySchema = z.object({
  reason: z.string().trim().min(1).max(500)
}).strict();

const pollParamsSchema = z.object({
  pollId: z.string().uuid()
}).strict();

const commentParamsSchema = z.object({
  commentId: z.string().uuid()
}).strict();

const adminPollsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  query: z.string().trim().max(280).optional(),
  status: z.enum(['active', 'deleted', 'all']).default('all'),
  authorId: z.string().uuid().optional()
}).strict();

function adminError(reply: FastifyReply, error: unknown) {
  if (error instanceof AdminUserNotFoundError) {
    return reply.status(404).send({
      error: 'not_found',
      message: error.message
    });
  }

  if (error instanceof AdminPollNotFoundError || error instanceof AdminCommentNotFoundError) {
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
  app.get(
    '/admin/polls',
    {
      preHandler: [authenticate, requirePermission('admin.polls.read')]
    },
    async (request, reply) => {
      const parsedQuery = adminPollsQuerySchema.safeParse(request.query);

      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: 'validation_error',
          message: 'Request input is invalid.'
        });
      }

      const items = await listAdminPolls(parsedQuery.data);
      return reply.send({ items });
    }
  );

  app.get(
    '/admin/polls/:pollId',
    {
      preHandler: [authenticate, requirePermission('admin.polls.read')]
    },
    async (request, reply) => {
      const parsedParams = pollParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.status(400).send({
          error: 'validation_error',
          message: 'Request input is invalid.'
        });
      }

      try {
        return reply.send({ poll: await getAdminPoll(parsedParams.data.pollId) });
      } catch (error) {
        return adminError(reply, error);
      }
    }
  );

  app.delete(
    '/admin/polls/:pollId',
    {
      preHandler: [authenticate, requirePermission('admin.polls.delete')]
    },
    async (request, reply) => {
      const parsedParams = pollParamsSchema.safeParse(request.params);
      const parsedBody = blockBodySchema.safeParse(request.body);

      if (!parsedParams.success || !parsedBody.success) {
        return reply.status(400).send({
          error: 'validation_error',
          message: 'Request input is invalid.'
        });
      }

      try {
        const status = await deleteAdminPoll(parsedParams.data.pollId);
        if (status === 'deleted') {
          broadcastPollDeleted({ pollId: parsedParams.data.pollId });
        }
        return reply.status(204).send();
      } catch (error) {
        return adminError(reply, error);
      }
    }
  );

  app.delete(
    '/admin/comments/:commentId',
    {
      preHandler: [authenticate, requirePermission('admin.comments.delete')]
    },
    async (request, reply) => {
      const parsedParams = commentParamsSchema.safeParse(request.params);
      const parsedBody = blockBodySchema.safeParse(request.body);

      if (!parsedParams.success || !parsedBody.success) {
        return reply.status(400).send({
          error: 'validation_error',
          message: 'Request input is invalid.'
        });
      }

      try {
        const result = await deleteAdminComment(parsedParams.data.commentId);
        if (result.status === 'deleted') {
          broadcastCommentDeleted({
            commentId: parsedParams.data.commentId,
            pollId: result.pollId
          });
        }
        return reply.status(204).send();
      } catch (error) {
        return adminError(reply, error);
      }
    }
  );

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
