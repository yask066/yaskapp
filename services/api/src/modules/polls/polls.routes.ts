import type { FastifyInstance, FastifyReply } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  broadcastPollVoteCreated,
  broadcastPollVoteUpdated
} from '../../realtime/realtime.hub.js';
import { authenticate, optionalAuthenticate } from '../auth/auth.utils.js';
import {
  PollAlreadyVotedError,
  PollClosedError,
  PollCancellationNotAllowedError,
  PollVoteChangeNotAllowedError,
  PollNotFoundError,
  cancelVote,
  createPoll,
  createPollComment,
  likePoll,
  listPollComments,
  listPublicPolls,
  listSubscriptionPolls,
  setVote,
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
  imageObjectKey: z.string().trim().min(1).max(1024).optional(),
  visibility: z.enum(['public', 'followers', 'private']).default('public'),
  endsAt: z
    .string()
    .datetime({ offset: true })
    .refine((value) => new Date(value) > new Date(), 'Poll end date must be in the future.')
    .optional(),
  allowVoteCancellation: z.boolean().default(false),
  allowVoteChange: z.boolean().default(false)
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

  if (error instanceof PollVoteChangeNotAllowedError) {
    return reply.status(422).send({
      error: 'vote_change_not_allowed',
      message: error.message
    });
  }

  throw error;
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
        const result = await setVote({
          pollId: parsedParams.data.pollId,
          optionId: parsedBody.data.optionId,
          voterId: request.user.sub
        });

        if (result.operation === 'created') {
          broadcastPollVoteCreated({
            poll: result.poll,
            vote: result.vote
          });
        } else {
          broadcastPollVoteUpdated({
            poll: result.poll
          });
        }

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
