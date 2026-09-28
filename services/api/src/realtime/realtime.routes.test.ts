import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import Fastify from 'fastify';
import websocket from '@fastify/websocket';

import { getNotificationMetrics } from '../modules/notifications/notifications.metrics.js';
import { env } from '../config/env.js';
import {
  createRealtimeHandshakePreHandlers,
  createRealtimeHandshakeRateLimit,
  getRealtimeAuthMode,
  isAllowedRealtimeOrigin,
  isRealtimeTokenInQuery,
  redactRealtimeLogFields,
  registerRealtimeRoutes
} from './realtime.routes.js';

test('realtime handshake accepts cookie sessions only from an allowed Origin', () => {
  assert.equal(isAllowedRealtimeOrigin('https://web.example.com', 'https://web.example.com'), true);
  assert.equal(isAllowedRealtimeOrigin('https://evil.example', 'https://web.example.com'), false);
  assert.equal(isAllowedRealtimeOrigin(undefined, 'https://web.example.com'), false);
  assert.equal(getRealtimeAuthMode({ headers: { cookie: 'yaskapp_session=session' } }), 'cookie');
});

test('realtime handshake accepts bearer auth and rejects token query parameters', () => {
  assert.equal(getRealtimeAuthMode({ headers: { authorization: 'Bearer access-token' } }), 'bearer');
  assert.equal(isRealtimeTokenInQuery('/realtime?token=access-token'), true);
  assert.equal(isRealtimeTokenInQuery('/realtime'), false);
});

test('realtime handshake has a dedicated rate limit policy', () => {
  const { keyPrefix, limit, windowMs, keyBy } = createRealtimeHandshakeRateLimit();
  assert.deepEqual({ keyPrefix, limit, windowMs, keyBy }, {
    keyPrefix: 'realtime-handshake',
    limit: 20,
    windowMs: 60_000,
    keyBy: 'ip'
  });
});

test('rate-limit metrics count rejected handshakes, not successful ones', () => {
  const before = getNotificationMetrics().rateLimitResponses;
  const options = createRealtimeHandshakeRateLimit();
  options.onResponse?.(200);
  assert.equal(getNotificationMetrics().rateLimitResponses, before);

  options.onResponse?.(429);
  assert.equal(getNotificationMetrics().rateLimitResponses, before + 1);
});

test('rate limiting runs before auth for unauthenticated and rejected handshakes', async () => {
  const calls: string[] = [];
  let rateLimitCalls = 0;
  const rateLimit = async (_request: never, reply: { status: (code: number) => typeof reply; send: (body: unknown) => unknown }) => {
    calls.push('rate-limit');
    rateLimitCalls += 1;
    if (rateLimitCalls > 1) return reply.status(429).send({ error: 'rate_limit_exceeded' });
  };
  const authenticate = async (_request: never, reply: { status: (code: number) => typeof reply; send: (body: unknown) => unknown }) => {
    calls.push('authenticate');
    return reply.status(401).send({ error: 'unauthorized' });
  };
  const handlers = createRealtimeHandshakePreHandlers(rateLimit as never, authenticate as never);
  const request = { url: '/realtime', headers: {} } as never;
  const run = async () => {
    const response = { statusCode: 200, body: undefined as unknown, sent: false };
    const reply = {
      status(code: number) { response.statusCode = code; return this; },
      send(body: unknown) { response.body = body; response.sent = true; return body; }
    };
    for (const handler of handlers) {
      await handler(request, reply as never);
      if (response.sent) break;
    }
    return response;
  };

  const unauthenticated = await run();
  const rateLimited = await run();

  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(rateLimited.statusCode, 429);
  assert.deepEqual(calls, ['rate-limit', 'authenticate', 'rate-limit']);
});

