import assert from 'node:assert/strict';
import { after, test } from 'node:test';

process.env.NODE_ENV = 'test';

const [{ buildApp }, { closeDatabaseConnection, db }, { closeRedisConnection }, { closeStorageConnection }, adminRepository, adminUsersRepository] = await Promise.all([
  import('../../app.js'),
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('../../config/storage.js'),
  import('./admin.repository.js'),
  import('./admin.users.repository.js')
]);

const app = buildApp();
const createdUserIds = new Set<string>();

type Auth = {
  user: { id: string; role: 'user' | 'moderator' | 'superadmin' };
  accessToken: string;
};

type Poll = {
  id: string;
  options: Array<{ id: string }>;
};

function bearer(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

function suffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function registerUser(): Promise<Auth> {
  const username = `adm_${suffix()}`;
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: `${username}@yaskapp.test`,
      username,
      password: 'password123',
      displayName: 'Admin Test User',
      countryCode: 'BY'
    }
  });

  assert.equal(response.statusCode, 201, response.body);
  const auth = response.json<Auth>();
  createdUserIds.add(auth.user.id);
  return auth;
}

async function promote(user: Auth, role: 'moderator' | 'superadmin') {
  await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.user.id]);
  user.user.role = role;
}

async function createPoll(author: Auth): Promise<Poll> {
  const response = await app.inject({
    method: 'POST',
    url: '/polls',
    headers: bearer(author.accessToken),
    payload: { question: `Admin test poll ${suffix()}`, options: ['Keep', 'Remove'] }
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json<{ poll: Poll }>().poll;
}

test('admin read endpoints enforce authentication, permissions, validation and filters', async () => {
  const regular = await registerUser();
  const moderator = await registerUser();
  const superadmin = await registerUser();
  await promote(moderator, 'moderator');
  await promote(superadmin, 'superadmin');

  const noAuthCapabilities = await app.inject({ method: 'GET', url: '/admin/capabilities' });
  assert.equal(noAuthCapabilities.statusCode, 401);

  const regularCapabilities = await app.inject({
    method: 'GET', url: '/admin/capabilities', headers: bearer(regular.accessToken)
  });
  assert.equal(regularCapabilities.statusCode, 403);

  const capabilities = await app.inject({
    method: 'GET', url: '/admin/capabilities', headers: bearer(moderator.accessToken)
  });
  assert.equal(capabilities.statusCode, 200);
  assert.ok(capabilities.json<{ permissions: string[] }>().permissions.includes('admin.users.read'));

  const regularUsers = await app.inject({ method: 'GET', url: '/admin/users', headers: bearer(regular.accessToken) });
  assert.equal(regularUsers.statusCode, 403);

  const invalidUsersQuery = await app.inject({
    method: 'GET', url: '/admin/users?createdFrom=2030-01-01T00:00:00.000Z&createdTo=2020-01-01T00:00:00.000Z', headers: bearer(moderator.accessToken)
  });
  assert.equal(invalidUsersQuery.statusCode, 400);

  const users = await app.inject({ method: 'GET', url: '/admin/users?limit=1&status=active&role=all', headers: bearer(moderator.accessToken) });
  assert.equal(users.statusCode, 200, users.body);
  assert.equal(users.json<{ items: unknown[] }>().items.length, 1);

  const invalidUserId = await app.inject({ method: 'GET', url: '/admin/users/not-a-uuid', headers: bearer(moderator.accessToken) });
  assert.equal(invalidUserId.statusCode, 400);

  const missingUser = await app.inject({
    method: 'GET', url: '/admin/users/00000000-0000-4000-8000-000000000000', headers: bearer(moderator.accessToken)
  });
  assert.equal(missingUser.statusCode, 404);

  const regularPolls = await app.inject({ method: 'GET', url: '/admin/polls', headers: bearer(regular.accessToken) });
  assert.equal(regularPolls.statusCode, 403);

  const invalidPollsQuery = await app.inject({
    method: 'GET', url: '/admin/polls?createdFrom=2030-01-01T00:00:00.000Z&createdTo=2020-01-01T00:00:00.000Z', headers: bearer(moderator.accessToken)
  });
  assert.equal(invalidPollsQuery.statusCode, 400);

  const polls = await app.inject({
    method: 'GET', url: '/admin/polls?limit=1&status=all&createdFrom=2000-01-01T00:00:00.000Z&createdTo=2100-01-01T00:00:00.000Z', headers: bearer(moderator.accessToken)
  });
  assert.equal(polls.statusCode, 200, polls.body);

  const invalidPollId = await app.inject({ method: 'GET', url: '/admin/polls/not-a-uuid', headers: bearer(moderator.accessToken) });
  assert.equal(invalidPollId.statusCode, 400);

  const missingPoll = await app.inject({ method: 'GET', url: '/admin/polls/00000000-0000-4000-8000-000000000000', headers: bearer(moderator.accessToken) });
  assert.equal(missingPoll.statusCode, 404);

  const regularAudit = await app.inject({ method: 'GET', url: '/admin/audit', headers: bearer(regular.accessToken) });
  assert.equal(regularAudit.statusCode, 403);

  const invalidAuditQuery = await app.inject({
    method: 'GET', url: '/admin/audit?from=2030-01-01T00:00:00.000Z&to=2020-01-01T00:00:00.000Z', headers: bearer(superadmin.accessToken)
  });
  assert.equal(invalidAuditQuery.statusCode, 400);

  const audit = await app.inject({
    method: 'GET', url: '/admin/audit?action=user.blocked&targetType=user&limit=1', headers: bearer(superadmin.accessToken)
  });
  assert.equal(audit.statusCode, 200, audit.body);
});

test('last superadmin protection preserves the final account and emits no audit entry', async () => {
  const first = await registerUser();
  const second = await registerUser();
  await promote(first, 'superadmin');
  await promote(second, 'superadmin');

  const demoteSecond = await app.inject({
    method: 'PATCH', url: `/admin/users/${second.user.id}/role`, headers: bearer(first.accessToken),
    payload: { role: 'user', reason: 'Reduce administrator count.' }
  });
  assert.equal(demoteSecond.statusCode, 200, demoteSecond.body);

  const demoteLast = await app.inject({
    method: 'PATCH', url: `/admin/users/${first.user.id}/role`, headers: bearer(first.accessToken),
    payload: { role: 'user', reason: 'Attempt to remove final superadmin.' }
  });
  assert.equal(demoteLast.statusCode, 409, demoteLast.body);
  assert.equal(demoteLast.json<{ error: string }>().error, 'invalid_admin_transition');

  const firstRole = await db.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [first.user.id]);
  assert.equal(firstRole.rows[0]?.role, 'superadmin');

  const deleteLast = await app.inject({
    method: 'DELETE', url: `/admin/users/${first.user.id}`, headers: bearer(first.accessToken),
    payload: { reason: 'Attempt to delete final superadmin.' }
  });
  assert.equal(deleteLast.statusCode, 409, deleteLast.body);

  const firstStatus = await db.query<{ status: string; deleted_at: Date | null }>('SELECT status, deleted_at FROM users WHERE id = $1', [first.user.id]);
  assert.equal(firstStatus.rows[0]?.status, 'active');
  assert.equal(firstStatus.rows[0]?.deleted_at, null);

  const audit = await db.query<{ action: string }>(
    'SELECT action FROM admin_audit_log WHERE target_id = $1 ORDER BY created_at DESC', [first.user.id]
  );
  assert.equal(audit.rows.length, 0);
});

test('admin mutation endpoints cover protected, repeated and not-found transitions', async () => {
  const superadmin = await registerUser();
  const moderator = await registerUser();
  const target = await registerUser();
  await promote(superadmin, 'superadmin');
  await promote(moderator, 'moderator');

  const selfBlock = await app.inject({ method: 'POST', url: `/admin/users/${moderator.user.id}/block`, headers: bearer(moderator.accessToken), payload: { reason: 'Self block.' } });
  assert.equal(selfBlock.statusCode, 409);

  const protectedBlock = await app.inject({ method: 'POST', url: `/admin/users/${superadmin.user.id}/block`, headers: bearer(moderator.accessToken), payload: { reason: 'Protected target.' } });
  assert.equal(protectedBlock.statusCode, 409);

  const block = await app.inject({ method: 'POST', url: `/admin/users/${target.user.id}/block`, headers: bearer(moderator.accessToken), payload: { reason: 'Policy violation.' } });
  assert.equal(block.statusCode, 200, block.body);
  const repeatBlock = await app.inject({ method: 'POST', url: `/admin/users/${target.user.id}/block`, headers: bearer(moderator.accessToken), payload: { reason: 'Repeated request.' } });
  assert.equal(repeatBlock.statusCode, 200);
  assert.equal(repeatBlock.json<{ status: string }>().status, 'already_blocked');

  const unblock = await app.inject({ method: 'POST', url: `/admin/users/${target.user.id}/unblock`, headers: bearer(moderator.accessToken), payload: { reason: 'Restriction lifted.' } });
  assert.equal(unblock.statusCode, 200);
  const repeatUnblock = await app.inject({ method: 'POST', url: `/admin/users/${target.user.id}/unblock`, headers: bearer(moderator.accessToken), payload: { reason: 'Repeated request.' } });
  assert.equal(repeatUnblock.statusCode, 200);
  assert.equal(repeatUnblock.json<{ status: string }>().status, 'already_active');

  const missingBlock = await app.inject({ method: 'POST', url: '/admin/users/00000000-0000-4000-8000-000000000000/block', headers: bearer(moderator.accessToken), payload: { reason: 'Missing target.' } });
  assert.equal(missingBlock.statusCode, 404);

  const selfDelete = await app.inject({ method: 'DELETE', url: `/admin/users/${superadmin.user.id}`, headers: bearer(superadmin.accessToken), payload: { reason: 'Self delete.' } });
  assert.equal(selfDelete.statusCode, 409);

  const selfRole = await app.inject({ method: 'PATCH', url: `/admin/users/${superadmin.user.id}/role`, headers: bearer(superadmin.accessToken), payload: { role: 'user', reason: 'Self demotion.' } });
  assert.equal(selfRole.statusCode, 409);

  const invalidRoleBody = await app.inject({ method: 'PATCH', url: `/admin/users/${target.user.id}/role`, headers: bearer(superadmin.accessToken), payload: { role: 'invalid', reason: 'Invalid role.' } });
  assert.equal(invalidRoleBody.statusCode, 400);

  const missingComment = await app.inject({ method: 'DELETE', url: '/admin/comments/00000000-0000-4000-8000-000000000000', headers: bearer(moderator.accessToken), payload: { reason: 'Missing comment.' } });
  assert.equal(missingComment.statusCode, 404);
});

test('admin poll and comment deletion are transactional and idempotent', async () => {
  const moderator = await registerUser();
  const author = await registerUser();
  await promote(moderator, 'moderator');
  const poll = await createPoll(author);

  const detail = await app.inject({ method: 'GET', url: `/admin/polls/${poll.id}`, headers: bearer(moderator.accessToken) });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json<{ poll: { status: string } }>().poll.status, 'active');

  const deletePoll = await app.inject({ method: 'DELETE', url: `/admin/polls/${poll.id}`, headers: bearer(moderator.accessToken), payload: { reason: 'Removed by moderator.' } });
  assert.equal(deletePoll.statusCode, 204);
  const repeatPoll = await app.inject({ method: 'DELETE', url: `/admin/polls/${poll.id}`, headers: bearer(moderator.accessToken), payload: { reason: 'Repeated removal.' } });
  assert.equal(repeatPoll.statusCode, 204);

  const commentResult = await db.query<{ id: string }>(
    'INSERT INTO comments (poll_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
    [poll.id, author.user.id, 'Admin test comment']
  );
  const commentId = commentResult.rows[0]?.id;
  assert.ok(commentId);

  const deleteComment = await app.inject({ method: 'DELETE', url: `/admin/comments/${commentId}`, headers: bearer(moderator.accessToken), payload: { reason: 'Removed comment.' } });
  assert.equal(deleteComment.statusCode, 204);
  const repeatComment = await app.inject({ method: 'DELETE', url: `/admin/comments/${commentId}`, headers: bearer(moderator.accessToken), payload: { reason: 'Repeated removal.' } });
  assert.equal(repeatComment.statusCode, 204);

  const audit = await db.query<{ action: string }>(
    `SELECT action FROM admin_audit_log WHERE target_id IN ($1, $2) ORDER BY created_at DESC`,
    [poll.id, commentId]
  );
  assert.deepEqual(audit.rows.map((row) => row.action), ['comment.deleted_by_admin', 'poll.deleted_by_admin']);
});

