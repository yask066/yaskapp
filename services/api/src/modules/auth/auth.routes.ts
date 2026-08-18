import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { rateLimit } from '../../config/rate-limit.js';
import {
  AuthenticationError,
  ConflictError,
  registerUser,
  signInUser
} from './auth.service.js';
import { authenticate } from './auth.utils.js';

const usernamePattern = /^[a-z0-9_][a-z0-9_.]{2,29}$/i;

const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  username: z.string().trim().min(3).max(30).regex(usernamePattern),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(80).optional()
}).strict();

const loginSchema = z.object({
  login: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(128)
}).strict();

function validationError(reply: FastifyReply, error: z.ZodError) {
  return reply.status(400).send({
    error: 'validation_error',
    message: 'Request body is invalid.',
    details: error.flatten().fieldErrors
  });
}

function authError(reply: FastifyReply, error: unknown) {
  if (error instanceof ConflictError) {
    return reply.status(409).send({
      error: 'conflict',
      message: error.message
    });
  }

  if (error instanceof AuthenticationError) {
    return reply.status(401).send({
      error: 'unauthorized',
      message: error.message
    });
  }

  throw error;
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/register', { preHandler: rateLimit({
    keyPrefix: 'auth-register',
    limit: 5,
    windowMs: 15 * 60_000
  }) }, async (request, reply) => {
    const parsedBody = registerSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return validationError(reply, parsedBody.error);
    }

    try {
      const result = await registerUser(app, parsedBody.data);

      return reply.status(201).send(result);
    } catch (error) {
      return authError(reply, error);
    }
  });

  app.post('/auth/login', { preHandler: rateLimit({
    keyPrefix: 'auth-login',
    limit: 10,
    windowMs: 15 * 60_000
  }) }, async (request, reply) => {
    const parsedBody = loginSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return validationError(reply, parsedBody.error);
    }

    try {
      return await signInUser(app, parsedBody.data);
    } catch (error) {
      return authError(reply, error);
    }
  });

  app.get(
    '/auth/me',
    {
      preHandler: authenticate
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await request.getCurrentUser();

      if (!user) {
        return reply.status(401).send({
          error: 'unauthorized',
          message: 'Authentication is required.'
        });
      }

      return {
        user
      };
    }
  );
}
