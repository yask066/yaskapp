import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../auth/auth.utils.js';
import { SearchValidationError, search } from './search.service.js';

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  type: z.enum(['all', 'polls', 'users']).default('all'),
  sort: z.enum(['relevance', 'newest', 'popular']).default('relevance'),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
}).strict();

export function parseSearchQuery(input: unknown) {
  return searchQuerySchema.safeParse(input);
}

function validationError(reply: FastifyReply, error: z.ZodError | SearchValidationError) {
  return reply.status(400).send({
    error: 'validation_error',
    message: 'Request input is invalid.',
    ...(error instanceof z.ZodError ? { details: error.flatten() } : {})
  });
}

export function registerSearchRoutes(app: FastifyInstance) {
  app.get(
    '/search',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const parsedQuery = parseSearchQuery(request.query);

      if (!parsedQuery.success) {
        return validationError(reply, parsedQuery.error);
      }

      try {
        return await search({
          viewerId: request.user.sub,
          query: parsedQuery.data.q,
          type: parsedQuery.data.type,
          sort: parsedQuery.data.sort,
          cursor: parsedQuery.data.cursor,
          limit: parsedQuery.data.limit
        });
      } catch (error) {
        if (error instanceof SearchValidationError) {
          return validationError(reply, error);
        }

        throw error;
      }
    }
  );
}