test('admin mutation transactions roll back state when audit insertion fails', async () => {
  const actor = await registerUser();
  const target = await registerUser();
  await promote(actor, 'superadmin');

  await assert.rejects(() => adminRepository.blockUser(actor.user.id, target.user.id, { reason: '' }), 'block audit insertion should fail');
  const afterBlock = await db.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [target.user.id]);
  assert.equal(afterBlock.rows[0]?.status, 'active');

  await adminRepository.blockUser(actor.user.id, target.user.id, { reason: 'Prepare unblock rollback.' });
  await assert.rejects(() => adminUsersRepository.unblockUser(actor.user.id, target.user.id, {
    actorUserId: actor.user.id, actorRole: 'superadmin', reason: ''
  }), 'unblock audit insertion should fail');
  const afterUnblock = await db.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [target.user.id]);
  assert.equal(afterUnblock.rows[0]?.status, 'blocked');
  await adminUsersRepository.unblockUser(actor.user.id, target.user.id, {
    actorUserId: actor.user.id, actorRole: 'superadmin', reason: 'Restore target for remaining rollback checks.'
  });

  await assert.rejects(() => adminUsersRepository.changeUserRole(actor.user.id, target.user.id, 'moderator', {
    actorUserId: actor.user.id, actorRole: 'superadmin', reason: ''
  }), 'role audit insertion should fail');
  const afterRole = await db.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [target.user.id]);
  assert.equal(afterRole.rows[0]?.role, 'user');

  await assert.rejects(() => adminUsersRepository.deleteAdminUser(actor.user.id, target.user.id, {
    actorUserId: actor.user.id, actorRole: 'superadmin', reason: ''
  }), 'user delete audit insertion should fail');
  const afterUserDelete = await db.query<{ status: string; deleted_at: Date | null }>('SELECT status, deleted_at FROM users WHERE id = $1', [target.user.id]);
  assert.equal(afterUserDelete.rows[0]?.status, 'active');
  assert.equal(afterUserDelete.rows[0]?.deleted_at, null);

  const poll = await createPoll(target);
  await assert.rejects(() => adminRepository.deleteAdminPoll(poll.id, {
    actorUserId: actor.user.id, actorRole: 'superadmin', reason: ''
  }), 'poll audit insertion should fail');
  const afterPollDelete = await db.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM polls WHERE id = $1', [poll.id]);
  assert.equal(afterPollDelete.rows[0]?.deleted_at, null);

  const comment = await db.query<{ id: string }>(
    'INSERT INTO comments (poll_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
    [poll.id, target.user.id, 'Transactional comment']
  );
  const commentId = comment.rows[0]?.id;
  assert.ok(commentId);
  await assert.rejects(() => adminRepository.deleteAdminComment(commentId, {
    actorUserId: actor.user.id, actorRole: 'superadmin', reason: ''
  }), 'comment audit insertion should fail');
  const afterCommentDelete = await db.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM comments WHERE id = $1', [commentId]);
  assert.equal(afterCommentDelete.rows[0]?.deleted_at, null);

  const audit = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM admin_audit_log WHERE actor_user_id = $1 AND reason = ''`,
    [actor.user.id]
  );
  assert.equal(audit.rows[0]?.count, '0');
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
