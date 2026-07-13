import type { FastifyReply, FastifyRequest } from 'fastify';

import { findUserById } from './auth.repository.js';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Authentication is required.'
    });
  }
}

export async function getCurrentUser(request: FastifyRequest) {
  const userId = request.user.sub;

  return findUserById(userId);
}
