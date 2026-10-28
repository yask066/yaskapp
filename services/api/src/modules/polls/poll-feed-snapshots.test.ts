import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test, type TestContext } from 'node:test';

const testDatabaseUrl = process.env.PAGINATION_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test('poll feed snapshot lifecycle (requires PAGINATION_TEST_DATABASE_URL)', { skip: 'set PAGINATION_TEST_DATABASE_URL to a dedicated migrated PostgreSQL database' }, () => {});
} else {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
  process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
  process.env.S3_BUCKET ??= 'pagination-test';
  process.env.S3_ACCESS_KEY_ID ??= 'pagination-test';
  process.env.S3_SECRET_ACCESS_KEY ??= 'pagination-test';

  const [{ db }, { createPollCursorOwnerKey }] = await Promise.all([
    import('../../config/database.js'),
    import('./poll-pagination.js')
  ]);

  after(async () => {
    await db.end();
  });

  type PollSeed = {
    id: string;
    votes: number;
    likes: number;
    comments: number;
    createdAt: string;
  };

  async function createFixture(context: TestContext, bulkPollCount = 0) {
    const suffix = randomUUID().replaceAll('-', '');
    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (email, username, password_hash)
       VALUES ($1, $2, 'test-hash')
       RETURNING id`,
      [`t22_${suffix}@yaskapp.test`, `t22_${suffix.slice(0, 24)}`]
    );
    const userId = userResult.rows[0]!.id;
    const polls: PollSeed[] = [
      { id: randomUUID(), votes: 100, likes: 0, comments: 0, createdAt: '2026-01-01T00:00:00Z' },
      { id: randomUUID(), votes: 3, likes: 0, comments: 0, createdAt: '2026-01-03T00:00:00Z' },
      { id: randomUUID(), votes: 0, likes: 4, comments: 0, createdAt: '2026-01-02T00:00:00Z' },
      { id: randomUUID(), votes: 0, likes: 0, comments: 6, createdAt: '2026-01-04T00:00:00Z' }
    ];
    await db.query(
      `INSERT INTO polls (id, author_id, question, visibility, votes_count, likes_count, comments_count, created_at, updated_at)
       SELECT value.id, value.author_id, value.question, value.visibility::poll_visibility,
              value.votes, value.likes, value.comments, value.created_at::timestamptz, value.created_at::timestamptz
       FROM jsonb_to_recordset($1::jsonb) AS value(
         id uuid, author_id uuid, question text, visibility text, votes integer, likes integer, comments integer, created_at text
       )`,
      [JSON.stringify(polls.map((poll) => ({
        id: poll.id,
        author_id: userId,
        question: `Snapshot fixture ${poll.id}`,
        visibility: 'public',
        votes: poll.votes,
        likes: poll.likes,
        comments: poll.comments,
        created_at: poll.createdAt
      })))]
    );

    const bulkPollIds = Array.from({ length: bulkPollCount }, () => randomUUID());
    if (bulkPollIds.length > 0) {
      await db.query(
        `INSERT INTO polls (id, author_id, question, visibility, created_at, updated_at)
         SELECT poll_id, $1, 'Bulk snapshot fixture', 'public',
                TIMESTAMPTZ '2026-02-01 00:00:00+00' + ordinal * INTERVAL '1 millisecond',
                TIMESTAMPTZ '2026-02-01 00:00:00+00' + ordinal * INTERVAL '1 millisecond'
         FROM unnest($2::uuid[]) WITH ORDINALITY AS generated(poll_id, ordinal)`,
        [userId, bulkPollIds]
      );
    }

    const identities = {
      user: { type: 'user' as const, userId },
      otherUser: { type: 'user' as const, userId: randomUUID() }
    };
    const ownerKey = createPollCursorOwnerKey(identities.user);
    const otherOwnerKey = createPollCursorOwnerKey(identities.otherUser);

    context.after(async () => {
      await db.query('DELETE FROM poll_feed_snapshots WHERE owner_key = ANY($1::text[])', [[ownerKey, otherOwnerKey]]);
      await db.query('DELETE FROM users WHERE id = $1', [userId]);
    });

    return { userId, identities, ownerKey, otherOwnerKey, polls, bulkPollIds };
  }

  async function loadRepository() {
    try {
      return await import('./poll-feed-snapshots.repository.js');
    } catch {
      assert.fail('poll-feed-snapshots.repository.ts must export the snapshot lifecycle operations');
    }
  }

  test('stores the complete popular rank and continues through immutable ID pages', async (context) => {
    const { createFeedSnapshot, readFeedSnapshotPage } = await loadRepository();
    const fixture = await createFixture(context, 1001);
    const snapshot = await createFeedSnapshot(fixture.identities.user);

    assert.equal(snapshot.ownerKey, fixture.ownerKey);
    assert.notEqual(snapshot.ownerKey, fixture.userId);

    const firstPage = await readFeedSnapshotPage({
      snapshotId: snapshot.snapshotId,
      ownerKey: fixture.ownerKey,
      afterPosition: -1,
      limit: 2
    });
    assert.ok(firstPage);
    assert.deepEqual(firstPage.items.map((item) => item.pollId), [fixture.polls[0]!.id, fixture.polls[3]!.id]);
    assert.equal(firstPage.nextPosition, 1);

    await db.query('UPDATE polls SET votes_count = 0 WHERE id = $1', [fixture.polls[0]!.id]);

    const allIds = [...firstPage.items.map((item) => item.pollId)];
    let afterPosition: number | null = firstPage.nextPosition;
    while (afterPosition !== null) {
      const page = await readFeedSnapshotPage({
        snapshotId: snapshot.snapshotId,
        ownerKey: fixture.ownerKey,
        afterPosition,
        limit: 50
      });
      assert.ok(page);
      allIds.push(...page.items.map((item) => item.pollId));
      afterPosition = page.nextPosition;
    }

    assert.deepEqual(allIds.slice(0, 4), [fixture.polls[0]!.id, fixture.polls[3]!.id, fixture.polls[1]!.id, fixture.polls[2]!.id]);
    const uniqueIds = new Set(allIds);
    const expectedFixtureIds = [...fixture.polls.map((poll) => poll.id), ...fixture.bulkPollIds];
    assert.ok(expectedFixtureIds.every((pollId) => uniqueIds.has(pollId)));
    assert.equal(uniqueIds.size, allIds.length);
  });

  test('keeps a fixed 30-minute expiry and refuses reads from another owner', async (context) => {
    const { createFeedSnapshot, readFeedSnapshotPage } = await loadRepository();
    const fixture = await createFixture(context);
    const snapshot = await createFeedSnapshot(fixture.identities.user);
    const ttl = await db.query<{ seconds: string; expires_at: string }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - created_at))::text AS seconds,
              expires_at::text AS expires_at
       FROM poll_feed_snapshots WHERE id = $1`,
      [snapshot.snapshotId]
    );

    assert.equal(ttl.rows[0]?.seconds, '1800.000000');
    assert.equal(await readFeedSnapshotPage({
      snapshotId: snapshot.snapshotId,
      ownerKey: fixture.otherOwnerKey,
      afterPosition: -1,
      limit: 20
    }), null);
    assert.ok(await readFeedSnapshotPage({
      snapshotId: snapshot.snapshotId,
      ownerKey: fixture.ownerKey,
      afterPosition: -1,
      limit: 20
    }));

    const expiryAfterRead = await db.query<{ expires_at: string }>(
      'SELECT expires_at::text AS expires_at FROM poll_feed_snapshots WHERE id = $1',
      [snapshot.snapshotId]
    );
    assert.equal(expiryAfterRead.rows[0]?.expires_at, ttl.rows[0]?.expires_at);
  });

  test('evicts the oldest snapshot and enforces the owner quota during concurrent creation', async (context) => {
    const { createFeedSnapshot, readFeedSnapshotPage } = await loadRepository();
    const fixture = await createFixture(context);
    const sequential = [];
    for (let index = 0; index < 4; index += 1) {
      sequential.push(await createFeedSnapshot(fixture.identities.user));
    }

    assert.equal(await readFeedSnapshotPage({
      snapshotId: sequential[0]!.snapshotId,
      ownerKey: fixture.ownerKey,
      afterPosition: -1,
      limit: 20
    }), null);

    await db.query('DELETE FROM poll_feed_snapshots WHERE owner_key = $1', [fixture.ownerKey]);
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => createFeedSnapshot(fixture.identities.user))
    );
    const count = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM poll_feed_snapshots
       WHERE owner_key = $1 AND expires_at > clock_timestamp()`,
      [fixture.ownerKey]
    );

    assert.equal(count.rows[0]?.count, '3');
    const readable = await Promise.all(concurrent.map((snapshot) => readFeedSnapshotPage({
      snapshotId: snapshot.snapshotId,
      ownerKey: fixture.ownerKey,
      afterPosition: -1,
      limit: 20
    })));
    assert.equal(readable.filter(Boolean).length, 3);
  });

  test('deletes expired snapshots and their ordered IDs', async (context) => {
    const { createFeedSnapshot, deleteExpiredFeedSnapshots, readFeedSnapshotPage } = await loadRepository();
    const fixture = await createFixture(context);
    const snapshot = await createFeedSnapshot(fixture.identities.user);
    await db.query(
      `WITH old_time AS (SELECT clock_timestamp() - INTERVAL '31 minutes' AS value)
       UPDATE poll_feed_snapshots
       SET created_at = old_time.value, expires_at = old_time.value + INTERVAL '30 minutes'
       FROM old_time WHERE id = $1`,
      [snapshot.snapshotId]
    );

    assert.equal(await readFeedSnapshotPage({
      snapshotId: snapshot.snapshotId,
      ownerKey: fixture.ownerKey,
      afterPosition: -1,
      limit: 20
    }), null);
    assert.equal(await deleteExpiredFeedSnapshots(), 1);
    const items = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM poll_feed_snapshot_items WHERE snapshot_id = $1',
      [snapshot.snapshotId]
    );
    assert.equal(items.rows[0]?.count, '0');
    assert.equal(await readFeedSnapshotPage({
      snapshotId: snapshot.snapshotId,
      ownerKey: fixture.ownerKey,
      afterPosition: -1,
      limit: 20
    }), null);
  });
}
