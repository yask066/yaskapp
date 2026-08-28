import type { MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  broadcastPollVoteCreated,
  broadcastPollVoteUpdated,
  broadcastPollDeleted
} from '../../realtime/realtime.hub.js';
import { authenticate, optionalAuthenticate } from '../auth/auth.utils.js';
import { UserSanctionedError } from '../moderation/sanctions.repository.js';
import {
  deletePollImageObject,
  PollImageStorageError,
  PollImageUploadError,
  processPollImage
} from './poll-images.service.js';
import {
  PollAlreadyVotedError,
  PollClosedError,
  PollCancellationNotAllowedError,
  PollNotFoundError,
  cancelVote,
  createPoll,
  createPollComment,
  deletePoll,
  likePoll,
  listPollComments,
  listPublicPolls,
  listSubscriptionPolls,
  unlikePoll,
  voteOnPoll
} from './polls.service.js';

const uuidSchema = z.string().uuid();

const listPollsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20)
}).strict();

const createPollSchema = z.object({
  question: z.string().trim().min(1).max(280),
  description: z.string().trim().min(1).max(2000).optional(),
  options: z
    .array(z.string().trim().min(1).max(160))
    .min(2)
    .max(5)
    .refine((options) => {
      const normalizedOptions = options.map((option) => option.toLowerCase());

      return new Set(normalizedOptions).size === normalizedOptions.length;
    }, 'Poll options must be unique.'),
  visibility: z.enum(['public', 'followers', 'private']).default('public'),
  endsAt: z
    .string()
    .datetime({ offset: true })
    .refine((value) => new Date(value) > new Date(), 'Poll end date must be in the future.')
    .optional(),
  allowVoteCancellation: z.boolean().default(false),
}).strict();

const voteParamsSchema = z.object({
  pollId: uuidSchema
}).strict();

const likeParamsSchema = z.object({
  pollId: uuidSchema
}).strict();

const commentsParamsSchema = z.object({
  pollId: uuidSchema
}).strict();

const commentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50)
}).strict();

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(1000)
}).strict();

const voteBodySchema = z.object({
  optionId: uuidSchema
}).strict();

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({
    error: 'validation_error',
    message: 'Request input is invalid.',
    details: error.flatten()
  });
}

function pollError(reply: FastifyReply, error: unknown) {
  if (error instanceof PollNotFoundError) {
    return reply.status(404).send({
      error: 'not_found',
      message: error.message
    });
  }

  if (error instanceof PollAlreadyVotedError) {
    return reply.status(409).send({
      error: 'already_voted',
      message: error.message
    });
  }

  if (error instanceof PollClosedError) {
    return reply.status(422).send({
      error: 'poll_closed',
      message: error.message
    });
  }

  if (error instanceof PollCancellationNotAllowedError) {
    return reply.status(422).send({
      error: 'vote_cancellation_not_allowed',
      message: error.message
    });
  }

  if (error instanceof UserSanctionedError) {
    return reply.status(403).send({ error: 'restricted', message: error.message });
  }

  if (error instanceof PollImageUploadError) {
    return reply.status(400).send({ error: error.code, message: error.message });
  }

  if (error instanceof PollImageStorageError) {
    return reply.status(503).send({ error: 'poll_image_storage_unavailable', message: error.message });
  }


  throw error;
}

export async function cleanupUploadedPollImage(
  objectKey: string,
  deleteImage: (key: string) => Promise<void> = deletePollImageObject
) {
  try {
    await deleteImage(objectKey);
  } catch (_) {
    // Preserve the original poll creation error for the client.
  }
}

async function parseMultipartCreatePoll(request: FastifyRequest) {
  const fields: Record<string, unknown> = {};
  let imagePart: Pick<MultipartFile, 'fieldname' | 'mimetype' | 'toBuffer'> | undefined;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'image' || imagePart) {
        throw new PollImageUploadError('Only one image field is allowed.');
      }

      const imageBytes = await part.toBuffer();
      imagePart = {
        fieldname: part.fieldname,
        mimetype: part.mimetype,
        toBuffer: async () => imageBytes
      };
      continue;
    }

    fields[part.fieldname] = part.value;
  }

  if (fields.options !== undefined && typeof fields.options === 'string') {
    try {
      fields.options = JSON.parse(fields.options);
    } catch (_) {
      fields.options = undefined;
    }
  }

  if (fields.allowVoteCancellation !== undefined) {
    fields.allowVoteCancellation = fields.allowVoteCancellation === 'true';
  }

  return { fields, imagePart };
}

