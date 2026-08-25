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

type Auth = { user: { id: string; username: string; role: string }; accessToken: string };

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

test('regular users cannot issue moderation sanctions', async () => {
  const user = await registerUser();
  const response = await app.inject({
    method: 'POST',
    url: `/moderation/users/${user.user.id}/strike`,
    headers: bearer(user.accessToken),
    payload: {
      caseId: '00000000-0000-4000-8000-000000000000',
      reason: 'Should not be accepted.'
    }
  });
  assert.equal(response.statusCode, 403, response.body);
  const permanentBan = await app.inject({
    method: 'POST',
    url: `/moderation/users/${user.user.id}/permanent-ban`,
    headers: { ...bearer(user.accessToken), 'idempotency-key': `ban-${suffix()}` },
    payload: {
      caseId: '00000000-0000-4000-8000-000000000000',
      reason: 'Should not be accepted.'
    }
  });
  assert.equal(permanentBan.statusCode, 403, permanentBan.body);
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

test('moderators can inspect, assign, note and resolve a case', async () => {
  const reporter = await registerUser();
  const moderator = await registerUser();
  const author = await registerUser();
  await setRole(moderator, 'moderator');
  const poll = await createPoll(author);
  const report = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: bearer(reporter.accessToken),
    payload: { targetType: 'poll', targetId: poll.id, category: 'spam', description: 'Workflow report.' }
  });
  const caseId = report.json<{ case: { id: string } }>().case.id;

  const forbidden = await app.inject({ method: 'GET', url: `/moderation/cases/${caseId}`, headers: bearer(reporter.accessToken) });
  assert.equal(forbidden.statusCode, 403);

  const detail = await app.inject({ method: 'GET', url: `/moderation/cases/${caseId}`, headers: bearer(moderator.accessToken) });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json<{ case: { status: string }; reports: unknown[]; notes: unknown[] }>().case.status, 'open');
  assert.equal(detail.json<{ reports: unknown[] }>().reports.length, 1);

  const assign = await app.inject({ method: 'POST', url: `/moderation/cases/${caseId}/assign`, headers: bearer(moderator.accessToken) });
  assert.equal(assign.statusCode, 200, assign.body);
  assert.equal(assign.json<{ case: { status: string; assignedToUserId: string } }>().case.status, 'in_review');
  assert.equal(assign.json<{ case: { assignedToUserId: string } }>().case.assignedToUserId, moderator.user.id);

  const note = await app.inject({
    method: 'POST', url: `/moderation/cases/${caseId}/notes`, headers: bearer(moderator.accessToken),
    payload: { body: 'Reviewed the reported poll.' }
  });
  assert.equal(note.statusCode, 201, note.body);

  const resolve = await app.inject({
    method: 'POST', url: `/moderation/cases/${caseId}/resolve`, headers: bearer(moderator.accessToken),
    payload: { resolutionCode: 'content_removed', note: 'Content violates policy.' }
  });
  assert.equal(resolve.statusCode, 200, resolve.body);
  assert.equal(resolve.json<{ case: { status: string } }>().case.status, 'resolved');

  const repeatResolve = await app.inject({
    method: 'POST', url: `/moderation/cases/${caseId}/resolve`, headers: bearer(moderator.accessToken),
    payload: { resolutionCode: 'content_removed', note: 'Repeated resolution.' }
  });
  assert.equal(repeatResolve.statusCode, 409);
});

test('moderators can remove reported content only through its case', async () => {
  const reporter = await registerUser();
  const moderator = await registerUser();
  const author = await registerUser();
  await setRole(moderator, 'moderator');
  const poll = await createPoll(author);
  const report = await app.inject({
    method: 'POST', url: '/reports', headers: bearer(reporter.accessToken),
    payload: { targetType: 'poll', targetId: poll.id, category: 'spam', description: 'Remove this poll.' }
  });
  const caseId = report.json<{ case: { id: string } }>().case.id;

  const wrongCase = await app.inject({
    method: 'POST', url: `/moderation/content/poll/${poll.id}/remove`, headers: bearer(moderator.accessToken),
    payload: { caseId: '00000000-0000-4000-8000-000000000000', reason: 'Wrong case.' }
  });
  assert.equal(wrongCase.statusCode, 404);

  const removed = await app.inject({
    method: 'POST', url: `/moderation/content/poll/${poll.id}/remove`, headers: bearer(moderator.accessToken),
    payload: { caseId, reason: 'Confirmed spam.' }
  });
  assert.equal(removed.statusCode, 204, removed.body);

  const deletedPoll = await db.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM polls WHERE id = $1', [poll.id]);
  assert.ok(deletedPoll.rows[0]?.deleted_at);

  const repeated = await app.inject({
    method: 'POST', url: `/moderation/content/poll/${poll.id}/remove`, headers: bearer(moderator.accessToken),
    payload: { caseId, reason: 'Repeated removal.' }
  });
  assert.equal(repeated.statusCode, 204);
});

