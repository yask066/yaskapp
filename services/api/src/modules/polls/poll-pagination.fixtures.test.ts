import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cleanupPollPaginationFixtures,
  expandPollPaginationFixtures,
  readPollPaginationFixtures,
  seedPollPaginationFixtures
} from './poll-pagination.fixtures.js';

test('poll_pagination_fixture_expands_expected_orders_and_boundary_windows', () => {
  const fixture = readPollPaginationFixtures();
  const expanded = expandPollPaginationFixtures(fixture, 'fixture-alpha');

  assert.equal(expanded.polls.length, 125);
  assert.equal(expanded.roots.length, 125);
  assert.equal(expanded.replies.length, 65);
  assert.equal(expanded.target.roots.length, 225);
  assert.equal(expanded.target.replies.length, 225);
  assert.equal(expanded.feedPolls.length, 126);
  assert.equal(
    new Set(expanded.roots.map(({ poll_id }) => poll_id)).size,
    1,
    'all chronological roots must belong to one poll for a comments API traversal'
  );
  assert.equal(expanded.roots[0]?.poll_id, expanded.polls[0]?.id);
  assert.deepEqual(orderByTuple(expanded.feedPolls, true), expanded.expectedIds.polls);
  assert.deepEqual(orderByTuple(expanded.roots, true), expanded.expectedIds.roots);
  assert.deepEqual(orderByTuple(expanded.replies, false), expanded.expectedIds.replies);
  assert.deepEqual(orderByTuple(expanded.target.roots, true), expanded.expectedIds.targetRoots);
  assert.deepEqual(orderByTuple(expanded.target.replies, false), expanded.expectedIds.targetReplies);
  assert.equal(new Set(expanded.target.replies.map((reply) => reply.parent_comment_id)).size, 1);
  assert.equal(expanded.target.roots[0]?.id, expanded.expectedIds.targetRoots.at(-1));
  assert.ok(expanded.expectedIds.targetRoots.indexOf(expanded.target.roots[0]!.id) >= 220);
  assert.equal(expanded.target.replies.at(-1)?.id, expanded.expectedIds.targetReplies.at(-1));
  assert.equal(expanded.roots[19]?.createdAt, '2026-01-01T00:00:19.000000Z');
  assert.equal(expanded.roots[20]?.createdAt, expanded.roots[19]?.createdAt);
  assert.equal(expanded.roots[21]?.createdAt, expanded.roots[19]?.createdAt);
  assert.equal(expanded.roots[22]?.createdAt, '2026-01-01T00:00:19.000001Z');
  assert.deepEqual(expanded.context.polls.map(({ visibility, deleted_at }) => [visibility, deleted_at !== null]), [
    ['followers', false], ['private', false], ['public', true]
  ]);
  assert.notEqual(expanded.context.roots[0]?.deleted_at, null);

  assert.deepEqual(expanded.expectedIds.polls, fixture.expectedOrders.polls.map((id) => expanded.idMap[id]));
  assert.deepEqual(expanded.expectedIds.roots, fixture.expectedOrders.roots.map((id) => expanded.idMap[id]));
  assert.deepEqual(expanded.expectedIds.replies, fixture.expectedOrders.replies.map((id) => expanded.idMap[id]));
  for (const size of [0, 1, 19, 20, 21, 40]) {
    assert.deepEqual(orderByTuple(expanded.feedPolls, true).slice(0, size), expanded.expectedIdWindows[String(size)]?.polls);
    assert.deepEqual(orderByTuple(expanded.roots, true).slice(0, size), expanded.expectedIdWindows[String(size)]?.roots);
    assert.deepEqual(orderByTuple(expanded.replies, false).slice(0, size), expanded.expectedIdWindows[String(size)]?.replies);
    assert.deepEqual(orderByTuple(expanded.target.roots, true).slice(0, size), expanded.expectedIdWindows[String(size)]?.targetRoots);
    assert.deepEqual(orderByTuple(expanded.target.replies, false).slice(0, size), expanded.expectedIdWindows[String(size)]?.targetReplies);
  }

  for (const record of [...expanded.polls, ...expanded.roots, ...expanded.replies]) {
    assert.match(record.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
  }
});

test('poll_pagination_fixture_seed_is_deterministic_and_cleanup_is_seed_scoped', async () => {
  const database = new MemoryFixtureDatabase();
  const alpha = await seedPollPaginationFixtures(database, 'fixture-alpha');
  const beta = await seedPollPaginationFixtures(database, 'fixture-beta');
  const expandedAlpha = expandPollPaginationFixtures(readPollPaginationFixtures(), 'fixture-alpha');

  assert.deepEqual(alpha.ids.polls, expandedAlpha.polls.map(({ id }) => id));
  assert.notDeepEqual(alpha.ids.polls, beta.ids.polls);
  const pollRows = database.rows.get('polls')!;
  assert.equal(pollRows.get(expandedAlpha.polls[0]!.id)?.comments_count, 190);
  assert.equal(pollRows.get(alpha.ids.targetPolls[0]!)?.comments_count, 450);
  const viewerA = expandedAlpha.accounts.find(({ key }) => key === 'viewerA')!.id;
  const viewerB = expandedAlpha.accounts.find(({ key }) => key === 'viewerB')!.id;
  const authorA = expandedAlpha.accounts.find(({ key }) => key === 'authorA')!.id;
  const authorB = expandedAlpha.accounts.find(({ key }) => key === 'authorB')!.id;
  const follows = database.rows.get('follows')!;
  assert.equal(follows.has(`${viewerA}:${authorA}`), true);
  assert.equal(follows.has(`${viewerB}:${authorB}`), true);

  const foreignPollId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  database.rows.get('polls')?.set(foreignPollId, { id: foreignPollId });

  await cleanupPollPaginationFixtures(database, alpha);

  assert.equal(database.rows.get('polls')?.has(foreignPollId), true);
  assert.equal(database.rows.get('polls')?.has(beta.ids.polls[0]!), true);
  assert.equal(database.rows.get('polls')?.has(alpha.ids.polls[0]!), false);
  assert.deepEqual(database.deletedIds.get('polls'), alpha.ids.allPolls);
  assert.deepEqual(database.deletedIds.get('users'), alpha.ids.accounts);
});

class MemoryFixtureDatabase {
  readonly rows = new Map<string, Map<string, Record<string, unknown>>>();
  readonly deletedIds = new Map<string, string[]>();

  async connect() {
    return {
      query: async (sql: string, values: unknown[] = []) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }

        const insert = sql.match(/^\s*INSERT INTO ([a-z_]+)/i);
        if (insert) {
          const table = insert[1]!;
          const records = JSON.parse(String(values[0])) as Array<Record<string, unknown>>;
          const tableRows = this.rows.get(table) ?? new Map<string, Record<string, unknown>>();
          for (const record of records) {
            tableRows.set(String(record.id ?? record.user_id ?? `${record.follower_id}:${record.followee_id}`), record);
          }
          this.rows.set(table, tableRows);
          return { rows: [], rowCount: records.length };
        }

        const deletion = sql.match(/^\s*DELETE FROM ([a-z_]+) WHERE id = ANY/i);
        if (deletion) {
          const table = deletion[1]!;
          const ids = values[0] as string[];
          const tableRows = this.rows.get(table) ?? new Map<string, Record<string, unknown>>();
          this.deletedIds.set(table, [...ids]);
          for (const id of ids) tableRows.delete(id);
          this.rows.set(table, tableRows);
          return { rows: [], rowCount: ids.length };
        }

        assert.fail(`unexpected fixture query: ${sql}`);
      },
      release() {}
    };
  }
}

function orderByTuple(records: Array<{ id: string; createdAt: string }>, descending: boolean): string[] {
  const ordered = [...records].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  if (descending) ordered.reverse();
  return ordered.map(({ id }) => id);
}
