import type { FastifyInstance } from 'fastify';

import { addRealtimeClient } from './realtime.hub.js';
import { handleRealtimeMessage } from './realtime.hub.js';
import { authenticate } from '../modules/auth/auth.utils.js';
import { isTrustedOrigin, sessionCookieName } from '../modules/auth/auth.cookies.js';
import { env } from '../config/env.js';
import { rateLimit, type RateLimitOptions } from '../config/rate-limit.js';
import { recordRateLimitResponse } from '../modules/notifications/notifications.metrics.js';

export function isAllowedRealtimeOrigin(origin: string | undefined, configuredOrigins: string) {
  return isTrustedOrigin(origin, configuredOrigins);
}

export function isRealtimeTokenInQuery(url: string) {
  return new URL(url, 'http://localhost').searchParams.has('token');
}

export function getRealtimeAuthMode(request: { headers?: { authorization?: string; cookie?: string } }) {
  if (/^Bearer\s/i.test(request.headers?.authorization ?? '')) return 'bearer' as const;
  if (request.headers?.cookie?.includes(`${sessionCookieName}=`)) return 'cookie' as const;
  return 'none' as const;
}

export function createRealtimeHandshakeRateLimit(): RateLimitOptions {
  return { keyPrefix: 'realtime-handshake', limit: 20, windowMs: 60_000, keyBy: 'ip' };
}

export function redactRealtimeLogFields(fields: Record<string, unknown>) {
  const safeKeys = new Set(['recipientUserId', 'reason', 'statusCode', 'authMode']);
  return Object.fromEntries(Object.entries(fields).filter(([key]) => safeKeys.has(key)));
}

async function validateRealtimeHandshake(request: Parameters<typeof authenticate>[0], reply: Parameters<typeof authenticate>[1]) {
  if (isRealtimeTokenInQuery(request.url)) {
    return reply.status(401).send({ error: 'unauthorized', message: 'Authentication is required.' });
  }
  if (getRealtimeAuthMode(request) === 'cookie' && !isAllowedRealtimeOrigin(request.headers.origin, env.CORS_ORIGINS)) {
    return reply.status(403).send({ error: 'csrf_origin_rejected', message: 'The request origin is not trusted.' });
  }
}

const realtimeHandshakeRateLimit = rateLimit({
  ...createRealtimeHandshakeRateLimit(),
  skipInTest: false,
  onResponse: () => recordRateLimitResponse()
});

export function registerRealtimeRoutes(app: FastifyInstance) {
  app.get('/realtime', { websocket: true, preHandler: [validateRealtimeHandshake, authenticate, realtimeHandshakeRateLimit] }, (connection, request) => {
    const removeClient = addRealtimeClient(connection.socket, request.user.sub);

    connection.socket.on('message', (message: Buffer | ArrayBuffer | string) => {
      handleRealtimeMessage(connection.socket, message);
    });

    connection.socket.on('close', () => removeClient('client_close'));
    connection.socket.on('error', () => removeClient('socket_error'));
  });
}
