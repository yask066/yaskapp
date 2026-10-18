import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';

const testDatabaseUrl = process.env.ACCOUNT_DELETION_TEST_DATABASE_URL;
const requiredEnvironment = [
  'REDIS_URL',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'ACCOUNT_DELETION_JOURNAL_DATABASE_URL',
  'ACCOUNT_DELETION_JOURNAL_ID',
  'ACCOUNT_DELETION_JOURNAL_HMAC_KEY',
  'ACCOUNT_DELETION_ENABLED'
];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);
const integrationSkip = !testDatabaseUrl || missingEnvironment.length > 0
  ? `requires ACCOUNT_DELETION_TEST_DATABASE_URL and dedicated deletion integration services${missingEnvironment.length ? `; missing: ${missingEnvironment.join(', ')}` : ''}`
  : false;
let closeIntegrationConnections: (() => Promise<void>) | undefined;

after(async () => {
  await closeIntegrationConnections?.();
});

async function registerAccountForDeletion(app: Pick<FastifyInstance, 'inject'>, suffix: string) {
  const email = `ad15_${suffix}@yaskapp.test`;
  const username = `ad15_${suffix}`;
  const registration = await app.inject({
    method: 'POST', url: '/auth/register',
    payload: { email, username, password: 'Deletion-e2e-password-123', displayName: 'Account deletion E2E', countryCode: 'BY' }
  });
  assert.equal(registration.statusCode, 201, registration.body);
  const account = registration.json<{ user: { id: string }; accessToken: string }>();
  const verification = await app.inject({
    method: 'POST', url: '/auth/account-deletion/verification',
    headers: { authorization: `Bearer ${account.accessToken}` },
    payload: { password: 'Deletion-e2e-password-123' }
  });
  assert.equal(verification.statusCode, 200, verification.body);
  return { account, receipt: verification.json<{ operationId: string; deletionToken: string; statusToken: string }>() };
}

