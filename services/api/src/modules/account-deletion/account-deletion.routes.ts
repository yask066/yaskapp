import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AccountDeletionStatusResponse, AccountDeletionVerificationResponse } from '@yaskapp/shared';
import { env } from '../../config/env.js';
import { db } from '../../config/database.js';
import { rateLimit } from '../../config/rate-limit.js';
import { findUserByEmailOrUsername, findUserByIdWithPassword } from '../auth/auth.repository.js';
import { isTrustedOrigin, serializeSessionCookie, sessionCookieName } from '../auth/auth.cookies.js';
import { authenticate } from '../auth/auth.utils.js';
import { verifyPassword } from '../auth/password.js';
import {
  getDeletionOperation,
  getDeletionPermission,
  prepareDeletionOperation
} from './account-deletion.repository.js';
import {
  buildDeletionTokenPair,
  hashDeletionToken,
  reserveVerificationAttempt,
  releaseVerificationAttempt
} from './account-deletion.verification.js';
import { AccountDeletionAcceptanceError, acceptAccountDeletion } from './account-deletion.service.js';
import { acceptDeletionInJournal, prepareDeletionInJournal } from './account-deletion.journal.js';

const verificationSchema = z.object({ password: z.string().min(1).max(128) }).strict();
const loginVerificationSchema = z.object({
  login: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(128)
}).strict();
const acceptanceSchema = z.object({ confirm: z.literal(true) }).strict();
const bearerTokenPattern = /^Bearer\s+(\S+)$/i;
const genericCredentialError = { error: 'unauthorized', message: 'Invalid login or password.' };
const unknownPasswordHash = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.4d/Mg7u9tC9J6YhJKVQn9Z3p0e4D6Wm';

function sendUnauthorized(reply: FastifyReply) {
  return reply.status(401).send({ error: 'unauthorized', message: 'Authentication is required.' });
}

function sendValidationError(reply: FastifyReply) {
  return reply.status(400).send({ error: 'validation_error', message: 'Request input is invalid.' });
}

function hasLoginCredentials(body: unknown) {
  return typeof body === 'object' && body !== null && 'login' in body && 'password' in body;
}

async function authenticateIfPresent(request: FastifyRequest, reply: FastifyReply) {
  const hasCookie = Boolean(request.cookies?.[sessionCookieName]);
  if (hasCookie && !isTrustedOrigin(request.headers.origin, env.CORS_ORIGINS, env.STAGING_PUBLIC_IP)) {
    return reply.status(403).send({
      error: 'csrf_origin_rejected',
      message: 'The request origin is not trusted.'
    });
  }

  const hasBearer = /^Bearer\s/i.test(request.headers.authorization ?? '');
  // Login/password is the deletion-only path and is needed for blocked users
  // whose old cookie no longer represents an active session.
  if (hasLoginCredentials(request.body) && !hasBearer) return;
  if (hasBearer || hasCookie) return authenticate(request, reply);
}

async function verifyCredentials(request: FastifyRequest, input: { login?: string; password: string }) {
  const sessionUserId = request.user?.sub;
  const usingSession = typeof sessionUserId === 'string' && !input.login;
  const login = input.login?.trim().toLowerCase();
  const account = usingSession
    ? await findUserByIdWithPassword(sessionUserId)
    : login ? await findUserByEmailOrUsername(login) : null;
  const attempt = await reserveVerificationAttempt(account?.user.id ?? login ?? 'missing-login', request.ip);
  if (!attempt.allowed) {
    return { account: null, retryAfterSeconds: attempt.retryAfterSeconds };
  }
  const passwordHash = account?.passwordHash ?? unknownPasswordHash;
  const passwordMatches = await verifyPassword(input.password, passwordHash);

  if (!account || account.user.status === 'deleted' || !passwordMatches) {
    return { account: null, retryAfterSeconds: null };
  }

  await releaseVerificationAttempt(attempt.keys);
  return { account, retryAfterSeconds: null };
}

function replyRateLimited(reply: FastifyReply, retryAfterSeconds: number) {
  reply.header('Retry-After', retryAfterSeconds);
  return reply.status(429).send({
    error: 'rate_limit_exceeded',
    message: 'Too many requests. Try again later.'
  });
}

