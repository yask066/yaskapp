import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { optionalAuthenticate } from '../auth/auth.utils.js';
import { getObject } from '../../config/storage.js';
import { findViewablePollImageRecord } from './polls.repository.js';

const paramsSchema = z.object({ pollId: z.string().uuid() }).strict();

function validationError(reply: FastifyReply) {
  return reply.status(400).send({
    error: 'validation_error',
    message: 'Request input is invalid.'
  });
}

export function registerPollImageRoutes(app: FastifyInstance) {
  app.get(
    '/media/polls/:pollId',
    { preHandler: optionalAuthenticate },
    async (request, reply) => {
      const parsedParams = paramsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return validationError(reply);
      }
      
      const poll = await findViewablePollImageRecord(
        parsedParams.data.pollId,
        request.user?.sub
      );

      if (!poll?.image_object_key) {
        return reply.status(404).send({
          error: 'not_found',
          message: 'Poll image not found.'
        });
      }

      try {
        const object = await getObject(poll.image_object_key);

        reply.header('content-type', object.ContentType ?? 'image/webp');
        reply.header('cache-control', 'public, max-age=300');

        if (object.ContentLength !== undefined) {
          reply.header('content-length', object.ContentLength);
        }

        return reply.send(object.Body);
      } catch (_) {
        return reply.status(404).send({
          error: 'not_found',
          message: 'Poll image not found.'
        });
      }
    }
  );
}
