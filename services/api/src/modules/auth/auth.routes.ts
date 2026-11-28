import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { rateLimit } from '../../config/rate-limit.js';
import { supportedCountryCodeSchema } from '../countries.js';
import {
  AuthenticationError,
  ConflictError,
  registerUser,
  signInUser
} from './auth.service.js';
import { authenticate } from './auth.utils.js';
import {
  isTrustedCookieMutationRequest,
  serializeSessionCookie,
  sessionCookieName
} from './auth.cookies.js';
import { env } from '../../config/env.js';
import { revokeUserSession } from './auth.repository.js';
import { recordAccountIp } from '../account-deletion/account-deletion.ip.js';
import { disconnectUser } from '../../realtime/realtime.hub.js';
import { realtimeBus } from '../../realtime/realtime.bus.js';

function isSecureCookieRequest(request: FastifyRequest) {
  if (env.COOKIE_SECURE !== undefined) return env.COOKIE_SECURE;
  return request.protocol === 'https' || (env.NODE_ENV === 'production' && !env.STAGING_PUBLIC_IP);
}

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, accessToken: string) {
  // trustProxy resolves the public protocol when Caddy terminates TLS.
  reply.header('set-cookie', serializeSessionCookie(accessToken, isSecureCookieRequest(request)));
}

function clearSessionCookie(request: FastifyRequest, reply: FastifyReply) {
  reply.header('set-cookie', serializeSessionCookie(null, isSecureCookieRequest(request)));
}

function responseForClient(request: FastifyRequest, result: { user: unknown; accessToken: string; tokenType: string; expiresIn: string }) {
  if (request.headers['x-auth-mode'] === 'cookie') {
    return { user: result.user };
  }
  return result;
}

const maxBcryptBytes = 72;
const usernamePattern = /^[a-z0-9_][a-z0-9_.]{2,29}$/i;
const registerSchema = z.object({
  email: z.string().trim().email().max(320),
  username: z.string().trim().min(3).max(30).regex(usernamePattern),
  password: z.string().min(8).max(128).refine(
    (value) => Buffer.byteLength(value, 'utf8') <= maxBcryptBytes,
    'Password must be 72 UTF-8 bytes or fewer.'
  ),
  countryCode: z.string().trim().toUpperCase().pipe(supportedCountryCodeSchema),
  displayName: z.string().trim().min(1).max(80).optional()
}).strict();

const loginSchema = z.object({
  login: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(128).refine(
    (value) => Buffer.byteLength(value, 'utf8') <= maxBcryptBytes,
    'Password must be 72 UTF-8 bytes or fewer.'
  )
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
    windowMs: 15 * 60_000,
    fallbackToMemory: true
  }) }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const parsedBody = registerSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return validationError(reply, parsedBody.error);
    }

    try {
      const result = await registerUser(app, parsedBody.data);
      await recordAccountIp(result.user.id, request.ip);

      setSessionCookie(request, reply, result.accessToken);
      return reply.status(201).send(responseForClient(request, result));
    } catch (error) {
      return authError(reply, error);
    }
  });

  app.post('/auth/login', { preHandler: [
    rateLimit({
      keyPrefix: 'auth-login',
      limit: 10,
      windowMs: 15 * 60_000,
      fallbackToMemory: true
    }),
    rateLimit({
      keyPrefix: 'auth-login-account',
      limit: 10,
      windowMs: 15 * 60_000,
      fallbackToMemory: true,
      keyValue: (request) => {
        const body = request.body as { login?: unknown } | undefined;
        return typeof body?.login === 'string' && body.login.trim().length > 0
          ? body.login.trim().toLowerCase()
          : undefined;
      }
    })
  ] }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const parsedBody = loginSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return validationError(reply, parsedBody.error);
    }

    try {
      const result = await signInUser(app, parsedBody.data);
      await recordAccountIp(result.user.id, request.ip);
      setSessionCookie(request, reply, result.accessToken);
      return responseForClient(request, result);
    } catch (error) {
      return authError(reply, error);
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const hasCookieSession = Boolean(request.cookies?.[sessionCookieName]);
    const usesBearer = /^Bearer\s/i.test(request.headers.authorization ?? '');
    if (
      hasCookieSession &&
      !usesBearer &&
      !isTrustedCookieMutationRequest(request.headers, env.CORS_ORIGINS, env.STAGING_PUBLIC_IP)
    ) {
      return reply.status(403).send({
        error: 'csrf_origin_rejected',
        message: 'The request origin is not trusted.'
      });
    }
    try {
      await request.jwtVerify();
    } catch {
      // Logout stays idempotent for missing, expired, or malformed sessions.
    }
    if (request.user?.sub) {
      await revokeUserSession(request.user.sub, request.user.sessionVersion);
      disconnectUser(request.user.sub, 'session_revoked');
      void realtimeBus
        .publish(request.user.sub, { type: 'session.revoked', payload: { userId: request.user.sub, reason: 'logout' } })
        .catch(() => undefined);
    }
    clearSessionCookie(request, reply);
    return reply.status(204).send();
  });

  app.get(
    '/auth/me',
    {
      preHandler: authenticate
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('cache-control', 'no-store');
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
