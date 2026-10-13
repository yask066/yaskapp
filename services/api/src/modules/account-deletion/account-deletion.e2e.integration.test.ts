import assert from 'node:assert/strict';
import { test } from 'node:test';

const testDatabaseUrl = process.env.ACCOUNT_DELETION_TEST_DATABASE_URL;
const requiredEnvironment = [
  'REDIS_URL',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'ACCOUNT_DELETION_JOURNAL_ENDPOINT',
  'ACCOUNT_DELETION_JOURNAL_BUCKET',
  'ACCOUNT_DELETION_JOURNAL_ID',
  'ACCOUNT_DELETION_JOURNAL_ACCESS_KEY_ID',
  'ACCOUNT_DELETION_JOURNAL_SECRET_ACCESS_KEY',
  'ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ENDPOINT',
  'ACCOUNT_DELETION_JOURNAL_CHECKPOINT_BUCKET',
  'ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ACCESS_KEY_ID',
  'ACCOUNT_DELETION_JOURNAL_CHECKPOINT_SECRET_ACCESS_KEY',
  'ACCOUNT_DELETION_JOURNAL_HMAC_KEY',
  'ACCOUNT_DELETION_ENABLED'
];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

test('account_deletion_e2e_closes_sessions_across_api_instances_cleans_with_worker_and_allows_reregistration', {
  skip: !testDatabaseUrl || missingEnvironment.length > 0
    ? `requires ACCOUNT_DELETION_TEST_DATABASE_URL and deletion integration services${missingEnvironment.length ? `; missing: ${missingEnvironment.join(', ')}` : ''}`
    : false
}, async () => {
  const databaseUrl = new URL(testDatabaseUrl!);
  assert.match(databaseUrl.pathname, /test/i, 'integration tests require a dedicated test database');
  assert.equal(process.env.DATABASE_URL, testDatabaseUrl, 'DATABASE_URL must target the dedicated deletion test database');
  assert.equal(process.env.ACCOUNT_DELETION_ENABLED, 'true', 'the test environment must enable account deletion');
  assert.match(process.env.S3_BUCKET ?? '', /test/i, 'media storage must use a dedicated test bucket');
  assert.match(process.env.ACCOUNT_DELETION_JOURNAL_BUCKET ?? '', /test/i, 'journal storage must use a dedicated test bucket');
  assert.match(process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_BUCKET ?? '', /test/i, 'checkpoint storage must use a dedicated test bucket');

  // The app's safety stub is active under NODE_ENV=test / NODE_TEST_CONTEXT.
  // This integration test deliberately opts into real journal I/O only after
  // the dedicated database and test-bucket guards above have passed.
  delete process.env.NODE_TEST_CONTEXT;
  process.env.NODE_ENV = 'development';

  const [{ buildApp }, { db, closeDatabaseConnection }, { closeRedisConnection }, { closeStorageConnection }, { processDeletionBatch }, { S3Client, GetObjectCommand, ListObjectsV2Command }] = await Promise.all([
    import('../../app.js'),
    import('../../config/database.js'),
    import('../../config/redis.js'),
    import('../../config/storage.js'),
    import('./account-deletion.worker.js'),
    import('@aws-sdk/client-s3')
  ]);
  const apiNodeA = buildApp();
  const apiNodeB = buildApp();
  const createdUserIds = new Set<string>();
  const operationIds = new Set<string>();
  const journalClient = new S3Client({
    endpoint: process.env.ACCOUNT_DELETION_JOURNAL_ENDPOINT,
    region: process.env.ACCOUNT_DELETION_JOURNAL_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.ACCOUNT_DELETION_JOURNAL_ACCESS_KEY_ID!,
      secretAccessKey: process.env.ACCOUNT_DELETION_JOURNAL_SECRET_ACCESS_KEY!
    }
  });
  const checkpointClient = new S3Client({
    endpoint: process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ENDPOINT,
    region: process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ACCESS_KEY_ID!,
      secretAccessKey: process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_SECRET_ACCESS_KEY!
    }
  });
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

    const acceptedObject = await journalClient.send(new GetObjectCommand({
      Bucket: process.env.ACCOUNT_DELETION_JOURNAL_BUCKET,
      Key: `account-deletions/accepted/${receipt.operationId}.json`
    }));
    const acceptedEntry = JSON.parse(await acceptedObject.Body!.transformToString()) as { state: string; operationId: string };
    assert.equal(acceptedEntry.state, 'accepted');
    assert.equal(acceptedEntry.operationId, receipt.operationId);

    const checkpointObject = await checkpointClient.send(new GetObjectCommand({
      Bucket: process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_BUCKET,
      Key: `account-deletions/checkpoint/${receipt.operationId}.json`
    }));
    const checkpointEntry = JSON.parse(await checkpointObject.Body!.transformToString()) as { state: string; operationId: string };
    assert.equal(checkpointEntry.state, 'checkpoint');
    assert.equal(checkpointEntry.operationId, receipt.operationId);

    const preparedObjects = await journalClient.send(new ListObjectsV2Command({
      Bucket: process.env.ACCOUNT_DELETION_JOURNAL_BUCKET,
      Prefix: `account-deletions/prepared/${receipt.operationId}/`
    }));
    assert.ok(preparedObjects.Contents?.some((object) => object.Key?.endsWith('.json')), 'prepared intent must be durable');

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

    const status = await apiNodeB.inject({
      method: 'GET',
      url: '/auth/account-deletion/status',
      headers: { authorization: `Bearer ${receipt.statusToken}` }
    });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json<{ status: string }>().status, 'completed');

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
      const shutdown = await Promise.allSettled([
        apiNodeA.close(), apiNodeB.close(),
        closeDatabaseConnection(), closeRedisConnection(), closeStorageConnection(),
        journalClient.destroy(), checkpointClient.destroy()
      ]);
      for (const result of shutdown) if (result.status === 'rejected') cleanupFailures.push(result.reason);
    }
    if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'account deletion E2E cleanup failed');
  }
});
