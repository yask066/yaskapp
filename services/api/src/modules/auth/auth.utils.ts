import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../config/database.js';
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

  if (!user || user.status !== 'active' || await isSessionRevoked(user.id, request.user.sessionVersion)) {
    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Authentication is required.'
    });
  }
}

async function isSessionRevoked(userId: string, tokenSessionVersion: unknown) {
  const result = await db.query<{ session_version: number }>(
    'SELECT session_version FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId]
  );
  return result.rows[0] !== undefined && result.rows[0].session_version !== Number(tokenSessionVersion ?? 0);
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
