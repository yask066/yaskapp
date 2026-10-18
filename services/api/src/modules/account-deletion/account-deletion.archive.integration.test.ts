import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

const testDatabase = process.env.ACCOUNT_DELETION_TEST_DATABASE_URL;

test('closed_archive_retains_moderation_evidence_for_30_days_and_bans_outlive_it', {
  skip: !testDatabase && 'requires dedicated ACCOUNT_DELETION_TEST_DATABASE_URL, Redis and media storage'
}, async () => {
  assert.equal(process.env.DATABASE_URL, testDatabase);
  assert.match(new URL(testDatabase!).pathname, /test/);
  process.env.NODE_ENV = 'test';
  process.env.ACCOUNT_DELETION_ENABLED = 'true';
  process.env.ACCOUNT_DELETION_JOURNAL_ENABLED = 'false';
  const [{ buildApp }, { db, closeDatabaseConnection }, { closeRedisConnection },
    { closeStorageConnection }, { processDeletionBatch }, { cleanupDeletionRetention }] = await Promise.all([
    import('../../app.js'), import('../../config/database.js'), import('../../config/redis.js'),
    import('../../config/storage.js'), import('./account-deletion.worker.js'), import('./account-deletion.retention.js')
  ]);
  const app = buildApp();
  const userIds: string[] = [];
  const ip = `198.18.${Math.floor(Math.random() * 250)}.42`;
  const secondIp = ip.replace(/42$/, '43');
  let operationId: string | undefined;
  let caseId: string | undefined;
  let banId: string | undefined;
  let failureTrigger = false;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  async function register(role: 'user' | 'moderator' | 'superadmin', address = '203.0.113.10') {
    const username = `arc_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const result = await app.inject({ method: 'POST', url: '/auth/register', remoteAddress: address,
      payload: { username, email: `${username}@yaskapp.test`, password: 'Archive-password-123', countryCode: 'BY', displayName: 'Archive fixture' } });
    assert.equal(result.statusCode, 201, result.body);
    const account = result.json<{ user: { id: string }; accessToken: string }>();
    userIds.push(account.user.id);
    if (role !== 'user') await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, account.user.id]);
    return { ...account, username };
  }
  try {
    const admin = await register('superadmin');
    const moderator = await register('moderator');
    const outsider = await register('user');
    const adminTarget = await register('user');
    const adminDelete = () => app.inject({ method: 'DELETE', url: `/admin/users/${adminTarget.user.id}`,
      headers: bearer(admin.accessToken), payload: { reason: 'Administrative removal fixture' } });
    assert.equal((await adminDelete()).statusCode, 204);
    const adminArchive = await app.inject({ method: 'GET', url: `/admin/deleted-accounts/${adminTarget.user.id}`, headers: bearer(admin.accessToken) });
    assert.equal(adminArchive.statusCode, 200, adminArchive.body);
    assert.equal(adminArchive.json().account.source, 'admin');
    assert.equal((await adminDelete()).statusCode, 204);
    assert.equal((await db.query('SELECT user_id FROM deleted_account_archives WHERE user_id=$1', [adminTarget.user.id])).rowCount, 1);
    const owner = await register('user', ip);
    await db.query(`INSERT INTO account_ip_history (user_id, ip, first_seen_at, last_seen_at)
      VALUES ($1, '192.0.2.1', now() - interval '31 days', now() - interval '31 days')`, [owner.user.id]);
    const login = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: secondIp,
      payload: { login: owner.username, password: 'Archive-password-123' } });
    assert.equal(login.statusCode, 200, login.body);
    const poll = await app.inject({ method: 'POST', url: '/polls', headers: bearer(owner.accessToken),
      payload: { question: 'Evidence before deletion', options: ['One', 'Two'] } });
    assert.equal(poll.statusCode, 201, poll.body);
    const pollId = poll.json().poll.id;
    const createdCase = await db.query<{ id: string }>(
      "INSERT INTO moderation_cases (target_type, target_id, priority) VALUES ('poll', $1, 'critical') RETURNING id", [pollId]);
    caseId = createdCase.rows[0]!.id;
    await db.query('INSERT INTO moderation_case_notes (case_id, author_user_id, body) VALUES ($1, $2, $3)', [caseId, admin.user.id, 'Serious violation evidence']);
    const verification = await app.inject({ method: 'POST', url: '/auth/account-deletion/verification',
      remoteAddress: secondIp, headers: bearer(owner.accessToken), payload: { password: 'Archive-password-123' } });
    assert.equal(verification.statusCode, 200, verification.body);
    const receipt = verification.json();
    operationId = receipt.operationId;
    const accept = () => app.inject({ method: 'DELETE', url: '/auth/me', headers: bearer(receipt.deletionToken), payload: { confirm: true } });
    // Force a failure after the snapshot is written but before acceptance commits.
    assert.match(String(operationId), /^[0-9a-f-]{36}$/);
    await db.query(`CREATE FUNCTION test_archive_acceptance_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.operation_id = '${operationId}'::uuid THEN RAISE EXCEPTION 'archive rollback fixture'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER test_archive_acceptance_failure BEFORE INSERT ON account_deletion_events FOR EACH ROW EXECUTE FUNCTION test_archive_acceptance_failure()');
    failureTrigger = true;
    assert.equal((await accept()).statusCode, 503);
    assert.equal((await db.query('SELECT status FROM users WHERE id=$1', [owner.user.id])).rows[0].status, 'active');
    assert.equal((await db.query('SELECT user_id FROM deleted_account_archives WHERE user_id=$1', [owner.user.id])).rowCount, 0);
    await db.query('DROP TRIGGER test_archive_acceptance_failure ON account_deletion_events');
    await db.query('DROP FUNCTION test_archive_acceptance_failure()');
    failureTrigger = false;
    assert.equal((await accept()).statusCode, 202);
    const archiveUrl = `/admin/deleted-accounts/${owner.user.id}`;
    assert.equal((await app.inject({ method: 'GET', url: archiveUrl })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: archiveUrl, headers: bearer(moderator.accessToken) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: archiveUrl, headers: bearer(outsider.accessToken) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/admin/deleted-accounts', headers: bearer(moderator.accessToken) })).statusCode, 403);
    const read = await app.inject({ method: 'GET', url: archiveUrl, headers: bearer(admin.accessToken) });
    assert.equal(read.statusCode, 200, read.body);
    assert.match(String(read.headers['cache-control']), /no-store/);
    const archive = read.json().account;
    assert.equal(archive.profile.username, owner.username);
    assert.equal(archive.profile.email, `${owner.username}@yaskapp.test`);
    assert.equal(new Date(archive.expiresAt).getTime() - new Date(archive.deletedAt).getTime(), 30 * 86400_000);
    assert.deepEqual(archive.ips.map((item: { ip: string }) => item.ip).sort(), [ip, secondIp].sort());
    assert.match(JSON.stringify(archive.evidence), /Serious violation evidence/);
    assert.match(JSON.stringify(archive.evidence), /Evidence before deletion/);
    assert.doesNotMatch(read.body, /password_hash|Archive-password|accessToken|deletionToken|session_version|avatar_object_key/);
    assert.equal((await accept()).statusCode, 202);
    assert.equal((await app.inject({ method: 'GET', url: archiveUrl, headers: bearer(admin.accessToken) })).json().account.expiresAt, archive.expiresAt);
    const page = await app.inject({ method: 'GET', url: '/admin/deleted-accounts?limit=1', headers: bearer(admin.accessToken) });
    assert.equal(page.json().items.length, 1);
    assert.ok(page.json().nextCursor);
    const nextPage = await app.inject({ method: 'GET', url: `/admin/deleted-accounts?limit=1&cursor=${encodeURIComponent(page.json().nextCursor)}`, headers: bearer(admin.accessToken) });
    assert.notEqual(nextPage.json().items[0].userId, page.json().items[0].userId);
    const invalidCursor = Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), id: 'invalid' })).toString('base64url');
    assert.equal((await app.inject({ method: 'GET', url: `/admin/deleted-accounts?cursor=${invalidCursor}`, headers: bearer(admin.accessToken) })).statusCode, 400);
    assert.ok((await db.query('SELECT id FROM deleted_account_archive_access WHERE archived_user_id=$1 AND actor_user_id=$2', [owner.user.id, admin.user.id])).rowCount);
    for (let index = 0; index < 30; index++) {
      await processDeletionBatch({ limit: 10, now: new Date(Date.now() + index * 60_000) });
      if (!(await db.query('SELECT id FROM users WHERE id=$1', [owner.user.id])).rowCount) break;
    }
    assert.equal((await db.query('SELECT id FROM users WHERE id=$1', [owner.user.id])).rowCount, 0);
    assert.equal((await app.inject({ method: 'GET', url: archiveUrl, headers: bearer(admin.accessToken) })).statusCode, 200);
    const banUrl = `${archiveUrl}/ip-bans`;
    const ban = (address: string, token = admin.accessToken) => app.inject({ method: 'POST', url: banUrl,
      headers: bearer(token), payload: { ip: address, reason: 'Serious platform violation' } });
    assert.equal((await ban(ip, moderator.accessToken)).statusCode, 403);
    assert.equal((await ban('192.0.2.0/24')).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: banUrl, remoteAddress: secondIp,
      headers: bearer(admin.accessToken), payload: { ip: secondIp, reason: 'Own address fixture' } })).statusCode, 409);
    assert.equal((await ban('192.0.2.199')).statusCode, 409);
    const banned = await ban(ip);
    assert.equal(banned.statusCode, 201, banned.body);
    banId = banned.json().ban.id;
    assert.equal((await app.inject({ method: 'GET', url: '/auth/me', remoteAddress: ip, headers: bearer(moderator.accessToken) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: ip, payload: { login: moderator.username, password: 'Archive-password-123' } })).statusCode, 403);
    // Normalized IPv4-mapped IPv6 must enforce the same ban.
    assert.equal((await app.inject({ method: 'GET', url: '/auth/me', remoteAddress: `::ffff:${ip}`, headers: bearer(moderator.accessToken) })).statusCode, 403);
    // A direct public peer cannot bypass the ban by choosing X-Forwarded-For.
    assert.equal((await app.inject({ method: 'GET', url: '/auth/me', remoteAddress: ip,
      headers: { ...bearer(moderator.accessToken), 'x-forwarded-for': '192.0.2.200' } })).statusCode, 403);
    await db.query('UPDATE deleted_account_archives SET expires_at=now() WHERE user_id=$1', [owner.user.id]);
    assert.equal((await app.inject({ method: 'GET', url: archiveUrl, headers: bearer(admin.accessToken) })).statusCode, 404);
    assert.equal((await ban(secondIp)).statusCode, 404);
    const list = await app.inject({ method: 'GET', url: `/admin/deleted-accounts?query=${owner.username}`, headers: bearer(admin.accessToken) });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().items.length, 0);
    await cleanupDeletionRetention(new Date());
    assert.equal((await db.query('SELECT user_id FROM deleted_account_archives WHERE user_id=$1', [owner.user.id])).rowCount, 0);
    assert.equal((await db.query('SELECT id FROM deleted_account_archive_access WHERE archived_user_id=$1', [owner.user.id])).rowCount, 0);
    assert.equal((await db.query('SELECT id FROM platform_ip_bans WHERE id=$1 AND revoked_at IS NULL', [banId])).rowCount, 1);
    const unban = await app.inject({ method: 'POST', url: `/admin/ip-bans/${banId}/revoke`, headers: bearer(admin.accessToken), payload: { reason: 'Review complete' } });
    assert.equal(unban.statusCode, 200, unban.body);
    assert.equal((await db.query('SELECT id FROM platform_ip_ban_events WHERE ban_id=$1', [banId])).rowCount, 2);
    assert.equal((await app.inject({ method: 'GET', url: '/auth/me', remoteAddress: ip, headers: bearer(moderator.accessToken) })).statusCode, 200);
  } finally {
    await app.close();
    if (failureTrigger) await db.query('DROP TRIGGER IF EXISTS test_archive_acceptance_failure ON account_deletion_events');
    await db.query('DROP FUNCTION IF EXISTS test_archive_acceptance_failure()');
    if (banId) await db.query('DELETE FROM platform_ip_bans WHERE id=$1', [banId]);
    await db.query('DELETE FROM deleted_account_archives WHERE user_id=ANY($1::uuid[])', [userIds]).catch(() => undefined);
    if (operationId) await db.query('DELETE FROM account_deletion_operations WHERE id=$1', [operationId]);
    if (caseId) await db.query('DELETE FROM moderation_cases WHERE id=$1', [caseId]);
    await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [userIds]);
    await Promise.all([closeDatabaseConnection(), closeRedisConnection(), closeStorageConnection()]);
  }
});
