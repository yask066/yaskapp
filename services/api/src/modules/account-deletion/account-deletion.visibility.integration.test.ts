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

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function registerUser() {
  const username = `ad05_${uniqueSuffix()}`;
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `${username}@yaskapp.test`,
      username,
      password: 'password123',
      displayName: 'Deletion Visibility User',
      countryCode: 'BY'
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  const result = response.json<{ user: { id: string; username: string }; accessToken: string }>();
  createdUserIds.add(result.user.id);
  return result;
}

test('bearer_cookie_optional_auth_all_rejected after account session version changes', async () => {
  const user = await registerUser();
  const cookieRegistration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: { 'x-auth-mode': 'cookie' },
    payload: {
      email: `cookie_${uniqueSuffix()}@yaskapp.test`,
      username: `cookie_${uniqueSuffix()}`,
      password: 'password123',
      countryCode: 'BY'
    }
  });
  assert.equal(cookieRegistration.statusCode, 201, cookieRegistration.body);
  const cookieUser = cookieRegistration.json<{ user: { id: string } }>();
  createdUserIds.add(cookieUser.user.id);
  const cookie = String(cookieRegistration.headers['set-cookie']).split(';', 1)[0] ?? '';

  await db.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [user.user.id]);
  await db.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [cookieUser.user.id]);

  const bearerResult = await app.inject({ method: 'GET', url: '/auth/me', headers: bearer(user.accessToken) });
  const cookieResult = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
  const optionalResult = await app.inject({ method: 'GET', url: '/polls', headers: bearer(user.accessToken) });

  assert.equal(bearerResult.statusCode, 401, bearerResult.body);
  assert.equal(cookieResult.statusCode, 401, cookieResult.body);
  assert.equal(optionalResult.statusCode, 401, optionalResult.body);
});

test('deleted_owner_hidden_before_purge from profile and direct media URLs', async () => {
  const author = await registerUser();
  const viewer = await registerUser();
  const pollResponse = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(author.accessToken),
    payload: { question: 'Hidden as soon as deletion is accepted', options: ['One', 'Two'] }
  });
  assert.equal(pollResponse.statusCode, 201, pollResponse.body);
  const poll = pollResponse.json<{ poll: { id: string } }>().poll;
  const avatarKey = `avatars/${author.user.id}/still-present.webp`;
  await db.query('UPDATE profiles SET avatar_object_key = $2 WHERE user_id = $1', [author.user.id, avatarKey]);
  await db.query('UPDATE polls SET image_object_key = $2 WHERE id = $1', [poll.id, `poll-images/${author.user.id}/still-present.webp`]);
  await db.query("UPDATE users SET status = 'deleted', deleted_at = now(), session_version = session_version + 1 WHERE id = $1", [author.user.id]);

  const profile = await app.inject({ method: 'GET', url: `/users/${author.user.id}` });
  const avatar = await app.inject({ method: 'GET', url: `/media/avatars/${author.user.id}` });
  const pollImage = await app.inject({ method: 'GET', url: `/media/polls/${poll.id}` });
  const publicPolls = await app.inject({ method: 'GET', url: '/polls' });
  const userSearch = await app.inject({
    method: 'GET',
    url: `/search?q=${encodeURIComponent(author.user.username)}&type=users`,
    headers: bearer(viewer.accessToken)
  });

  assert.equal(profile.statusCode, 404, profile.body);
  assert.equal(avatar.statusCode, 404, avatar.body);
  assert.equal(pollImage.statusCode, 404, pollImage.body);
  assert.equal(publicPolls.json<{ items: Array<{ id: string }> }>().items.some((item) => item.id === poll.id), false);
  assert.equal(userSearch.json<{ items: Array<{ type: string; user?: { id: string } }> }>().items.some((item) => item.type === 'user' && item.user?.id === author.user.id), false);
});

after(async () => {
  for (const userId of createdUserIds) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await app.close();
  await closeDatabaseConnection();
  await closeRedisConnection();
  await closeStorageConnection();
});
