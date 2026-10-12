import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

process.env.NODE_ENV = 'test';

const [
  { env },
  { db },
  { redis },
  { registerAccountDeletionRoutes },
  { registerAuthRoutes },
  { getCurrentUser },
  { parseCookieHeader },
  { hashPassword }
] = await Promise.all([
  import('../../config/env.js'),
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('./account-deletion.routes.js'),
  import('../auth/auth.routes.js'),
  import('../auth/auth.utils.js'),
  import('../auth/auth.cookies.js'),
  import('../auth/password.js')
]);

type Account = {
  id: string;
  email: string;
  username: string;
  password: string;
  password_hash: string;
  status: 'active' | 'blocked' | 'deleted';
  session_version: number;
  role: 'user';
  created_at: Date;
  updated_at: Date;
  display_name: string;
  bio: null;
  country_code: string;
  avatar_object_key: null;
  polls_count: number;
  followers_count: number;
  following_count: number;
};

function installDatabase(context: TestContext) {
  const accounts = new Map<string, Account>();
  const operations = new Map<string, { id: string; user_id: string; status: string; accepted_at: Date | null; deadline_at: Date | null; completed_at: Date | null }>();
  const permissions = new Map<string, { operation_id: string; user_id: string; scope: 'delete' | 'status'; expires_at: Date; consumed_at: null }>();
  const rateLimitCounts = new Map<string, number>();

  context.mock.method(redis, 'eval', async (script: string, _keyCount: number, accountKey: string, ipKey: string, limit: number) => {
    if (script.includes('local accountCount')) {
      const accountCount = rateLimitCounts.get(accountKey) ?? 0;
      const ipCount = rateLimitCounts.get(ipKey) ?? 0;
      if (accountCount >= limit || ipCount >= limit) return [0, failedWindowMs];
      rateLimitCounts.set(accountKey, accountCount + 1);
      rateLimitCounts.set(ipKey, ipCount + 1);
      return [1, failedWindowMs];
    }
    if (script.includes("redis.call('DECR'")) {
      for (const key of [accountKey, ipKey]) {
        const next = (rateLimitCounts.get(key) ?? 0) - 1;
        if (next <= 0) rateLimitCounts.delete(key);
        else rateLimitCounts.set(key, next);
      }
      return 1;
    }
    throw new Error('Unexpected rate limit script.');
  });

  context.mock.method(db, 'query', async (sql: string, parameters: unknown[]) => {
    if (sql.includes('FROM users u')) {
      const key = String(parameters[0]);
      const account = accounts.get(key) ?? [...accounts.values()].find((item) => item.username.toLowerCase() === key || item.email.toLowerCase() === key);
      return { rows: account ? [account] : [] };
    }
    if (sql.startsWith('SELECT session_version FROM users')) {
      const account = accounts.get(String(parameters[0]));
      return { rows: account ? [{ session_version: account.session_version }] : [] };
    }
    if (sql.startsWith('UPDATE users SET last_seen_at')) return { rows: [] };
    if (sql.includes('FROM account_deletion_permissions permission')) {
      const permission = permissions.get(String(parameters[0]));
      return { rows: permission && permission.scope === parameters[1] && permission.expires_at > new Date() ? [permission] : [] };
    }
    if (sql.includes('FROM account_deletion_operations WHERE id = $1')) {
      const operation = operations.get(String(parameters[0]));
      return { rows: operation ? [operation] : [] };
    }
    throw new Error(`Unexpected database query: ${sql}`);
  });

  context.mock.method(db, 'connect', async () => ({
    async query(sql: string, parameters: unknown[]) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT id FROM users WHERE id = $1 FOR UPDATE')) {
        return { rows: accounts.has(String(parameters[0])) ? [{ id: parameters[0] }] : [] };
      }
      if (sql.includes('SELECT id, status, accepted_at, deadline_at, completed_at FROM account_deletion_operations')) {
        const existing = [...operations.values()].find((item) => item.user_id === parameters[0] && item.status !== 'not_started');
        return { rows: existing ? [existing] : [] };
      }
      if (sql.includes("DELETE FROM account_deletion_operations WHERE user_id = $1 AND status = 'not_started'")) {
        for (const [id, operation] of operations) {
          if (operation.user_id === parameters[0] && operation.status === 'not_started') operations.delete(id);
        }
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO account_deletion_operations')) {
        const operation = {
          id: randomUUID(), user_id: String(parameters[0]), status: 'not_started',
          accepted_at: null, deadline_at: null, completed_at: null
        };
        operations.set(operation.id, operation);
        return { rows: [operation] };
      }
      if (sql.includes('INSERT INTO account_deletion_permissions')) {
        const [operationId, deletionHash, deletionExpiry, statusHash, statusExpiry] = parameters as [string, string, Date, string, Date];
        const operation = operations.get(operationId)!;
        permissions.set(deletionHash, { operation_id: operationId, user_id: operation.user_id, scope: 'delete', expires_at: deletionExpiry, consumed_at: null });
        permissions.set(statusHash, { operation_id: operationId, user_id: operation.user_id, scope: 'status', expires_at: statusExpiry, consumed_at: null });
        return { rows: [] };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
    release() {}
  } as never));

  return {
    storedPermissionHashes: () => [...permissions.keys()],
    async createAccount(status: Account['status'] = 'active') {
      const id = randomUUID();
      const username = `deletion_${id.slice(0, 12).replaceAll('-', '_')}`;
      const password = 'correct-horse-123';
      const account: Account = {
        id, email: `${id}@yaskapp.test`, username, password,
        password_hash: await hashPassword(password), status, session_version: 0, role: 'user',
        created_at: new Date('2026-10-01T00:00:00.000Z'), updated_at: new Date('2026-10-01T00:00:00.000Z'),
        display_name: username, bio: null, country_code: 'BY', avatar_object_key: null,
        polls_count: 0, followers_count: 0, following_count: 0
      };
      accounts.set(id, account);
      return account;
    }
  };
}

