import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../config/database.js';
import { findAuthenticatedUserById } from './auth.repository.js';
import { isTrustedOrigin, sessionCookieName } from './auth.cookies.js';
import { env } from '../../config/env.js';

function assertTrustedCookieOrigin(request: FastifyRequest, reply: FastifyReply) {
  const hasCookieSession = Boolean(request.cookies?.[sessionCookieName]);
  const usesBearer = /^Bearer\s/i.test(request.headers.authorization ?? '');
  if (hasCookieSession && !usesBearer && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isTrustedOrigin(request.headers.origin, env.CORS_ORIGINS)) {
    return reply.status(403).send({
      error: 'csrf_origin_rejected',
      message: 'The request origin is not trusted.'
    });
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  if (assertTrustedCookieOrigin(request, reply)) return;
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
    if (!request.cookies?.[sessionCookieName]) return;
    if (assertTrustedCookieOrigin(request, reply)) return;
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

export async function authenticateForAppeal(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'unauthorized', message: 'Authentication is required.' });
  }
  const user = await request.getCurrentUser();
  if (!user || user.status !== 'active') {
    return reply.status(401).send({ error: 'unauthorized', message: 'Authentication is required.' });
  }
}

export async function getCurrentUser(request: FastifyRequest) {
  const userId = request.user.sub;

  return findAuthenticatedUserById(userId);
}