export function registerAccountDeletionRoutes(app: FastifyInstance, journal: {
  prepareDeletionInJournal?: typeof prepareDeletionInJournal;
  acceptDeletionInJournal?: typeof acceptDeletionInJournal;
} = {}) {
  const prepare = journal.prepareDeletionInJournal ?? prepareDeletionInJournal;
  const accept = journal.acceptDeletionInJournal ?? acceptDeletionInJournal;
  app.post('/auth/account-deletion/verification', {
    preHandler: [
      rateLimit({ keyPrefix: 'account-deletion-verification-ip', limit: 30, windowMs: 15 * 60_000 }),
      authenticateIfPresent
    ]
  }, async (request, reply) => {
    if (!env.ACCOUNT_DELETION_ENABLED) {
      return reply.status(503).send({ error: 'account_deletion_disabled', message: 'Account deletion is temporarily unavailable.' });
    }

    const authenticated = Boolean(request.user?.sub);
    const parsed = authenticated
      ? verificationSchema.safeParse(request.body)
      : loginVerificationSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply);

    let credentials: { login?: string; password: string };
    if (authenticated) {
      credentials = parsed.data as { password: string };
    } else {
      credentials = parsed.data as { login: string; password: string };
    }

    let verified;
    try {
      verified = await verifyCredentials(request, credentials);
    } catch (error) {
      request.log.error({ err: error }, 'Account deletion verification failed');
      return reply.status(503).send({ error: 'verification_unavailable', message: 'Account verification is temporarily unavailable.' });
    }
    if (!verified.account) {
      if (verified.retryAfterSeconds !== null) return replyRateLimited(reply, verified.retryAfterSeconds);
      return reply.status(401).send(genericCredentialError);
    }

    const tokenPair = buildDeletionTokenPair();
    const client = await db.connect();
    let operation: AccountDeletionStatusResponse;
    try {
      await client.query('BEGIN');
      operation = await prepareDeletionOperation({
        userId: verified.account.user.id,
        deletionTokenHash: tokenPair.deletionTokenHash,
        statusTokenHash: tokenPair.statusTokenHash,
        deletionTokenExpiresAt: tokenPair.deletionTokenExpiresAt,
        statusTokenExpiresAt: tokenPair.statusTokenExpiresAt
      }, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (operation.status !== 'not_started') {
      return reply.status(409).send({ error: 'account_deletion_in_progress', message: 'Account deletion has already started.' });
    }

    const response: AccountDeletionVerificationResponse = {
      operationId: operation.operationId,
      status: 'not_started',
      deletionToken: tokenPair.deletionToken,
      statusToken: tokenPair.statusToken,
      deletionTokenExpiresAt: tokenPair.deletionTokenExpiresAt.toISOString(),
      statusTokenExpiresAt: tokenPair.statusTokenExpiresAt.toISOString()
    };
    return reply.status(200).send(response);
  });

  app.get('/auth/account-deletion/status', async (request, reply) => {
    const authorization = request.headers.authorization ?? '';
    const token = bearerTokenPattern.exec(authorization)?.[1];
    if (!token) return sendUnauthorized(reply);

    const permission = await getDeletionPermission(hashDeletionToken(token), 'status');
    if (!permission) return sendUnauthorized(reply);

    const operation = await getDeletionOperation(permission.operationId);
    if (!operation) return sendUnauthorized(reply);
    if (operation.acceptedAt && operation.deadlineAt) {
      try {
        await accept({
          operationId: operation.operationId,
          userId: permission.userId,
          acceptedAt: new Date(operation.acceptedAt),
          deadlineAt: new Date(operation.deadlineAt)
        });
      } catch (error) {
        request.log.error({ err: error }, 'Account deletion status journal confirmation failed');
        return reply.status(503).send({ error: 'account_deletion_unavailable', message: 'Account deletion status is temporarily unavailable.' });
      }
    }
    return reply.status(200).send(operation satisfies AccountDeletionStatusResponse);
  });

  app.delete('/auth/me', async (request, reply) => {
    if (!env.ACCOUNT_DELETION_ENABLED) {
      return reply.status(503).send({ error: 'account_deletion_disabled', message: 'Account deletion is temporarily unavailable.' });
    }
    const parsed = acceptanceSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply);
    const token = bearerTokenPattern.exec(request.headers.authorization ?? '')?.[1];
    if (!token) return sendUnauthorized(reply);

    try {
      const operation = await acceptAccountDeletion(token, parsed.data.confirm, {
        writePrepared: prepare,
        writeAccepted: accept
      });
      reply.header('set-cookie', serializeSessionCookie(null, request.protocol === 'https'));
      return reply.status(202).send(operation satisfies AccountDeletionStatusResponse);
    } catch (error) {
      if (error instanceof AccountDeletionAcceptanceError) {
        if (error.code === 'unauthorized') return sendUnauthorized(reply);
        if (error.code === 'last_superadmin') {
          return reply.status(403).send({ error: 'last_superadmin', message: 'The last active superadmin cannot delete this account.' });
        }
        return reply.status(409).send({ error: 'account_deletion_conflict', message: 'The account state changed. Check the deletion status and try again if needed.' });
      }
      request.log.error({ err: error }, 'Account deletion acceptance failed');
      return reply.status(503).send({ error: 'account_deletion_unavailable', message: 'Account deletion could not be confirmed. Check the saved receipt and retry.' });
    }
  });
}
