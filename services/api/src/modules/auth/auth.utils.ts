import type { FastifyReply, FastifyRequest } from 'fastify';

import { findAuthenticatedUserById } from './auth.repository.js';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Authentication is required.'
    });
  }

  const user = await request.getCurrentUser();

  if (!user || user.status !== 'active') {
    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Authentication is required.'
    });
  }
}

export async function optionalAuthenticate(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!request.headers.authorization) {
    return;
  }

  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Authentication is required.'
    });
  }

  const user = await request.getCurrentUser();

  if (!user || user.status !== 'active') {
    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Authentication is required.'
    });
  }
}

export async function getCurrentUser(request: FastifyRequest) {
  const userId = request.user.sub;

  return findAuthenticatedUserById(userId);
}