test('handshake rejects query tokens and cookie auth without an Origin', async () => {
  const authCalls: string[] = [];
  const rateLimit = async () => undefined;
  const authenticate = async (_request: never, reply: { status: (code: number) => typeof reply; send: (body: unknown) => unknown }) => {
    authCalls.push('authenticate');
    return reply.status(200).send({ ok: true });
  };
  const handlers = createRealtimeHandshakePreHandlers(rateLimit as never, authenticate as never);
  const run = async (url: string, headers: Record<string, string>) => {
    const response = { statusCode: 200, body: undefined as unknown, sent: false };
    const reply = {
      status(code: number) { response.statusCode = code; return this; },
      send(body: unknown) { response.body = body; response.sent = true; return body; }
    };
    for (const handler of handlers) {
      await handler({ url, headers } as never, reply as never);
      if (response.sent) break;
    }
    return response;
  };

  const queryToken = await run('/realtime?token=secret', { authorization: 'Bearer access-token' });
  const missingOrigin = await run('/realtime', { cookie: 'yaskapp_session=session' });

  assert.equal(queryToken.statusCode, 401);
  assert.equal(missingOrigin.statusCode, 403);
  assert.deepEqual(authCalls, []);
});

test('registered realtime route enforces handshake auth, Origin, and rate limiting', async (context) => {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  context.after(async () => {
    for (const socket of app.websocketServer.clients) socket.terminate();
    await app.close();
  });
  let authCalls = 0;
  let rateLimitCalls = 0;
  const rateLimit = async (request: never, reply: { status: (code: number) => typeof reply; send: (body: unknown) => unknown }) => {
    rateLimitCalls += 1;
    if ((request as unknown as { headers: Record<string, string> }).headers['x-test-rate-limit'] === 'deny') {
      return reply.status(429).send({ error: 'rate_limit_exceeded' });
    }
  };
  const authenticate = async (request: never, reply: { status: (code: number) => typeof reply; send: (body: unknown) => unknown }) => {
    authCalls += 1;
    const headers = (request as unknown as { headers: Record<string, string | undefined> }).headers;
    if (headers.authorization !== 'Bearer test-token' && !headers.cookie?.includes('yaskapp_session=session')) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
    (request as unknown as { user: { sub: string } }).user = { sub: 'route-test-user' };
  };
  registerRealtimeRoutes(app, createRealtimeHandshakePreHandlers(rateLimit as never, authenticate as never));
  await app.ready();

  const configuredOrigins = env.CORS_ORIGINS;
  const allowedOrigin = configuredOrigins === '*'
    ? 'http://localhost:5173'
    : configuredOrigins.split(',').map((origin) => origin.trim()).find(Boolean);
  assert.ok(allowedOrigin);

  let readyMessagePromise: Promise<[Buffer]> | undefined;
  const cookieAuth = await app.injectWS('/realtime', {
    headers: { origin: allowedOrigin, cookie: 'yaskapp_session=session' }
  }, {
    onOpen: (socket) => { readyMessagePromise = once(socket, 'message') as Promise<[Buffer]>; }
  });
  assert.ok(readyMessagePromise);
  const [readyMessage] = await readyMessagePromise;
  assert.deepEqual(JSON.parse(readyMessage.toString()), { version: 1, type: 'connection.ready' });
  const cookieClosed = once(cookieAuth, 'close');
  cookieAuth.close();
  await cookieClosed;

  const bearerAuth = await app.injectWS('/realtime', {
    headers: { authorization: 'Bearer test-token' }
  });
  const bearerClosed = once(bearerAuth, 'close');
  bearerAuth.close();
  await bearerClosed;

  const authCallsBeforeRejectedRequests = authCalls;
  await assert.rejects(
    app.injectWS('/realtime?token=secret', { headers: { authorization: 'Bearer test-token' } }),
    /Unexpected server response: 401/
  );
  await assert.rejects(
    app.injectWS('/realtime', { headers: { cookie: 'yaskapp_session=session' } }),
    /Unexpected server response: 403/
  );
  await assert.rejects(app.injectWS('/realtime'), /Unexpected server response: 401/);
  await assert.rejects(
    app.injectWS('/realtime', { headers: { 'x-test-rate-limit': 'deny' } }),
    /Unexpected server response: 429/
  );

  assert.equal(authCalls, authCallsBeforeRejectedRequests + 1);
  assert.equal(rateLimitCalls, 6);
});

test('realtime log fields redact payloads, comment bodies, cookies and tokens', () => {
  const fields = redactRealtimeLogFields({
    recipientUserId: 'user-1',
    notification: { payload: { body: 'private comment' } },
    commentBody: 'private comment',
    cookie: 'yaskapp_session=secret',
    token: 'secret-token',
    authorization: 'Bearer secret-token',
    reason: 'idle_timeout'
  });

  assert.deepEqual(fields, {
    recipientUserId: 'user-1',
    reason: 'idle_timeout'
  });
});