async function makeApp() {
  const app = Fastify({ trustProxy: true });
  await app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: 'yaskapp_session', signed: false } });
  app.addHook('onRequest', async (request) => { request.cookies = parseCookieHeader(request.headers.cookie); });
  app.decorateRequest('getCurrentUser', function () { return getCurrentUser(this); });
  registerAuthRoutes(app);
  registerAccountDeletionRoutes(app);
  await app.ready();
  return app;
}

async function bearerFor(app: Awaited<ReturnType<typeof makeApp>>, account: Account) {
  return app.jwt.sign({ sub: account.id, username: account.username, sessionVersion: account.session_version }, { expiresIn: '7d' });
}

function enableDeletion(context: TestContext) {
  const wasEnabled = env.ACCOUNT_DELETION_ENABLED;
  env.ACCOUNT_DELETION_ENABLED = true;
  context.after(() => { env.ACCOUNT_DELETION_ENABLED = wasEnabled; });
}

test('wrong_password_preserves_session', async (context) => {
  enableDeletion(context);
  const fakeDb = installDatabase(context);
  const account = await fakeDb.createAccount();
  const app = await makeApp();
  context.after(() => app.close());
  const accessToken = await bearerFor(app, account);

  const verification = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { password: 'incorrect-password' }
  });

  assert.equal(verification.statusCode, 401);
  assert.deepEqual(verification.json(), { error: 'unauthorized', message: 'Invalid login or password.' });
  const session = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(session.statusCode, 200, session.body);
  assert.equal(session.json().user.id, account.id);
});

test('blocked_user_gets_only_deletion_scope', async (context) => {
  enableDeletion(context);
  const fakeDb = installDatabase(context);
  const account = await fakeDb.createAccount('blocked');
  const app = await makeApp();
  context.after(() => app.close());
  const staleCookie = await bearerFor(app, account);

  const verification = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    headers: { cookie: `yaskapp_session=${staleCookie}`, origin: 'http://localhost:5173' },
    payload: { login: account.username, password: account.password }
  });

  assert.equal(verification.statusCode, 200, verification.body);
  const body = verification.json<{ status: string; deletionToken: string; statusToken: string; accessToken?: string }>();
  assert.equal(body.status, 'not_started');
  assert.ok(body.deletionToken);
  assert.ok(body.statusToken);
  assert.equal(body.accessToken, undefined);
  assert.ok(fakeDb.storedPermissionHashes().includes(createHash('sha256').update(body.deletionToken).digest('hex')));
  assert.ok(fakeDb.storedPermissionHashes().includes(createHash('sha256').update(body.statusToken).digest('hex')));
  assert.ok(!fakeDb.storedPermissionHashes().includes(body.deletionToken));
  assert.ok(!fakeDb.storedPermissionHashes().includes(body.statusToken));
  const ordinarySession = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${body.deletionToken}` } });
  assert.equal(ordinarySession.statusCode, 401);
});

test('status_token_cannot_delete', async (context) => {
  enableDeletion(context);
  const fakeDb = installDatabase(context);
  const account = await fakeDb.createAccount();
  const app = await makeApp();
  context.after(() => app.close());
  const accessToken = await bearerFor(app, account);
  const verification = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    headers: { authorization: `Bearer ${accessToken}` }, payload: { password: account.password }
  });
  assert.equal(verification.statusCode, 200, verification.body);
  const statusToken = verification.json<{ statusToken: string }>().statusToken;

  const status = await app.inject({ method: 'GET', url: '/auth/account-deletion/status', headers: { authorization: `Bearer ${statusToken}` } });
  assert.equal(status.statusCode, 200, status.body);
  assert.equal(status.json().operationId, verification.json().operationId);
  const ordinarySession = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${statusToken}` } });
  assert.equal(ordinarySession.statusCode, 401);
  const { getDeletionPermission } = await import('./account-deletion.repository.js');
  assert.equal(await getDeletionPermission(createHash('sha256').update(statusToken).digest('hex'), 'delete'), null);
});

