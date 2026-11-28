import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../config/database.js';
import {
  findAuthenticatedUserWithSessionById,
  type AuthenticatedUser
} from './auth.repository.js';
import { isTrustedCookieMutationRequest, sessionCookieName } from './auth.cookies.js';
import { getActiveUserSanctions, userHasSanction } from '../moderation/sanctions.repository.js';
import { env } from '../../config/env.js';
import type { Pool } from 'pg';

const currentUserCache = new WeakMap<
  FastifyRequest,
  { userId: string; promise: Promise<{ user: AuthenticatedUser; sessionVersion: number } | null> }
>();

function loadCachedAuthenticatedRecord(request: FastifyRequest) {
  const userId = request.user.sub;
  const cached = currentUserCache.get(request);
  if (cached && cached.userId === userId) {
    return cached.promise;
  }
  const promise = findAuthenticatedUserWithSessionById(userId);
  currentUserCache.set(request, { userId, promise });
  return promise;
}

function assertTrustedCookieOrigin(request: FastifyRequest, reply: FastifyReply) {
  const hasCookieSession = Boolean(request.cookies?.[sessionCookieName]);
  const usesBearer = /^Bearer\s/i.test(request.headers.authorization ?? '');
  if (
    hasCookieSession &&
    !usesBearer &&
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    !isTrustedCookieMutationRequest(request.headers, env.CORS_ORIGINS, env.STAGING_PUBLIC_IP)
  ) {
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

  const record = await loadCachedAuthenticatedRecord(request);

  if (
    !record ||
    record.user.status !== 'active' ||
    record.sessionVersion !== Number(request.user.sessionVersion ?? 0)
  ) {
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
  const usesBearer = /^Bearer\s/i.test(request.headers.authorization ?? '');
  if (!usesBearer) {
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

  const record = await loadCachedAuthenticatedRecord(request);

  if (
    !record ||
    record.user.status !== 'active' ||
    record.sessionVersion !== Number(request.user.sessionVersion ?? 0)
  ) {
    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Authentication is required.'
    });
  }
}

export async function authenticateForAppeal(request: FastifyRequest, reply: FastifyReply) {
  if (assertTrustedCookieOrigin(request, reply)) return;
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'unauthorized', message: 'Authentication is required.' });
  }
  const record = await loadCachedAuthenticatedRecord(request);
  // Ban flows revoke ordinary sessions. Keep a revoked signed token usable for
  // /appeals only when the account actually has an active ban sanction (not after logout).
  if (!record || record.user.status !== 'active') {
    return reply.status(401).send({ error: 'unauthorized', message: 'Authentication is required.' });
  }
  if (record.sessionVersion !== Number(request.user.sessionVersion ?? 0)) {
    const sanctions = await getActiveUserSanctions(record.user.id);
    const hasBan = userHasSanction(sanctions, 'temporary_ban') || userHasSanction(sanctions, 'permanent_ban');
    if (!hasBan) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Authentication is required.' });
    }
  }
}

export async function getCurrentUser(request: FastifyRequest) {
  const record = await loadCachedAuthenticatedRecord(request);
  return record ? record.user : null;
}
