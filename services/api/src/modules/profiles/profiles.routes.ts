import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../auth/auth.utils.js';
import {
  FollowRepositoryError,
  ProfileNotFoundError,
  followUser,
  listMyPolls,
  unfollowUser,
  updateProfile
} from './profiles.service.js';

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  bio: z
    .union([z.string().trim().max(500), z.null()])
    .optional()
});

const listMyPollsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

const followParamsSchema = z.object({
  userId: z.string().uuid()
});

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({
    error: 'validation_error',
    message: 'Request body is invalid.',
    details: error.flatten().fieldErrors
  });
}

function profileError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProfileNotFoundError) {
    return reply.status(404).send({
      error: 'not_found',
      message: error.message
    });
  }

  if (error instanceof FollowRepositoryError) {
    if (error.code === 'SELF_FOLLOW') {
      return reply.status(400).send({
        error: 'invalid_follow',
        message: error.message
      });
    }

    return reply.status(404).send({
      error: 'not_found',
      message: error.message
    });
  }

  throw error;
}

export function registerProfileRoutes(app: FastifyInstance) {
  app.post(
    '/users/:userId/follow',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedParams = followParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      try {
        const relationship = await followUser(
          request.user.sub,
          parsedParams.data.userId
        );

        return reply.status(201).send(relationship);
      } catch (error) {
        return profileError(reply, error);
      }
    }
  );

  app.delete(
    '/users/:userId/follow',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedParams = followParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      try {
        const relationship = await unfollowUser(
          request.user.sub,
          parsedParams.data.userId
        );

        return reply.send(relationship);
      } catch (error) {
        return profileError(reply, error);
      }
    }
  );

  app.get(
    '/profiles/me/polls',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedQuery = listMyPollsQuerySchema.safeParse(request.query);

      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error);
      }

      const items = await listMyPolls(request.user.sub, parsedQuery.data.limit);

      return {
        items
      };
    }
  );

  app.patch(
    '/profiles/me',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedBody = updateProfileSchema.safeParse(request.body);

      if (!parsedBody.success) {
        return validationError(reply, parsedBody.error);
      }

      try {
        const user = await updateProfile({
          userId: request.user.sub,
          ...parsedBody.data
        });

        return {
          user
        };
      } catch (error) {
        return profileError(reply, error);
      }
    }
  );
}