test('token_expiry_10m_48h', async () => {
  const { buildDeletionTokenPair } = await import('./account-deletion.verification.js');
  const fixedNow = new Date('2026-10-12T09:30:00.000Z');
  const pair = buildDeletionTokenPair(fixedNow);
  assert.equal(pair.deletionTokenExpiresAt.toISOString(), '2026-10-12T09:40:00.000Z');
  assert.equal(pair.statusTokenExpiresAt.toISOString(), '2026-10-14T09:30:00.000Z');
});

test('fifth_failure_rate_limits', async (context) => {
  enableDeletion(context);
  const fakeDb = installDatabase(context);
  const account = await fakeDb.createAccount();
  const app = await makeApp();
  context.after(() => app.close());

  const attempts = [];
  for (let index = 0; index < 6; index += 1) {
    attempts.push(await app.inject({
      method: 'POST', url: '/auth/account-deletion/verification',
      headers: { 'x-forwarded-for': `192.0.2.${index + 41}` },
      payload: { login: account.username, password: 'wrong-password' }
    }));
  }

  assert.deepEqual(attempts.slice(0, 5).map((response) => response.statusCode), [401, 401, 401, 401, 401]);
  assert.equal(attempts[5].statusCode, 429, attempts[5].body);
  assert.ok(Number(attempts[5].headers['retry-after']) >= 1);
});

test('ip_failure_rate_limit_applies_across_accounts', async (context) => {
  enableDeletion(context);
  const fakeDb = installDatabase(context);
  const accounts = await Promise.all(Array.from({ length: 6 }, () => fakeDb.createAccount()));
  const app = await makeApp();
  context.after(() => app.close());

  const attempts = [];
  for (const account of accounts) {
    attempts.push(await app.inject({
      method: 'POST', url: '/auth/account-deletion/verification',
      headers: { 'x-forwarded-for': '192.0.2.77' },
      payload: { login: account.username, password: 'wrong-password' }
    }));
  }
  assert.deepEqual(attempts.slice(0, 5).map((response) => response.statusCode), [401, 401, 401, 401, 401]);
  assert.equal(attempts[5].statusCode, 429, attempts[5].body);
  assert.ok(Number(attempts[5].headers['retry-after']) >= 1);
});

test('untrusted_cookie_origin_rejected', async (context) => {
  enableDeletion(context);
  const fakeDb = installDatabase(context);
  const account = await fakeDb.createAccount();
  const app = await makeApp();
  context.after(() => app.close());
  const accessToken = await bearerFor(app, account);

  const verification = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    headers: { cookie: `yaskapp_session=${accessToken}`, origin: 'https://evil.example' },
    payload: { password: account.password }
  });

  assert.equal(verification.statusCode, 403);
  assert.equal(verification.json().error, 'csrf_origin_rejected');
});

test('disabled_flag_blocks_new_verification', async (context) => {
  const wasEnabled = env.ACCOUNT_DELETION_ENABLED;
  env.ACCOUNT_DELETION_ENABLED = true;
  context.after(() => { env.ACCOUNT_DELETION_ENABLED = wasEnabled; });
  const fakeDb = installDatabase(context);
  const account = await fakeDb.createAccount();
  const app = await makeApp();
  context.after(() => app.close());
  const accessToken = await bearerFor(app, account);
  const receipt = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    headers: { authorization: `Bearer ${accessToken}` }, payload: { password: account.password }
  });
  assert.equal(receipt.statusCode, 200, receipt.body);
  const statusToken = receipt.json<{ statusToken: string }>().statusToken;
  env.ACCOUNT_DELETION_ENABLED = false;

  const verification = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    headers: { authorization: `Bearer ${accessToken}` }, payload: { password: account.password }
  });
  assert.equal(verification.statusCode, 503);
  assert.equal(verification.json().error, 'account_deletion_disabled');
  const status = await app.inject({ method: 'GET', url: '/auth/account-deletion/status', headers: { authorization: `Bearer ${statusToken}` } });
  assert.equal(status.statusCode, 200, status.body);
});

test('unknown_login_and_wrong_password_share_the_same_credential_error', async (context) => {
  enableDeletion(context);
  const fakeDb = installDatabase(context);
  const account = await fakeDb.createAccount();
  const app = await makeApp();
  context.after(() => app.close());

  const missingAccount = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    payload: { login: 'nobody_123', password: 'incorrect-password' }
  });
  const wrongPassword = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    payload: { login: account.username, password: 'incorrect-password' }
  });

  assert.equal(missingAccount.statusCode, 401);
  assert.equal(wrongPassword.statusCode, 401);
  assert.deepEqual(missingAccount.json(), wrongPassword.json());
});

test('administratively_deleted_account_is_not_migrated_into_self_service_deletion', async (context) => {
  enableDeletion(context);
  const fakeDb = installDatabase(context);
  const account = await fakeDb.createAccount('deleted');
  const app = await makeApp();
  context.after(() => app.close());

  const verification = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    payload: { login: account.username, password: account.password }
  });

  assert.equal(verification.statusCode, 401);
  assert.deepEqual(verification.json(), { error: 'unauthorized', message: 'Invalid login or password.' });
});

const failedWindowMs = 15 * 60_000;
