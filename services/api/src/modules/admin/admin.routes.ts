import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import {
  broadcastCommentDeleted,
  broadcastPollDeleted,
  broadcastUserBlocked,
  broadcastUserUnblocked
} from '../../realtime/realtime.hub.js';
import { authenticate } from '../auth/auth.utils.js';
import { permissionsForRole, requirePermission } from '../auth/permissions.js';
import {
  AdminProtectedUserError,
  AdminCommentNotFoundError,
  AdminLastSuperadminError,
  AdminPollNotFoundError,
  AdminSelfActionError,
  AdminUserNotFoundError,
  blockUser,
  deleteAdminComment,
  deleteAdminUser,
  deleteAdminPoll,
  changeUserRole,
  getAdminUser,
  getAdminPoll,
  listAdminUsers,
  listAdminPolls,
  unblockUser
} from './admin.service.js';
import { getBlockedUser } from './admin.repository.js';
import { listAdminAudit } from './audit.service.js';
import { AdminCursorError } from './pagination.js';

const userParamsSchema = z.object({
  userId: z.string().uuid()
}).strict();

const blockBodySchema = z.object({
  reason: z.string().trim().min(1).max(500)
}).strict();

const roleBodySchema = z.object({
  role: z.enum(['user', 'moderator', 'superadmin']),
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
  cursor: z.string().trim().max(512).optional(),
  query: z.string().trim().max(280).optional(),
  status: z.enum(['active', 'deleted', 'all']).default('all'),
  authorId: z.string().uuid().optional()
}).strict();

const adminUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().max(512).optional(),
  query: z.string().trim().max(320).optional(),
  status: z.enum(['active', 'blocked', 'deleted', 'all']).default('all'),
  role: z.enum(['user', 'moderator', 'superadmin', 'all']).default('all')
}).strict();

const adminAuditQuerySchema = z.object({
  action: z.enum([
    'user.blocked',
    'user.unblocked',
    'user.role_changed',
    'user.deleted',
    'poll.deleted_by_admin',
    'comment.deleted_by_admin'
  ]).optional(),
  actorId: z.string().uuid().optional(),
  targetType: z.enum(['user', 'poll', 'comment']).optional(),
  targetId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().max(512).optional()
}).strict();

function adminError(reply: FastifyReply, error: unknown) {
  if (error instanceof AdminCursorError) {
    return reply.status(400).send({
      error: 'validation_error',
      message: error.message
    });
  }
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

  if (error instanceof AdminLastSuperadminError) {
    return reply.status(409).send({
      error: 'invalid_admin_transition',
      message: error.message
    });
  }

  throw error;
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.get(
    '/admin/capabilities',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = await request.getCurrentUser();
      const permissions = user ? permissionsForRole(user.role) : [];

      if (permissions.length === 0) {
        return reply.status(403).send({
          error: 'forbidden',
          message: 'You do not have permission to access administrative capabilities.'
        });
      }

      return reply.send({ permissions });
    }
  );

  app.get(
    '/admin/users',
    { preHandler: [authenticate, requirePermission('admin.users.read')] },
    async (request, reply) => {
      const parsedQuery = adminUsersQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({ error: 'validation_error', message: 'Request input is invalid.' });
      }
      return reply.send(await listAdminUsers(parsedQuery.data));
    }
  );

  app.get(
    '/admin/users/:userId',
    { preHandler: [authenticate, requirePermission('admin.users.read')] },
    async (request, reply) => {
      const parsedParams = userParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.status(400).send({ error: 'validation_error', message: 'Request input is invalid.' });
      }
      try {
        return reply.send({ user: await getAdminUser(parsedParams.data.userId) });
      } catch (error) {
        return adminError(reply, error);
      }
    }
  );

  app.post(
    '/admin/users/:userId/unblock',
    { preHandler: [authenticate, requirePermission('admin.users.unblock')] },
    async (request, reply) => {
      const parsedParams = userParamsSchema.safeParse(request.params);
      const parsedBody = blockBodySchema.safeParse(request.body);
      if (!parsedParams.success || !parsedBody.success) {
        return reply.status(400).send({ error: 'validation_error', message: 'Request input is invalid.' });
      }
      try {
        const result = await unblockUser(request.user.sub, parsedParams.data.userId, {
          actorRole: (await request.getCurrentUser())?.role ?? 'user',
          reason: parsedBody.data.reason,
          requestId: request.id
        });
        if (result.status === 'updated') {
          broadcastUserUnblocked({ userId: parsedParams.data.userId });
        }
        return reply.send({ user: await getAdminUser(parsedParams.data.userId), status: result.status });
      } catch (error) {
        return adminError(reply, error);
      }
    }
  );

  app.delete(
    '/admin/users/:userId',
    { preHandler: [authenticate, requirePermission('admin.users.delete')] },
    async (request, reply) => {
      const parsedParams = userParamsSchema.safeParse(request.params);
      const parsedBody = blockBodySchema.safeParse(request.body);
      if (!parsedParams.success || !parsedBody.success) {
        return reply.status(400).send({ error: 'validation_error', message: 'Request input is invalid.' });
      }
      try {
        await deleteAdminUser(request.user.sub, parsedParams.data.userId, {
          actorRole: (await request.getCurrentUser())?.role ?? 'user',
          reason: parsedBody.data.reason,
          requestId: request.id
        });
        return reply.status(204).send();
      } catch (error) {
        return adminError(reply, error);
      }
    }
  );

  app.patch(
    '/admin/users/:userId/role',
    { preHandler: [authenticate, requirePermission('admin.users.roles.update')] },
    async (request, reply) => {
      const parsedParams = userParamsSchema.safeParse(request.params);
      const parsedBody = roleBodySchema.safeParse(request.body);
      if (!parsedParams.success || !parsedBody.success) {
        return reply.status(400).send({ error: 'validation_error', message: 'Request input is invalid.' });
      }
      try {
        const result = await changeUserRole(request.user.sub, parsedParams.data.userId, parsedBody.data.role, {
          actorRole: (await request.getCurrentUser())?.role ?? 'user',
          reason: parsedBody.data.reason,
          requestId: request.id
        });
        return reply.send({ user: await getAdminUser(parsedParams.data.userId), status: result.status });
      } catch (error) {
        return adminError(reply, error);
      }
    }
  );

  app.get(
    '/admin/audit',
    {
      preHandler: [authenticate, requirePermission('admin.audit.read')]
    },
    async (request, reply) => {
      const parsedQuery = adminAuditQuerySchema.safeParse(request.query);

      if (!parsedQuery.success) {
        return reply.status(400).send({
          error: 'validation_error',
          message: 'Request input is invalid.'
        });
      }

      return reply.send(await listAdminAudit(parsedQuery.data));
    }
  );

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

      return reply.send(await listAdminPolls(parsedQuery.data));
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
        const status = await deleteAdminPoll({
          pollId: parsedParams.data.pollId,
          actorUserId: request.user.sub,
          actorRole: (await request.getCurrentUser())?.role ?? 'user',
          reason: parsedBody.data.reason,
          requestId: request.id
        });
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
        const result = await deleteAdminComment({
          commentId: parsedParams.data.commentId,
          actorUserId: request.user.sub,
          actorRole: (await request.getCurrentUser())?.role ?? 'user',
          reason: parsedBody.data.reason,
          requestId: request.id
        });
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
          parsedParams.data.userId,
          {
            actorRole: (await request.getCurrentUser())?.role ?? 'user',
            reason: parsedBody.data.reason,
            requestId: request.id
          }
        );
        if (result.status === 'blocked') {
          broadcastUserBlocked({ userId: parsedParams.data.userId });
        }
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
