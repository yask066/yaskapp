import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../config/database.js';
import { findAuthenticatedUserById } from './auth.repository.js';
import { isTrustedOrigin, sessionCookieName } from './auth.cookies.js';
import { env } from '../../config/env.js';
import type { Pool } from 'pg';

function assertTrustedCookieOrigin(request: FastifyRequest, reply: FastifyReply) {
  const hasCookieSession = Boolean(request.cookies?.[sessionCookieName]);
  const usesBearer = /^Bearer\s/i.test(request.headers.authorization ?? '');
  if (hasCookieSession && !usesBearer && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isTrustedOrigin(request.headers.origin, env.CORS_ORIGINS, env.STAGING_PUBLIC_IP)) {
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

export async function isSessionRevoked(
  userId: string,
  tokenSessionVersion: unknown,
  executor: Pick<Pool, 'query'> = db
) {
  const result = await executor.query<{ session_version: number }>(
    `SELECT session_version FROM users
     WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
    [userId]
  );
  const account = result.rows[0];
  return !account || account.session_version !== Number(tokenSessionVersion ?? 0);
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

  if (!user || user.status !== 'active' || await isSessionRevoked(user.id, request.user.sessionVersion)) {
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
  // Ban and account-recovery flows revoke ordinary sessions. Keep the signed
  // pre-revocation token usable only for the narrowly scoped appeal endpoint.
  if (!user || user.status !== 'active') {
    return reply.status(401).send({ error: 'unauthorized', message: 'Authentication is required.' });
  }
}

export async function getCurrentUser(request: FastifyRequest) {
  const userId = request.user.sub;

  return findAuthenticatedUserById(userId);
}
