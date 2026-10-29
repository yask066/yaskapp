import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanupUserBlockingFixtures,
  expandUserBlockingFixtures,
  seedUserBlockingFixtures,
  type UserBlockingFixtureDatabase
} from './user-blocks.fixtures.js';

test('user_blocking_fixture_expands_the_approved_scenario_matrix_deterministically', () => {
  const alpha = expandUserBlockingFixtures('fixture-alpha');
  const repeatedAlpha = expandUserBlockingFixtures('fixture-alpha');
  const beta = expandUserBlockingFixtures('fixture-beta');

  assert.deepEqual(alpha, repeatedAlpha);
  assert.ok(alpha.ids.accounts.every((id) => !beta.ids.accounts.includes(id)));

  const accountByKey = Object.fromEntries(alpha.accounts.map((account) => [account.key, account]));
  const accountId = (key: string) => accountByKey[key]!.id;
  assert.ok(alpha.follows.some((follow) => follow.follower_id === accountId('A') && follow.followee_id === accountId('B')));
  assert.ok(alpha.follows.some((follow) => follow.follower_id === accountId('B') && follow.followee_id === accountId('A')));
  const profileByUserId = new Map(alpha.profiles.map((profile) => [profile.user_id, profile]));
  assert.deepEqual(
    ['A', 'B', 'C'].map((key) => {
      const profile = profileByUserId.get(accountId(key))!;
      return [profile.polls_count, profile.followers_count, profile.following_count];
    }),
    [[3, 1, 1], [3, 1, 1], [1, 0, 0]]
  );
  assert.deepEqual(alpha.blockStates.map(({ blockedByA, blockedByB }) => [blockedByA, blockedByB]), [
    [false, false], [true, false], [false, true], [true, true]
  ]);
  assert.deepEqual(alpha.moderationControl, {
    moderatorKey: 'moderator',
    targetOwnerKey: 'B',
    targetType: 'comment',
    targetId: alpha.comments.root.id,
    blockerKey: 'B',
    blockedKey: 'moderator'
  });

  for (const authorKey of ['A', 'B', 'C']) {
    assert.deepEqual(
      alpha.polls.filter((poll) => poll.author_key === authorKey).map((poll) => poll.visibility).sort(),
      authorKey === 'C' ? ['public'] : ['followers', 'private', 'public']
    );
  }

  assert.equal(alpha.comments.root.author_key, 'B');
  assert.equal(alpha.comments.root.poll_author_key, 'C');
  assert.ok(alpha.comments.replies.length > 20);
  assert.ok(alpha.comments.replies.slice(20).every((reply) => ['A', 'C'].includes(reply.author_key)));

  assert.equal(alpha.notifications.some((notification) => notification.actor_key === 'B' && notification.read_at === null), true);
  assert.equal(alpha.notifications.some((notification) => notification.poll_author_key === 'B' && notification.read_at === null), true);
  assert.equal(alpha.notifications.find((notification) => notification.actor_key === 'B')?.type, 'comment');
  assert.equal(
    alpha.notifications.find((notification) => notification.actor_key === 'C')?.comment_id,
    alpha.comments.replies.find((reply) => reply.author_key === 'C')?.id
  );
  assert.ok(alpha.notifications.every((notification) => notification.created_at < '2026-09-25T00:00:00.000Z'));
  const pollById = new Map(alpha.polls.map((poll) => [poll.id, poll]));
  assert.ok(alpha.notifications.every((notification) => notification.created_at > pollById.get(notification.poll_id)!.created_at));
  assert.ok(alpha.notifications.filter((notification) => notification.comment_id !== null)
    .every((notification) => notification.created_at > alpha.comments.root.created_at));
  assert.ok(alpha.pushJobs.some((job) => job.status === 'pending'));
  assert.ok(alpha.pushJobs.some((job) => job.status === 'sending'));
  assert.ok(alpha.pushJobs.every((job) => job.created_at < '2026-09-25T00:00:00.000Z'));

  assert.deepEqual(alpha.requestContexts.map(({ kind }) => kind), ['guest', 'bearer', 'cookie']);
  assert.equal(accountByKey.moderator?.role, 'moderator');
  assert.equal(accountByKey.unavailable?.status, 'deleted');
  assert.notEqual(alpha.usernameReuse.previousUserId, alpha.usernameReuse.currentUserId);
  assert.equal(alpha.usernameReuse.previousUsername, accountByKey.reusedUsername?.username);
});