test('moderators can issue an idempotent strike for a reported user', async () => {
  const reporter = await registerUser();
  const moderator = await registerUser();
  const target = await registerUser();
  await setRole(moderator, 'moderator');
  const report = await app.inject({
    method: 'POST', url: '/reports', headers: bearer(reporter.accessToken),
    payload: { targetType: 'user', targetId: target.user.id, category: 'harassment', description: 'Reported user.' }
  });
  assert.equal(report.statusCode, 201, report.body);
  const caseId = report.json<{ case: { id: string } }>().case.id;
  const headers = { ...bearer(moderator.accessToken), 'idempotency-key': `strike-${suffix()}` };
  const payload = { caseId, reason: 'Confirmed harassment.' };
  const first = await app.inject({ method: 'POST', url: `/moderation/users/${target.user.id}/strike`, headers, payload });
  assert.equal(first.statusCode, 201, first.body);
  const repeated = await app.inject({ method: 'POST', url: `/moderation/users/${target.user.id}/strike`, headers, payload });
  assert.equal(repeated.statusCode, 200, repeated.body);
  const second = await app.inject({
    method: 'POST', url: `/moderation/users/${target.user.id}/strike`,
    headers: { ...bearer(moderator.accessToken), 'idempotency-key': `strike-${suffix()}` },
    payload
  });
  assert.equal(second.statusCode, 201, second.body);
  const sanctions = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM sanctions WHERE user_id = $1 AND type = \'strike\'', [target.user.id]);
  assert.equal(Number(sanctions.rows[0]?.count), 2);
  const automaticRestriction = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM sanctions WHERE user_id = $1 AND type = 'posting_restriction' AND metadata->>'automatic' = 'true'", [target.user.id]);
  assert.equal(Number(automaticRestriction.rows[0]?.count), 1);
});

test('temporary ban revokes the current session and blocks login until revoked', async () => {
  const reporter = await registerUser();
  const moderator = await registerUser();
  const target = await registerUser();
  await setRole(moderator, 'moderator');
  const report = await app.inject({
    method: 'POST', url: '/reports', headers: bearer(reporter.accessToken),
    payload: { targetType: 'user', targetId: target.user.id, category: 'violence_or_threat', description: 'Threatening account.' }
  });
  const caseId = report.json<{ case: { id: string } }>().case.id;
  const banKey = `ban-${suffix()}`;
  const banned = await app.inject({
    method: 'POST', url: `/moderation/users/${target.user.id}/temporary-ban`,
    headers: { ...bearer(moderator.accessToken), 'idempotency-key': banKey },
    payload: { caseId, reason: 'Threat confirmed.', durationHours: 1 }
  });
  assert.equal(banned.statusCode, 201, banned.body);
  const revokedSession = await app.inject({ method: 'GET', url: '/auth/me', headers: bearer(target.accessToken) });
  assert.equal(revokedSession.statusCode, 401);
  const blockedLogin = await app.inject({
    method: 'POST', url: '/auth/login', payload: { login: target.user.username, password: 'password123' }
  });
  assert.equal(blockedLogin.statusCode, 401);
  const sanctionId = banned.json<{ sanction: { id: string } }>().sanction.id;
  const revoked = await app.inject({
    method: 'POST', url: `/moderation/sanctions/${sanctionId}/revoke`,
    headers: { ...bearer(moderator.accessToken), 'idempotency-key': `revoke-${suffix()}` },
    payload: { reason: 'Review completed.' }
  });
  assert.equal(revoked.statusCode, 200, revoked.body);
  const allowedLogin = await app.inject({
    method: 'POST', url: '/auth/login', payload: { login: target.user.username, password: 'password123' }
  });
  assert.equal(allowedLogin.statusCode, 200, allowedLogin.body);
});

