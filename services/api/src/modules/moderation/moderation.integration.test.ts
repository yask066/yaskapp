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

type Auth = { user: { id: string; role: string }; accessToken: string };

function suffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function bearer(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

async function registerUser(): Promise<Auth> {
  const username = `rep_${suffix()}`;
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `${username}@yaskapp.test`,
      username,
      password: 'password123',
      displayName: 'Report Test User',
      countryCode: 'BY'
    }
  });
  assert.equal(response.statusCode, 201, response.body);
  const auth = response.json<Auth>();
  createdUserIds.add(auth.user.id);
  return auth;
}

async function setRole(user: Auth, role: 'moderator' | 'superadmin') {
  await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.user.id]);
  user.user.role = role;
}

async function createPoll(author: Auth) {
  const response = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(author.accessToken),
    payload: { question: `Report target ${suffix()}`, options: ['One', 'Two'] }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ poll: { id: string } }>().poll;
}

test('authenticated users can create and deduplicate reports', async () => {
  const reporter = await registerUser();
  const author = await registerUser();
  const poll = await createPoll(author);

  const unauthenticated = await app.inject({
    method: 'POST',
    url: '/reports',
    payload: { targetType: 'poll', targetId: poll.id, category: 'spam', description: 'Spam poll.' }
  });
  assert.equal(unauthenticated.statusCode, 401);

  const created = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: bearer(reporter.accessToken),
    payload: { targetType: 'poll', targetId: poll.id, category: 'spam', description: 'This poll is spam.' }
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json<{ deduplicated: boolean }>().deduplicated, false);
  const createdBody = created.json<{ report: { id: string }; case: { id: string } }>();
  assert.ok(createdBody.report.id);
  assert.ok(createdBody.case.id);

  const duplicate = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: bearer(reporter.accessToken),
    payload: { targetType: 'poll', targetId: poll.id, category: 'harassment', description: 'A second category.' }
  });
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json<{ deduplicated: boolean }>().deduplicated, true);
  assert.equal(duplicate.json<{ report: { id: string } }>().report.id, createdBody.report.id);

  const invalid = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: bearer(reporter.accessToken),
    payload: { targetType: 'poll', targetId: poll.id, category: 'unknown', description: '' }
  });
  assert.equal(invalid.statusCode, 400);

  const missingTarget = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: bearer(reporter.accessToken),
    payload: { targetType: 'poll', targetId: '00000000-0000-4000-8000-000000000000', category: 'spam', description: 'Missing target.' }
  });
  assert.equal(missingTarget.statusCode, 404);

  const persisted = await db.query<{ reports: string; cases: string; links: string }>(
    `SELECT
       (SELECT count(*)::text FROM reports WHERE id = $1) AS reports,
       (SELECT count(*)::text FROM moderation_cases WHERE id = $2) AS cases,
       (SELECT count(*)::text FROM moderation_case_reports WHERE report_id = $1) AS links`,
    [createdBody.report.id, createdBody.case.id]
  );
  assert.deepEqual(persisted.rows[0], { reports: '1', cases: '1', links: '1' });

  const userReport = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: bearer(reporter.accessToken),
    payload: { targetType: 'user', targetId: author.user.id, category: 'impersonation', description: 'User report.' }
  });
  assert.equal(userReport.statusCode, 201, userReport.body);

  const comment = await db.query<{ id: string }>(
    'INSERT INTO comments (poll_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
    [poll.id, author.user.id, 'Reportable comment.']
  );
  const commentReport = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: bearer(reporter.accessToken),
    payload: { targetType: 'comment', targetId: comment.rows[0]?.id, category: 'harassment', description: 'Comment report.' }
  });
  assert.equal(commentReport.statusCode, 201, commentReport.body);
});

test('moderation queue is protected and supports filters and cursor pagination', async () => {
  const reporter = await registerUser();
  const moderator = await registerUser();
  const author = await registerUser();
  await setRole(moderator, 'moderator');

  const reporterCapabilities = await app.inject({ method: 'GET', url: '/moderation/capabilities', headers: bearer(reporter.accessToken) });
  assert.equal(reporterCapabilities.statusCode, 403);
  const moderatorCapabilities = await app.inject({ method: 'GET', url: '/moderation/capabilities', headers: bearer(moderator.accessToken) });
  assert.equal(moderatorCapabilities.statusCode, 200, moderatorCapabilities.body);
  assert.ok(moderatorCapabilities.json<{ permissions: string[] }>().permissions.includes('moderation.queue.read'));

  const firstPoll = await createPoll(author);
  const secondPoll = await createPoll(author);

  for (const pollId of [firstPoll.id, secondPoll.id]) {
    const response = await app.inject({
      method: 'POST',
      url: '/reports',
      headers: bearer(reporter.accessToken),
      payload: { targetType: 'poll', targetId: pollId, category: 'spam', description: `Report ${pollId}.` }
    });
    assert.equal(response.statusCode, 201, response.body);
  }

  const forbidden = await app.inject({ method: 'GET', url: '/moderation/cases', headers: bearer(reporter.accessToken) });
  assert.equal(forbidden.statusCode, 403);

  const firstPage = await app.inject({ method: 'GET', url: '/moderation/cases?limit=1&status=open&priority=normal', headers: bearer(moderator.accessToken) });
  assert.equal(firstPage.statusCode, 200, firstPage.body);
  const firstPageBody = firstPage.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
  assert.equal(firstPageBody.items.length, 1);
  assert.ok(firstPageBody.nextCursor);

  const nextPage = await app.inject({ method: 'GET', url: `/moderation/cases?limit=1&cursor=${encodeURIComponent(firstPageBody.nextCursor!)}`, headers: bearer(moderator.accessToken) });
  assert.equal(nextPage.statusCode, 200, nextPage.body);
  assert.equal(nextPage.json<{ items: Array<{ id: string }> }>().items.length, 1);

  const invalidCursor = await app.inject({ method: 'GET', url: '/moderation/cases?cursor=not-a-cursor', headers: bearer(moderator.accessToken) });
  assert.equal(invalidCursor.statusCode, 400);
});

test('blocked reporters are rejected and invalid targets leave no persisted case', async () => {
  const reporter = await registerUser();
  const target = await registerUser();

  await db.query("UPDATE users SET status = 'blocked' WHERE id = $1", [reporter.user.id]);
  const blockedResponse = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: bearer(reporter.accessToken),
    payload: { targetType: 'user', targetId: target.user.id, category: 'spam', description: 'Blocked reporter.' }
  });
  assert.equal(blockedResponse.statusCode, 401);

  const missingTarget = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: bearer(target.accessToken),
    payload: { targetType: 'comment', targetId: '00000000-0000-4000-8000-000000000000', category: 'spam', description: 'Missing comment.' }
  });
  assert.equal(missingTarget.statusCode, 404);

  const persisted = await db.query<{ reports: string; cases: string }>(
    `SELECT
       (SELECT count(*)::text FROM reports WHERE reporter_user_id = $1 AND target_id = $2) AS reports,
       (SELECT count(*)::text FROM moderation_cases WHERE target_id = $2) AS cases`,
    [target.user.id, '00000000-0000-4000-8000-000000000000']
  );
  assert.deepEqual(persisted.rows[0], { reports: '0', cases: '0' });
});

after(async () => {
  if (createdUserIds.size > 0) {
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[...createdUserIds]]);
  }
  await app.close();
  await closeDatabaseConnection();
  await closeRedisConnection();
  await closeStorageConnection();
});
