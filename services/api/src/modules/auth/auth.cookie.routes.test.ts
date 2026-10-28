import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { parseCookieHeader } from './auth.cookies.js';
import { hashPassword } from './password.js';

process.env.NODE_ENV = 'test';
process.env.STAGING_PUBLIC_IP = '5.44.44.197';

const [{ env }, { registerAuthRoutes }, { db }, { getCurrentUser }, { registerPollRoutes }] = await Promise.all([
  import('../../config/env.js'),
  import('./auth.routes.js'),
  import('../../config/database.js'),
  import('./auth.utils.js'),
  import('../polls/polls.routes.js')
]);

test('a production login stays authenticated over HTTP and HTTPS cookie sessions', async (context) => {
  const previousEnvironment = env.NODE_ENV;
  env.NODE_ENV = 'production';
  const account = {
    id: '00000000-0000-4000-8000-000000000001', email: 'member@yaskapp.test', username: 'member',
    password_hash: await hashPassword('password123'), status: 'active', session_version: 2, role: 'user',
    created_at: new Date('2026-10-01'), updated_at: new Date('2026-10-01'), display_name: 'Member',
    bio: null, country_code: 'BY', avatar_object_key: null, polls_count: 0, followers_count: 0, following_count: 0,
  };
  // Only the unavailable database transport is replaced; password, JWT,
  // repository mapping, and authentication handlers run normally.
  context.mock.method(db, 'query', async (sql: string, parameters: unknown[]) => {
    if (sql.includes('FROM users u')) {
      assert.ok(parameters[0] === account.username || parameters[0] === account.id);
      return { rows: [account] };
    }
    assert.equal(parameters[0], account.id);
    if (sql.includes('INSERT INTO account_ip_history')) return { rows: [], rowCount: 1 };
    if (sql.includes('SET session_version = session_version + 1')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM sanctions') || sql.startsWith('UPDATE users SET last_seen_at')) return { rows: [] };
    if (sql.startsWith('SELECT session_version FROM users')) return { rows: [{ session_version: 2 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const app = Fastify({ trustProxy: true });
  context.after(async () => {
    env.NODE_ENV = previousEnvironment;
    await app.close();
  });
  await app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: 'yaskapp_session', signed: false } });
  await app.register(multipart);
  app.addHook('onRequest', async (request) => { request.cookies = parseCookieHeader(request.headers.cookie); });
  app.decorateRequest('getCurrentUser', function () { return getCurrentUser(this); });
  registerAuthRoutes(app);
  registerPollRoutes(app);

  for (const protocol of ['http', 'https'] as const) {
    const login = await app.inject({
      method: 'POST', url: '/auth/login',
      headers: { 'x-auth-mode': 'cookie', 'x-forwarded-proto': protocol },
      payload: { login: 'member', password: 'password123' }
    });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal('accessToken' in login.json(), false);
    const cookie = String(login.headers['set-cookie']);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.equal(cookie.includes('; Secure'), protocol === 'https', `${protocol}: cookie protocol mismatch`);
    const me = await app.inject({
      method: 'GET', url: '/auth/me',
      headers: { cookie: cookie.split(';', 1)[0], 'x-forwarded-proto': protocol }
    });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().user.id, account.id);

    // An invalid body reaches poll validation only after the real cookie/JWT
    // authentication and CSRF checks accept the public staging origin.
    const poll = await app.inject({
      method: 'POST', url: '/polls', payload: {},
      headers: { cookie: cookie.split(';', 1)[0], origin: 'http://5.44.44.197', 'x-forwarded-proto': protocol }
    });
    assert.equal(poll.statusCode, 400, poll.body);
    assert.equal(poll.json().error, 'validation_error');

    const rejectedPoll = await app.inject({
      method: 'POST', url: '/polls', payload: {},
      headers: { cookie: cookie.split(';', 1)[0], origin: 'https://evil.example', 'x-forwarded-proto': protocol }
    });
    assert.equal(rejectedPoll.statusCode, 403, rejectedPoll.body);
    assert.equal(rejectedPoll.json().error, 'csrf_origin_rejected');

    const logout = await app.inject({
      method: 'POST', url: '/auth/logout',
      headers: { cookie: cookie.split(';', 1)[0], origin: 'http://5.44.44.197', 'x-forwarded-proto': protocol }
    });
    assert.equal(logout.statusCode, 204, logout.body);
  }
});

test('production cookie attributes follow the public protocol behind the proxy', async (context) => {
  const previousEnvironment = env.NODE_ENV;
  env.NODE_ENV = 'production';
  const app = Fastify({ trustProxy: true });
  registerAuthRoutes(app);
  context.after(async () => {
    env.NODE_ENV = previousEnvironment;
    await app.close();
  });

  for (const protocol of ['http', 'https'] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { 'x-forwarded-proto': protocol }
    });
    assert.equal(response.statusCode, 204);
    const cookie = String(response.headers['set-cookie']);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=0/);
    assert.equal(cookie.includes('; Secure'), protocol === 'https', `${protocol}: ${cookie}`);
  }
});