test('user_blocking_fixture_seed_is_repeatable_and_cleanup_is_limited_to_owned_ids', async () => {
  const database = new MemoryFixtureDatabase();
  const alpha = await seedUserBlockingFixtures(database, 'fixture-alpha');
  const beta = await seedUserBlockingFixtures(database, 'fixture-beta');
  const foreignUserId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const foreignPollId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const fixtureAccountId = expandUserBlockingFixtures('fixture-alpha').accounts.find((account) => account.key === 'A')!.id;
  database.rows.get('users')?.set(foreignUserId, { id: foreignUserId, username: 'outside_fixture' });
  database.rows.get('polls')?.set(foreignPollId, { id: foreignPollId });
  database.rows.get('follows')?.set('external-follow', {
    follower_id: foreignUserId,
    followee_id: fixtureAccountId
  });

  assert.deepEqual(alpha.ids.accounts, expandUserBlockingFixtures('fixture-alpha').ids.accounts);
  assert.notDeepEqual(alpha.ids.accounts, beta.ids.accounts);
  assert.equal(database.rows.get('notifications')?.size, alpha.ids.notifications.length + beta.ids.notifications.length);
  assert.equal(database.rows.get('notification_push_jobs')?.size, alpha.ids.pushJobs.length + beta.ids.pushJobs.length);

  const cleanupStart = database.queryLog.length;
  await assert.rejects(cleanupUserBlockingFixtures(database, alpha), /outside the fixture/);
  const cleanupQueries = database.queryLog.slice(cleanupStart);
  assert.match(cleanupQueries[1]!, /SELECT id\s+FROM users[\s\S]*FOR UPDATE/);
  assert.match(cleanupQueries[2]!, /SELECT 1[\s\S]*FROM follows/);
  assert.equal(database.rows.get('follows')?.has('external-follow'), true);
  assert.equal(database.rows.get('users')?.has(fixtureAccountId), true);

  database.rows.get('follows')?.delete('external-follow');
  await cleanupUserBlockingFixtures(database, alpha);

  for (const [table, ids] of Object.entries(alpha.idsByTable)) {
    const rows = database.rows.get(table)!;
    for (const id of ids) assert.equal(rows.has(id), false, `${table} should not retain fixture ID ${id}`);
  }
  for (const [table, ids] of Object.entries(beta.idsByTable)) {
    const rows = database.rows.get(table)!;
    for (const id of ids) assert.equal(rows.has(id), true, `${table} should retain other seed ID ${id}`);
  }
  assert.equal(database.rows.get('users')?.has(foreignUserId), true);
  assert.equal(database.rows.get('polls')?.has(foreignPollId), true);
});

class MemoryFixtureDatabase implements UserBlockingFixtureDatabase {
  readonly rows = new Map<string, Map<string, Record<string, unknown>>>();
  readonly queryLog: string[] = [];

  async connect() {
    return {
      query: async (sql: string, values: unknown[] = []) => {
        this.queryLog.push(sql);
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) return { rows: [], rowCount: 0 };

        if (/^\s*SELECT id\s+FROM users[\s\S]*FOR UPDATE/i.test(sql)) {
          const ids = new Set(values[0] as string[]);
          const rows = this.rows.get('users') ?? new Map<string, Record<string, unknown>>();
          return { rows: [...rows.values()].filter((row) => ids.has(String(row.id))), rowCount: ids.size };
        }

        if (/^\s*SELECT 1\s+FROM follows f/i.test(sql)) {
          const accountIds = new Set(values[0] as string[]);
          const ownedPairs = new Set(
            (JSON.parse(String(values[1])) as Array<{ follower_id: string; followee_id: string }>)
              .map(({ follower_id, followee_id }) => `${follower_id}:${followee_id}`)
          );
          const rows = this.rows.get('follows') ?? new Map<string, Record<string, unknown>>();
          const externalRows = [...rows.values()].filter((row) => {
            const touchesFixture = accountIds.has(String(row.follower_id)) || accountIds.has(String(row.followee_id));
            return touchesFixture && !ownedPairs.has(`${String(row.follower_id)}:${String(row.followee_id)}`);
          });
          return { rows: externalRows.slice(0, 1), rowCount: externalRows.length ? 1 : 0 };
        }

        const insert = sql.match(/^\s*INSERT INTO ([a-z_]+)/i);
        if (insert) {
          const table = insert[1]!;
          const records = JSON.parse(String(values[0])) as Array<Record<string, unknown>>;
          const rows = this.rows.get(table) ?? new Map<string, Record<string, unknown>>();
          for (const record of records) {
            const id = String(record.id ?? record.user_id ?? `${record.follower_id}:${record.followee_id}`);
            rows.set(id, record);
          }
          this.rows.set(table, rows);
          return { rows: [], rowCount: records.length };
        }

        if (/^\s*DELETE FROM follows f\s+USING jsonb_to_recordset/i.test(sql)) {
          const pairs = JSON.parse(String(values[0])) as Array<{ follower_id: string; followee_id: string }>;
          const ownedPairs = new Set(pairs.map(({ follower_id, followee_id }) => `${follower_id}:${followee_id}`));
          const rows = this.rows.get('follows') ?? new Map<string, Record<string, unknown>>();
          for (const [key, row] of rows) {
            if (ownedPairs.has(`${String(row.follower_id)}:${String(row.followee_id)}`)) rows.delete(key);
          }
          return { rows: [], rowCount: pairs.length };
        }

        const deletion = sql.match(/^\s*DELETE FROM ([a-z_]+) WHERE ([a-z_]+) = ANY/i);
        if (deletion) {
          const [, table, field] = deletion;
          const ids = new Set(values[0] as string[]);
          const secondField = sql.match(/\bOR ([a-z_]+) = ANY/i)?.[1];
          const rows = this.rows.get(table!) ?? new Map<string, Record<string, unknown>>();
          for (const [key, row] of rows) {
            if (ids.has(String(row[field!])) || (secondField && ids.has(String(row[secondField])))) rows.delete(key);
          }
          return { rows: [], rowCount: ids.size };
        }

        assert.fail(`unexpected fixture query: ${sql}`);
      },
      release() {}
    };
  }
}
