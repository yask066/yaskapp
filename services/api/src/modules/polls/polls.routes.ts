import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../auth/auth.utils.js';
import {
  PollAlreadyVotedError,
  PollClosedError,
  PollNotFoundError,
  createPoll,
  listPublicPolls,
  voteOnPoll
} from './polls.service.js';

const uuidSchema = z.string().uuid();

const listPollsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

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
  imageObjectKey: z.string().trim().min(1).max(1024).optional(),
  visibility: z.enum(['public', 'followers', 'private']).default('public'),
  endsAt: z
    .string()
    .datetime({ offset: true })
    .refine((value) => new Date(value) > new Date(), 'Poll end date must be in the future.')
    .optional()
});

const voteParamsSchema = z.object({
  pollId: uuidSchema
});

const voteBodySchema = z.object({
  optionId: uuidSchema
});

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

  throw error;
}

export function registerPollRoutes(app: FastifyInstance) {
  app.get('/polls', async (request, reply) => {
    const parsedQuery = listPollsQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return validationError(reply, parsedQuery.error);
    }

    const items = await listPublicPolls(parsedQuery.data.limit);

    return {
      items
    };
  });

  app.post(
    '/polls',
    {
      preHandler: authenticate
    },
    async (request, reply) => {
      const parsedBody = createPollSchema.safeParse(request.body);

      if (!parsedBody.success) {
        return validationError(reply, parsedBody.error);
      }

      const poll = await createPoll({
        authorId: request.user.sub,
        ...parsedBody.data
      });

      return reply.status(201).send({
        poll
      });
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

        return reply.status(201).send(result);
      } catch (error) {
        return pollError(reply, error);
      }
    }
  );
}
