import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

const testDatabaseUrl = process.env.ACCOUNT_DELETION_TEST_DATABASE_URL;

test('self_service_deletion_completes_using_only_the_application_database', {
  skip: !testDatabaseUrl && 'requires a dedicated ACCOUNT_DELETION_TEST_DATABASE_URL, Redis and media storage'
}, async (t) => {
  assert.match(new URL(testDatabaseUrl!).pathname, /test/i);
  assert.equal(process.env.DATABASE_URL, testDatabaseUrl);
  assert.match(process.env.S3_BUCKET ?? '', /test/i);

  // Exercise the real runtime adapters: the journal adapter normally skips I/O
  // under node:test, which previously concealed the production dependency.
  process.env.NODE_ENV = 'development';
  delete process.env.NODE_TEST_CONTEXT;
  process.env.ACCOUNT_DELETION_ENABLED = 'true';
  process.env.CORS_ORIGINS = 'http://localhost:5173';
  process.env.ACCOUNT_DELETION_JOURNAL_ENABLED = 'false';
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ACCOUNT_DELETION_JOURNAL_') && key !== 'ACCOUNT_DELETION_JOURNAL_ENABLED') delete process.env[key];
  }

  const [{ buildApp }, { db, closeDatabaseConnection }, { closeRedisConnection },
    { closeStorageConnection }, { processDeletionBatch }, { cleanupDeletionRetention }] = await Promise.all([
    import('../../app.js'), import('../../config/database.js'), import('../../config/redis.js'),
    import('../../config/storage.js'), import('./account-deletion.worker.js'), import('./account-deletion.retention.js')
  ]);
  let app = buildApp();
  const observer = buildApp();
  const userIds: string[] = [];
  const operationIds: string[] = [];
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode, 200);
    const viewerName = `viewer_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const viewerResponse = await observer.inject({
      method: 'POST', url: '/auth/register',
      remoteAddress: `2001:db8::${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}`,
      payload: { email: `${viewerName}@yaskapp.test`, username: viewerName, password: 'Viewer-password-123', displayName: 'Viewer', countryCode: 'BY' }
    });
    assert.equal(viewerResponse.statusCode, 201, viewerResponse.body);
    const viewer = viewerResponse.json<{ user: { id: string }; accessToken: string }>();
    userIds.push(viewer.user.id);

    for (const mode of ['bearer', 'cookie', 'blocked'] as const) {
      await t.test(mode, async () => {
        const requestIp = `2001:db8::${randomUUID().slice(0, 4)}:${randomUUID().slice(0, 4)}`;
        const requestHeaders = { 'x-forwarded-for': requestIp };
        const username = `del_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
        const password = 'Deletion-local-password-123';
        const registration = await app.inject({
          method: 'POST', url: '/auth/register',
          remoteAddress: requestIp,
          payload: { email: `${username}@yaskapp.test`, username, password, displayName: 'Deletion test', countryCode: 'BY' }
        });
        assert.equal(registration.statusCode, 201, registration.body);
        const { user, accessToken } = registration.json<{ user: { id: string }; accessToken: string }>();
        userIds.push(user.id);
        const cookie = `yaskapp_session=${accessToken}`;
        const pollResponse = await app.inject({
          method: 'POST', url: '/polls', headers: { ...requestHeaders, authorization: `Bearer ${accessToken}` },
          payload: { question: 'Self service deletion fixture', options: ['One', 'Two'] }
        });
        assert.equal(pollResponse.statusCode, 201, pollResponse.body);
        const pollId = pollResponse.json<{ poll: { id: string } }>().poll.id;
        if (mode === 'blocked') await db.query("UPDATE users SET status = 'blocked' WHERE id = $1", [user.id]);
        const headers = mode === 'bearer'
          ? { ...requestHeaders, authorization: `Bearer ${accessToken}` }
          : { ...requestHeaders, cookie, origin: 'http://localhost:5173' };
        const verification = await app.inject({
          method: 'POST', url: '/auth/account-deletion/verification', headers,
          payload: mode === 'blocked' ? { login: username, password } : { password }
        });
        assert.equal(verification.statusCode, 200, verification.body);
        const receipt = verification.json<{ operationId: string; deletionToken: string; statusToken: string }>();
        operationIds.push(receipt.operationId);
        const accept = () => app.inject({
          method: 'DELETE', url: '/auth/me', headers: { ...requestHeaders, authorization: `Bearer ${receipt.deletionToken}` },
          payload: { confirm: true }
        });
        const accepted = await accept();
        assert.equal(accepted.statusCode, 202, accepted.body);
        assert.equal(accepted.json().status, 'pending');
        assert.match(String(accepted.headers['set-cookie']), /Max-Age=0/);
        assert.equal((await accept()).json().operationId, receipt.operationId);
        const revoked = await observer.inject({ method: 'GET', url: '/auth/me', headers: { ...requestHeaders, authorization: `Bearer ${accessToken}` } });
        assert.equal(revoked.statusCode, 401);
        assert.equal((await observer.inject({ method: 'GET', url: '/auth/me', headers: { ...requestHeaders, cookie } })).statusCode, 401);
        assert.equal((await observer.inject({ method: 'GET', url: `/polls/${pollId}`, headers: { ...requestHeaders, authorization: `Bearer ${viewer.accessToken}` } })).statusCode, 404);

        // The durable queue and status permission survive an API restart.
        await app.close();
        app = buildApp();
        const status = () => app.inject({
          method: 'GET', url: '/auth/account-deletion/status', headers: { ...requestHeaders, authorization: `Bearer ${receipt.statusToken}` }
        });
        assert.equal((await status()).json().status, 'pending');
        let completed = false;
        for (let batch = 0; batch < 30; batch += 1) {
          await processDeletionBatch({ limit: 10, now: new Date(Date.now() + batch * 60_000) });
          const response = await status();
          assert.equal(response.statusCode, 200, response.body);
          if (response.json().status === 'completed') { completed = true; break; }
        }
        assert.ok(completed, 'cleanup must finish without journal configuration');
        assert.equal((await db.query('SELECT id FROM users WHERE id = $1', [user.id])).rowCount, 0);
        assert.equal((await db.query('SELECT id FROM polls WHERE id = $1', [pollId])).rowCount, 0);
        assert.equal((await db.query("SELECT step_key FROM account_deletion_steps WHERE operation_id = $1 AND status = 'completed'", [receipt.operationId])).rowCount, 7);
        const login = await observer.inject({ method: 'POST', url: '/auth/login', headers: requestHeaders, payload: { login: username, password } });
        assert.equal(login.statusCode, 401);
      });
    }
    // Retention also runs without the legacy journal's privileged credentials.
    await db.query(
      `UPDATE account_deletion_operations
       SET accepted_at = now() - interval '36 days', deadline_at = now() - interval '35 days'
       WHERE id = $1`, [operationIds[0]]
    );
    await cleanupDeletionRetention(new Date());
    assert.equal((await db.query('SELECT id FROM account_deletion_operations WHERE id = $1', [operationIds[0]])).rowCount, 0);
  } finally {
    await Promise.all([app.close(), observer.close()]);
    await db.query('DELETE FROM account_deletion_operations WHERE id = ANY($1::uuid[])', [operationIds]);
    await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    await db.query('DELETE FROM deleted_account_archives WHERE user_id = ANY($1::uuid[])', [userIds]);
    await Promise.all([closeDatabaseConnection(), closeRedisConnection(), closeStorageConnection()]);
  }
});