test('e2e_acceptance_persists_prepared_and_accepted_rows', { skip: integrationSkip }, async (t) => {
  const databaseUrl = new URL(testDatabaseUrl!);
  const journalDatabaseUrl = new URL(process.env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL!);
  assert.match(databaseUrl.pathname, /test/i, 'integration tests require a dedicated test database');
  assert.match(journalDatabaseUrl.pathname, /test/i, 'integration tests require a dedicated journal test database');
  assert.notEqual(journalDatabaseUrl.href, databaseUrl.href, 'application and journal test databases must be distinct');
  assert.equal(process.env.DATABASE_URL, testDatabaseUrl, 'DATABASE_URL must target the dedicated deletion test database');
  assert.equal(process.env.ACCOUNT_DELETION_ENABLED, 'true', 'the test environment must enable account deletion');
  assert.match(process.env.S3_BUCKET ?? '', /test/i, 'media storage must use a dedicated test bucket');

  // Parse the test configuration first so dedicated localhost journal URLs
  // pass the environment guard. The journal adapter checks NODE_ENV at call
  // time, so switch to development after imports to opt into real journal I/O.
  delete process.env.NODE_TEST_CONTEXT;
  process.env.NODE_ENV = 'test';
  process.env.ACCOUNT_DELETION_JOURNAL_ENABLED = 'true';

  const [{ buildApp }, { db, closeDatabaseConnection }, { closeRedisConnection }, { closeStorageConnection }, { processDeletionBatch }, { closeAccountDeletionJournalDatabase }, { readAcceptedDeletionsFromJournal, reconcileAccountDeletionJournal }, { reapplyAcceptedDeletions }] = await Promise.all([
    import('../../app.js'),
    import('../../config/database.js'),
    import('../../config/redis.js'),
    import('../../config/storage.js'),
    import('./account-deletion.worker.js'),
    import('../../config/account-deletion-journal-database.js'),
    import('./account-deletion.journal.js'),
    import('./account-deletion.restore.js')
  ]);
  process.env.NODE_ENV = 'development';
  closeIntegrationConnections = async () => {
    await Promise.all([
      closeDatabaseConnection(), closeRedisConnection(), closeStorageConnection(),
      closeAccountDeletionJournalDatabase()
    ]);
  };
  let apiNodeA = buildApp();
  let apiNodeB = buildApp();
  const createdUserIds = new Set<string>();
  const operationIds = new Set<string>();
  const journalDb = new pg.Pool({ connectionString: process.env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL, max: 2 });
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `ad15_${suffix}@yaskapp.test`;
  const username = `ad15_${suffix}`;
  try {
    const unprocessedOperations = await db.query<{ id: string }>(
      `SELECT id FROM account_deletion_operations
       WHERE accepted_at IS NOT NULL AND status <> 'completed'
       LIMIT 1`
    );
    assert.equal(unprocessedOperations.rowCount, 0, 'the dedicated test database must not contain other accepted operations');
    const register = async (app: typeof apiNodeA, emailValue: string, usernameValue: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: emailValue,
          username: usernameValue,
          password: 'Deletion-e2e-password-123',
          displayName: 'Account deletion E2E',
          countryCode: 'BY'
        }
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json<{ user: { id: string }; accessToken: string }>();
    };

    const account = await register(apiNodeA, email, username);
    createdUserIds.add(account.user.id);
    const survivor = await register(apiNodeB, `viewer_${suffix}@yaskapp.test`, `viewer_${suffix}`);
    createdUserIds.add(survivor.user.id);
    await db.query(
      `INSERT INTO notification_devices (user_id, token, platform)
       VALUES ($1, $2, 'ios'), ($1, $3, 'android')`,
      [account.user.id, `ad15-ios-${suffix}`, `ad15-android-${suffix}`]
    );
    await db.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)', [account.user.id, survivor.user.id]);
    await db.query(
      `INSERT INTO notifications (recipient_user_id, actor_user_id, type, payload)
       VALUES ($1, $2, 'follow', $3::jsonb)`,
      [survivor.user.id, account.user.id, JSON.stringify({ displayName: 'Private AD-15 fixture data' })]
    );

    const pollResponse = await apiNodeA.inject({
      method: 'POST',
      url: '/polls',
      headers: { authorization: `Bearer ${account.accessToken}` },
      payload: { question: 'AD-15 end-to-end owned poll', options: ['One', 'Two'] }
    });
    assert.equal(pollResponse.statusCode, 201, pollResponse.body);
    const pollId = pollResponse.json<{ poll: { id: string } }>().poll.id;

    const verification = await apiNodeA.inject({
      method: 'POST',
      url: '/auth/account-deletion/verification',
      headers: { authorization: `Bearer ${account.accessToken}` },
      payload: { password: 'Deletion-e2e-password-123' }
    });
    assert.equal(verification.statusCode, 200, verification.body);
    const receipt = verification.json<{ operationId: string; deletionToken: string; statusToken: string }>();
    operationIds.add(receipt.operationId);

    const accepted = await apiNodeA.inject({
      method: 'DELETE',
      url: '/auth/me',
      headers: { authorization: `Bearer ${receipt.deletionToken}` },
      payload: { confirm: true }
    });
    assert.equal(accepted.statusCode, 202, accepted.body);
    assert.equal(accepted.json<{ operationId: string }>().operationId, receipt.operationId);

    const journalRows = await journalDb.query<{
      state: string;
      operation_id: string;
      user_id: string;
      payload: unknown;
      hmac: string;
    }>(
      `SELECT state, operation_id, user_id, payload, hmac
       FROM account_deletion_journal_entries WHERE operation_id = $1 ORDER BY state`,
      [receipt.operationId]
    );
    assert.deepEqual(journalRows.rows.map(({ state }) => state), ['accepted', 'prepared']);
    assert.ok(journalRows.rows.every((row) => row.operation_id === receipt.operationId && row.user_id === account.user.id));
    const { verifyJournalEntry } = await import('./account-deletion.journal.js');
    assert.ok(journalRows.rows.every((row) => verifyJournalEntry(row.payload, process.env.ACCOUNT_DELETION_JOURNAL_HMAC_KEY!)));
    assert.ok(journalRows.rows.every((row) => {
      if (!row.payload || typeof row.payload !== 'object') return false;
      const entry = row.payload as { operationId?: string; userId?: string; state?: string; hmac?: string };
      return entry.operationId === receipt.operationId && entry.userId === account.user.id &&
        entry.state === row.state && entry.hmac === row.hmac;
    }));
    assert.ok(journalRows.rows.every((row) => /^[a-f0-9]{64}$/.test(row.hmac)));

    const oldSessionOnSecondNode = await apiNodeB.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${account.accessToken}` }
    });
    assert.equal(oldSessionOnSecondNode.statusCode, 401, oldSessionOnSecondNode.body);

    const feedOnSecondNode = await apiNodeB.inject({
      method: 'GET',
      url: '/polls',
      headers: { authorization: `Bearer ${survivor.accessToken}` }
    });
    assert.equal(
      feedOnSecondNode.json<{ items: Array<{ id: string }> }>().items.some(({ id }) => id === pollId),
      false,
      'owned content must be hidden immediately on every API node'
    );

    await t.test('e2e_journal_outage_rejects_acceptance', async () => {
      const outageApp = buildApp({ accountDeletionJournal: {
        prepareDeletionInJournal: async () => { throw new Error('account_deletion_journal_unavailable'); },
        acceptDeletionInJournal: async () => { throw new Error('account_deletion_journal_unavailable'); }
      } });
      const outageSuffix = `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const { account: outageAccount, receipt: outageReceipt } = await registerAccountForDeletion(outageApp, outageSuffix);
      createdUserIds.add(outageAccount.user.id);
      operationIds.add(outageReceipt.operationId);
      try {
        const response = await outageApp.inject({
          method: 'DELETE', url: '/auth/me',
          headers: { authorization: `Bearer ${outageReceipt.deletionToken}` },
          payload: { confirm: true }
        });
        assert.equal(response.statusCode, 503, response.body);
        const state = await db.query<{ status: string; accepted_at: Date | null }>(
          `SELECT operation.status, operation.accepted_at
           FROM account_deletion_operations AS operation WHERE operation.id = $1`,
          [outageReceipt.operationId]
        );
        assert.equal(state.rows[0]?.status, 'not_started');
        assert.equal(state.rows[0]?.accepted_at, null, 'journal outage must not commit acceptance');
      } finally {
        await outageApp.close();
      }

      const postCommitApp = buildApp({ accountDeletionJournal: {
        acceptDeletionInJournal: async () => { throw new Error('account_deletion_journal_unavailable'); }
      } });
      const postCommitSuffix = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const { account: committedAccount, receipt: committedReceipt } = await registerAccountForDeletion(postCommitApp, postCommitSuffix);
      createdUserIds.add(committedAccount.user.id);
      operationIds.add(committedReceipt.operationId);
      try {
        const response = await postCommitApp.inject({
          method: 'DELETE', url: '/auth/me',
          headers: { authorization: `Bearer ${committedReceipt.deletionToken}` },
          payload: { confirm: true }
        });
        assert.equal(response.statusCode, 503, response.body);
        const state = await db.query<{ status: string; accepted_at: Date | null }>(
          `SELECT status, accepted_at FROM account_deletion_operations WHERE id = $1`,
          [committedReceipt.operationId]
        );
        assert.equal(state.rows[0]?.status, 'pending');
        assert.ok(state.rows[0]?.accepted_at, 'application acceptance must commit before the accepted journal write fails');
        await assert.rejects(readAcceptedDeletionsFromJournal(), /journal_incomplete/);
        const reconciliation = await reconcileAccountDeletionJournal(db);
        assert.equal(reconciliation.reconciled, 1, 'reconciler must repair a committed prepared-only operation');
        const repaired = await readAcceptedDeletionsFromJournal();
        assert.ok(repaired.some((entry) => entry.operationId === committedReceipt.operationId && entry.state === 'accepted'));
      } finally {
        await postCommitApp.close();
      }
    });

    await t.test('e2e_restore_replays_deletion_before_readiness', async () => {
      await apiNodeA.close();
      await apiNodeB.close();
      await db.query("UPDATE users SET status = 'active', deleted_at = NULL WHERE id = $1", [account.user.id]);
      await db.query('DELETE FROM account_deletion_operations WHERE id = $1', [receipt.operationId]);
      const acceptedEntries = await readAcceptedDeletionsFromJournal();
      const replay = await reapplyAcceptedDeletions(
        acceptedEntries.filter((entry) => entry.operationId === receipt.operationId)
      );
      assert.equal(replay.reapplied, 1, 'restore replay must apply the accepted journal entry');
      const restoredOperation = await db.query<{ accepted_at: Date; status: string }>(
        'SELECT accepted_at, status FROM account_deletion_operations WHERE id = $1', [receipt.operationId]
      );
      assert.ok(restoredOperation.rows[0]?.accepted_at, 'replay must recreate the missing operation from the journal');
      const restoredAccount = await db.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [account.user.id]);
      assert.equal(restoredAccount.rows[0]?.status, 'deleted', 'the restored account must stay closed before readiness is checked');
      apiNodeA = buildApp();
      apiNodeB = buildApp();
      const readyAfterReplay = await apiNodeA.inject({ method: 'GET', url: '/health/ready' });
      assert.equal(readyAfterReplay.statusCode, 200, readyAfterReplay.body);
    });

    let operationCompleted = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const worker = await processDeletionBatch({ limit: 1, now: new Date(Date.now() + attempt * 60_000) });
      const operation = await db.query<{ status: string }>(
        'SELECT status FROM account_deletion_operations WHERE id = $1',
        [receipt.operationId]
      );
      operationCompleted = operation.rows[0]?.status === 'completed';
      if (operationCompleted) break;
      assert.equal(worker.retrying, 0, `worker scheduled an unexpected retry: ${JSON.stringify(worker)}`);
      assert.equal(worker.processed, 1, `worker did not claim the fixture operation: ${JSON.stringify(worker)}`);
    }
    assert.equal(operationCompleted, true, 'worker did not complete the fixture operation within 20 batches');

    const completedOperation = await db.query<{ status: string }>(
      'SELECT status FROM account_deletion_operations WHERE id = $1', [receipt.operationId]
    );
    assert.equal(completedOperation.rows[0]?.status, 'completed');

    const oldIdentity = await db.query('SELECT id FROM users WHERE id = $1', [account.user.id]);
    const oldPoll = await db.query('SELECT id FROM polls WHERE id = $1', [pollId]);
    const oldDevices = await db.query('SELECT id FROM notification_devices WHERE user_id = $1', [account.user.id]);
    const oldFollow = await db.query('SELECT id FROM follows WHERE follower_id = $1 OR followee_id = $1', [account.user.id]);
    const oldNotification = await db.query('SELECT id FROM notifications WHERE actor_user_id = $1', [account.user.id]);
    assert.equal(oldIdentity.rowCount, 0);
    assert.equal(oldPoll.rowCount, 0);
    assert.equal(oldDevices.rowCount, 0);
    assert.equal(oldFollow.rowCount, 0);
    assert.equal(oldNotification.rowCount, 0);

    const reRegistered = await register(apiNodeB, email, username);
    createdUserIds.add(reRegistered.user.id);
    assert.notEqual(reRegistered.user.id, account.user.id);
    const freshProfile = await apiNodeA.inject({
      method: 'GET',
      url: `/users/${reRegistered.user.id}`
    });
    assert.equal(freshProfile.statusCode, 200, freshProfile.body);
    assert.equal(freshProfile.json<{ user: { id: string } }>().user.id, reRegistered.user.id);
  } finally {
    const cleanupFailures: unknown[] = [];
    try {
      for (const operationId of operationIds) {
        try { await db.query('DELETE FROM account_deletion_operations WHERE id = $1', [operationId]); }
        catch (error) { cleanupFailures.push(error); }
      }
      for (const userId of createdUserIds) {
        try { await db.query('DELETE FROM users WHERE id = $1', [userId]); }
        catch (error) { cleanupFailures.push(error); }
      }
    } finally {
      const shutdown = await Promise.allSettled([apiNodeA.close(), apiNodeB.close(), journalDb.end()]);
      for (const result of shutdown) if (result.status === 'rejected') cleanupFailures.push(result.reason);
    }
    if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'account deletion E2E cleanup failed');
  }
});