test('posting restriction is enforced by poll creation on the backend', async () => {
  const reporter = await registerUser();
  const moderator = await registerUser();
  const target = await registerUser();
  await setRole(moderator, 'moderator');
  const report = await app.inject({
    method: 'POST', url: '/reports', headers: bearer(reporter.accessToken),
    payload: { targetType: 'user', targetId: target.user.id, category: 'spam', description: 'Spam account.' }
  });
  const caseId = report.json<{ case: { id: string } }>().case.id;
  const restricted = await app.inject({
    method: 'POST', url: `/moderation/users/${target.user.id}/restriction`,
    headers: { ...bearer(moderator.accessToken), 'idempotency-key': `restriction-${suffix()}` },
    payload: { caseId, restrictionType: 'posting_restriction', reason: 'Repeated spam.', durationHours: 1 }
  });
  assert.equal(restricted.statusCode, 201, restricted.body);
  const blockedPoll = await app.inject({
    method: 'POST', url: '/polls', headers: bearer(target.accessToken),
    payload: { question: 'This should be rejected', options: ['One', 'Two'] }
  });
  assert.equal(blockedPoll.statusCode, 403, blockedPoll.body);
});

test('permanent ban requires superadmin and can be revoked through an appeal', async () => {
  const reporter = await registerUser();
  const moderator = await registerUser();
  const superadmin = await registerUser();
  const target = await registerUser();
  await setRole(moderator, 'moderator');
  await setRole(superadmin, 'superadmin');
  const report = await app.inject({
    method: 'POST', url: '/reports', headers: bearer(reporter.accessToken),
    payload: { targetType: 'user', targetId: target.user.id, category: 'hate_or_discrimination', description: 'Severe violation.' }
  });
  const caseId = report.json<{ case: { id: string } }>().case.id;
  const moderatorAttempt = await app.inject({
    method: 'POST', url: `/moderation/users/${target.user.id}/permanent-ban`,
    headers: { ...bearer(moderator.accessToken), 'idempotency-key': `permanent-${suffix()}` },
    payload: { caseId, reason: 'Moderator cannot issue permanent bans.' }
  });
  assert.equal(moderatorAttempt.statusCode, 403, moderatorAttempt.body);
  const banned = await app.inject({
    method: 'POST', url: `/moderation/users/${target.user.id}/permanent-ban`,
    headers: { ...bearer(superadmin.accessToken), 'idempotency-key': `permanent-${suffix()}` },
    payload: { caseId, reason: 'Severe violation confirmed.' }
  });
  assert.equal(banned.statusCode, 201, banned.body);
  const sanctionId = banned.json<{ sanction: { id: string; type: string } }>().sanction.id;
  assert.equal(banned.json<{ sanction: { type: string } }>().sanction.type, 'permanent_ban');

  const appeal = await app.inject({
    method: 'POST', url: '/appeals', headers: { ...bearer(target.accessToken), 'idempotency-key': `appeal-${suffix()}` },
    payload: { sanctionId, reason: 'I request a review.' }
  });
  assert.equal(appeal.statusCode, 201, appeal.body);
  const appealId = appeal.json<{ appeal: { id: string } }>().appeal.id;
  const appeals = await app.inject({ method: 'GET', url: '/moderation/appeals?status=open', headers: bearer(moderator.accessToken) });
  assert.equal(appeals.statusCode, 200, appeals.body);
  const moderatorDecision = await app.inject({
    method: 'POST', url: `/moderation/appeals/${appealId}/resolve`, headers: { ...bearer(moderator.accessToken), 'idempotency-key': `decision-${suffix()}` },
    payload: { status: 'revoked', decisionNote: 'Moderator cannot decide appeals.' }
  });
  assert.equal(moderatorDecision.statusCode, 403, moderatorDecision.body);
  const decision = await app.inject({
    method: 'POST', url: `/moderation/appeals/${appealId}/resolve`, headers: { ...bearer(superadmin.accessToken), 'idempotency-key': `decision-${suffix()}` },
    payload: { status: 'revoked', decisionNote: 'Appeal upheld and ban revoked.' }
  });
  assert.equal(decision.statusCode, 200, decision.body);
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: target.user.username, password: 'password123' } });
  assert.equal(login.statusCode, 200, login.body);
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
