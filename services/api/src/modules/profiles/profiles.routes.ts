import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { authenticate, optionalAuthenticate } from '../auth/auth.utils.js';
import { supportedCountryCodeSchema } from '../countries.js';
import { rateLimit } from '../../config/rate-limit.js';
import {
  AvatarProcessingError,
  AvatarStorageError,
  AvatarUploadError,
  deleteAvatar,
  uploadAvatar
} from './avatars.service.js';
import { getObject } from '../../config/storage.js';
import { findAvatarObjectKey } from './profiles.repository.js';
import {
  FollowRepositoryError,
  CountryClearNotAllowedError,
  ProfileNotFoundError,
  followUser,
  getPublicProfile,
  listFollowers,
  listFollowing,
  listMyPolls,
  listUserPolls,
  unfollowUser,
  updateProfile
} from './profiles.service.js';

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  bio: z
    .union([z.string().trim().max(500), z.null()])
    .optional(),
  countryCode: z
    .union([z.string().trim().toUpperCase().pipe(supportedCountryCodeSchema), z.null()])
    .optional()
}).strict().refine(
  (profile) =>
    profile.displayName !== undefined ||
    profile.bio !== undefined ||
    profile.countryCode !== undefined,
  'At least one profile field is required.'
);

const listMyPollsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20)
}).strict();

const listProfilesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50)
}).strict();

const followParamsSchema = z.object({
  userId: z.string().uuid()
}).strict();

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({
    error: 'validation_error',
    message: 'Request body is invalid.',
    details: error.flatten().fieldErrors
  });
}

function profileError(reply: FastifyReply, error: unknown) {
  if (error instanceof AvatarUploadError) {
    return reply.status(400).send({
      error: error.code,
      message: error.message
    });
  }

  if (error instanceof AvatarProcessingError) {
    return reply.status(400).send({
      error: 'avatar_processing_failed',
      message: error.message
    });
  }

  if (error instanceof AvatarStorageError) {
    return reply.status(503).send({
      error: 'avatar_storage_unavailable',
      message: error.message
    });
  }

  if (error instanceof CountryClearNotAllowedError) {
    return reply.status(400).send({
      error: 'country_clear_not_allowed',
      message: error.message
    });
  }

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
  app.get('/media/avatars/:userId', async (request, reply) => {
    const parsedParams = followParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      return validationError(reply, parsedParams.error);
    }

    const objectKey = await findAvatarObjectKey(parsedParams.data.userId);

    if (!objectKey) {
      return reply.status(404).send({
        error: 'not_found',
        message: 'Avatar not found.'
      });
    }

    try {
      const object = await getObject(objectKey);

      reply.header('content-type', object.ContentType ?? 'image/webp');
      reply.header('cache-control', 'public, max-age=300');

      if (object.ContentLength !== undefined) {
        reply.header('content-length', object.ContentLength);
      }

      return reply.send(object.Body);
    } catch (_) {
      return reply.status(404).send({
        error: 'not_found',
        message: 'Avatar not found.'
      });
    }
  });

  app.post(
    '/profiles/me/avatar',
    {
      preHandler: [
        authenticate,
        rateLimit({
          keyPrefix: 'avatar-upload',
          limit: 5,
          windowMs: 15 * 60_000,
          errorCode: 'avatar_rate_limited'
        })
      ]
    },
    async (request, reply) => {
      try {
        const part = await request.file();

        if (!part) {
          throw new AvatarUploadError('The avatar field is required.');
        }

        const user = await uploadAvatar(request.user.sub, part);

        return { user };
      } catch (error) {
        if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
          return reply.status(400).send({
            error: 'avatar_too_large',
            message: 'Avatar file must be 5 MB or smaller.'
          });
        }

        return profileError(reply, error);
      }
    }
  );

  app.delete(
    '/profiles/me/avatar',
    {
      preHandler: [
        authenticate,
        rateLimit({
          keyPrefix: 'avatar-delete',
          limit: 10,
          windowMs: 15 * 60_000,
          errorCode: 'avatar_rate_limited'
        })
      ]
    },
    async (request, reply) => {
      try {
        const user = await deleteAvatar(request.user.sub);

        return { user };
      } catch (error) {
        return profileError(reply, error);
      }
    }
  );

  app.get(
    '/users/:userId',
    {
      preHandler: optionalAuthenticate
    },
    async (request, reply) => {
      const parsedParams = followParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      try {
        return {
          user: await getPublicProfile(parsedParams.data.userId, request.user?.sub)
        };
      } catch (error) {
        return profileError(reply, error);
      }
    }
  );

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

  app.get(
    '/users/:userId/followers',
    {
      preHandler: optionalAuthenticate
    },
    async (request, reply) => {
      const parsedParams = followParamsSchema.safeParse(request.params);
      const parsedQuery = listProfilesQuerySchema.safeParse(request.query);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error);
      }

      try {
        return {
          items: await listFollowers(
            parsedParams.data.userId,
            request.user?.sub,
            parsedQuery.data.limit
          )
        };
      } catch (error) {
        return profileError(reply, error);
      }
    }
  );

  app.get(
    '/profiles/me/following',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedQuery = listProfilesQuerySchema.safeParse(request.query);

      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error);
      }

      return {
        items: await listFollowing(request.user.sub, parsedQuery.data.limit)
      };
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

  app.get(
    '/users/:userId/polls',
    {
      preHandler: optionalAuthenticate
    },
    async (request, reply) => {
      const parsedParams = followParamsSchema.safeParse(request.params);
      const parsedQuery = listMyPollsQuerySchema.safeParse(request.query);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error);
      }

      try {
        return {
          items: await listUserPolls(
            parsedParams.data.userId,
            parsedQuery.data.limit,
            request.user?.sub
          )
        };
      } catch (error) {
        return profileError(reply, error);
      }
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
