import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.NODE_ENV = 'test';

const [{ buildApp }, { closeDatabaseConnection, db }, { closeRedisConnection }, { closeStorageConnection }] = await Promise.all([
  import('../../app.js'),
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('../../config/storage.js')
]);

const app = buildApp();
const createdUserIds = new Set<string>();

function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

test('registration establishes an HttpOnly cookie session without exposing the JWT', async () => {
  const username = `cookie_${uniqueSuffix()}`;
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: { 'x-auth-mode': 'cookie' },
    payload: {
      email: `${username}@yaskapp.test`,
      username,
      password: 'password123',
      countryCode: 'BY'
    }
  });

  assert.equal(response.statusCode, 201, response.body);
  const body = response.json<Record<string, unknown>>();
  assert.equal('accessToken' in body, false);
  assert.match(String(response.headers['set-cookie'] ?? ''), /yaskapp_session=/);
  assert.match(String(response.headers['set-cookie'] ?? ''), /HttpOnly/i);
  createdUserIds.add((body.user as { id: string }).id);

  const cookie = String(response.headers['set-cookie']).split(';', 1)[0] ?? '';
  const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
});

test('logout clears the cookie session and mutating cookie requests require a trusted origin', async () => {
  const username = `cookie_${uniqueSuffix()}`;
  const registerResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: { 'x-auth-mode': 'cookie' },
    payload: {
      email: `${username}@yaskapp.test`,
      username,
      password: 'password123',
      countryCode: 'BY'
    }
  });
  assert.equal(registerResponse.statusCode, 201, registerResponse.body);
  const body = registerResponse.json<{ user: { id: string } }>();
  createdUserIds.add(body.user.id);
  const cookie = String(registerResponse.headers['set-cookie']).split(';', 1)[0] ?? '';

  const csrfResponse = await app.inject({
    method: 'POST',
    url: '/users/00000000-0000-0000-0000-000000000000/follow',
    headers: { cookie, origin: 'https://evil.example' }
  });
  assert.equal(csrfResponse.statusCode, 403, csrfResponse.body);

  const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
  assert.equal(logout.statusCode, 204, logout.body);
  assert.match(String(logout.headers['set-cookie'] ?? ''), /yaskapp_session=/);

  const afterLogout = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
  assert.equal(afterLogout.statusCode, 401, afterLogout.body);
});

after(async () => {
  for (const userId of createdUserIds) {
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
  }
  await app.close();
  await closeDatabaseConnection();
  await closeRedisConnection();
  closeStorageConnection();
});