export function registerPollRoutes(app: FastifyInstance) {
  app.get(
    '/polls',
    {
      preHandler: optionalAuthenticate
    },
    async (request, reply) => {
    const parsedQuery = listPollsQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return validationError(reply, parsedQuery.error);
    }

    const items = await listPublicPolls(parsedQuery.data.limit, request.user?.sub);

    return {
      items
    };
    }
  );

  app.delete(
    '/polls/:pollId',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedParams = voteParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      try {
        await deletePoll({
          pollId: parsedParams.data.pollId,
          authorId: request.user.sub
        });

        broadcastPollDeleted({
          pollId: parsedParams.data.pollId
        });

        return reply.status(204).send();
      } catch (error) {
        return pollError(reply, error);
      }
    }
  );

  app.post(
    '/polls',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      let rawBody: unknown = request.body;
      let imagePart: Pick<MultipartFile, 'fieldname' | 'mimetype' | 'toBuffer'> | undefined;

      try {
        if (request.isMultipart()) {
          const multipart = await parseMultipartCreatePoll(request);
          rawBody = multipart.fields;
          imagePart = multipart.imagePart;
        }
      } catch (error) {
        return pollError(reply, error);
      }

      const parsedBody = createPollSchema.safeParse(rawBody);

      if (!parsedBody.success) {
        return validationError(reply, parsedBody.error);
      }

      let uploadedImageObjectKey: string | undefined;

      try {

        if (imagePart) {
          uploadedImageObjectKey = (await processPollImage(request.user.sub, imagePart)).objectKey;
        }

        const poll = await createPoll({
          authorId: request.user.sub,
          ...parsedBody.data,
          imageObjectKey: uploadedImageObjectKey
        });

        return reply.status(201).send({
          poll
        });
      } catch (error) {
        if (uploadedImageObjectKey) {
          await cleanupUploadedPollImage(uploadedImageObjectKey);
        }

        return pollError(reply, error);
      }
    }
  );

  app.get(
    '/polls/subscriptions',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedQuery = listPollsQuerySchema.safeParse(request.query);

      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error);
      }

      const items = await listSubscriptionPolls(
        request.user.sub,
        parsedQuery.data.limit
      );

      return {
        items
      };
    }
  );

  app.get('/polls/:pollId/comments', async (request, reply) => {
    const parsedParams = commentsParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      return validationError(reply, parsedParams.error);
    }

    const parsedQuery = commentsQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return validationError(reply, parsedQuery.error);
    }

    try {
      return await listPollComments({
        pollId: parsedParams.data.pollId,
        limit: parsedQuery.data.limit
      });
    } catch (error) {
      return pollError(reply, error);
    }
  });

  app.post(
    '/polls/:pollId/comments',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedParams = commentsParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      const parsedBody = createCommentSchema.safeParse(request.body);

      if (!parsedBody.success) {
        return validationError(reply, parsedBody.error);
      }

      try {
        const result = await createPollComment({
          pollId: parsedParams.data.pollId,
          authorId: request.user.sub,
          body: parsedBody.data.body
        });

        return reply.status(201).send({
          comment: result.comment,
          poll: result.poll
        });
      } catch (error) {
        return pollError(reply, error);
      }
    }
  );

  app.post(
    '/polls/:pollId/likes',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedParams = likeParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      try {
        const result = await likePoll({
          pollId: parsedParams.data.pollId,
          userId: request.user.sub
        });

        return reply.status(201).send(result);
      } catch (error) {
        return pollError(reply, error);
      }
    }
  );

  app.delete(
    '/polls/:pollId/likes',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedParams = likeParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      try {
        const result = await unlikePoll({
          pollId: parsedParams.data.pollId,
          userId: request.user.sub
        });

        return reply.send(result);
      } catch (error) {
        return pollError(reply, error);
      }
    }
  );

  app.post(
    '/polls/:pollId/votes',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedParams = voteParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      const parsedBody = voteBodySchema.safeParse(request.body);

      if (!parsedBody.success) {
        return validationError(reply, parsedBody.error);
      }

      try {
        const result = await voteOnPoll({
          pollId: parsedParams.data.pollId,
          optionId: parsedBody.data.optionId,
          voterId: request.user.sub
        });

        broadcastPollVoteCreated({
          poll: result.poll,
          vote: result.vote
        });

        return reply.status(201).send(result);
      } catch (error) {
        return pollError(reply, error);
      }
    }
  );

  app.put(
    '/polls/:pollId/votes',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedParams = voteParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      const parsedBody = voteBodySchema.safeParse(request.body);

      if (!parsedBody.success) {
        return validationError(reply, parsedBody.error);
      }

      try {
        const result = await voteOnPoll({
          pollId: parsedParams.data.pollId,
          optionId: parsedBody.data.optionId,
          voterId: request.user.sub
        });

        broadcastPollVoteCreated({
          poll: result.poll,
          vote: result.vote
        });

        return reply.status(201).send({
          poll: result.poll,
          vote: result.vote
        });
      } catch (error) {
        return pollError(reply, error);
      }
    }
  );

  app.delete(
    '/polls/:pollId/votes',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedParams = voteParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply, parsedParams.error);
      }

      try {
        const result = await cancelVote({
          pollId: parsedParams.data.pollId,
          voterId: request.user.sub
        });

        broadcastPollVoteUpdated({
          poll: result.poll
        });

        return reply.send(result);
      } catch (error) {
        return pollError(reply, error);
      }
    }
  );
}
