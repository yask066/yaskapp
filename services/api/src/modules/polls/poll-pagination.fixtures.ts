import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type TimestampSeries = {
  idPrefix: string;
  count: number;
  baseCreatedAt: string;
  stepMicroseconds: number;
  tieIndexes: number[];
  microsecondNeighborIndex: number;
};

type FixtureDefinition = {
  version: number;
  accounts: Array<{ key: string; id: string }>;
  chronological: {
    polls: TimestampSeries;
    roots: TimestampSeries;
    replies: TimestampSeries;
  };
  target: {
    pollId: string;
    pollCreatedAt: string;
    roots: TimestampSeries;
    replies: TimestampSeries;
  };
  contextCases: {
    followingPoll: { id: string; author: string; visibility: 'followers'; createdAt: string };
    privatePoll: { id: string; author: string; visibility: 'private'; createdAt: string };
    deletedPoll: { id: string; author: string; visibility: 'public'; createdAt: string; deletedAt: string };
    deletedRoot: { id: string; pollIndex: number; author: string; createdAt: string; deletedAt: string };
  };
  expectedOrders: Record<string, string[]>;
  windows: Record<string, Record<string, string[]>>;
};

type FixtureClient = {
  query(sql: string, values?: unknown[]): Promise<unknown>;
  release(): void;
};

export type PollPaginationFixtureDatabase = {
  connect(): Promise<FixtureClient>;
};

export type ExpandedPollPaginationFixtures = {
  seed: string;
  accounts: Array<{ key: string; sourceId: string; id: string }>;
  polls: Array<Record<string, unknown> & { sourceId: string; id: string; createdAt: string }>;
  roots: Array<Record<string, unknown> & { sourceId: string; id: string; createdAt: string }>;
  replies: Array<Record<string, unknown> & { sourceId: string; id: string; createdAt: string }>;
  feedPolls: Array<Record<string, unknown> & { sourceId: string; id: string; createdAt: string }>;
  target: {
    poll: Record<string, unknown> & { sourceId: string; id: string; createdAt: string };
    roots: Array<Record<string, unknown> & { sourceId: string; id: string; createdAt: string }>;
    replies: Array<Record<string, unknown> & { sourceId: string; id: string; createdAt: string }>;
  };
  context: {
    polls: Array<Record<string, unknown> & { sourceId: string; id: string; createdAt: string }>;
    roots: Array<Record<string, unknown> & { sourceId: string; id: string; createdAt: string }>;
  };
  expectedOrders: FixtureDefinition['expectedOrders'];
  expectedIds: Record<string, string[]>;
  windows: FixtureDefinition['windows'];
  expectedIdWindows: Record<string, Record<string, string[]>>;
  idMap: Record<string, string>;
  ids: {
    accounts: string[];
    polls: string[];
    roots: string[];
    replies: string[];
    targetPolls: string[];
    targetRoots: string[];
    targetReplies: string[];
    contextPolls: string[];
    contextRoots: string[];
    allPolls: string[];
  };
};

export type SeededPollPaginationFixtures = Pick<ExpandedPollPaginationFixtures,
  'seed' | 'ids' | 'expectedIds' | 'expectedIdWindows'>;

export function readPollPaginationFixtures(): FixtureDefinition {
  const path = new URL('../../../../../test/fixtures/feed-comments-pagination.json', import.meta.url);
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as FixtureDefinition;
  if (fixture.version !== 1) throw new Error('Unsupported feed/comments pagination fixture version.');
  return fixture;
}

export function expandPollPaginationFixtures(
  fixture: FixtureDefinition,
  seed: string
): ExpandedPollPaginationFixtures {
  assertSeed(seed);
  const id = (sourceId: string) => namespacedUuid(seed, sourceId);
  const accountByKey = new Map(fixture.accounts.map((account) => [account.key, {
    key: account.key,
    sourceId: account.id,
    id: id(account.id)
  }]));
  const authorId = (key: string) => {
    const account = accountByKey.get(key);
    if (!account) throw new Error(`Unknown pagination fixture account: ${key}`);
    return account.id;
  };

  const polls = expandCollection(fixture.chronological.polls, seed, (sourceId, index, createdAt) => ({
    sourceId,
    id: id(sourceId),
    author_id: authorId(index % 2 === 0 ? 'authorA' : 'authorB'),
    question: `Pagination fixture poll ${index + 1}`,
    visibility: 'public',
    created_at: createdAt,
    createdAt
  }));
  const roots = expandCollection(fixture.chronological.roots, seed, (sourceId, index, createdAt) => ({
    sourceId,
    id: id(sourceId),
    poll_id: polls[0]!.id,
    author_id: authorId(index % 2 === 0 ? 'authorA' : 'authorB'),
    parent_comment_id: null,
    body: `Pagination fixture root ${index + 1}`,
    created_at: createdAt,
    createdAt,
    deleted_at: null
  }));
  const replies = expandCollection(fixture.chronological.replies, seed, (sourceId, index, createdAt) => ({
    sourceId,
    id: id(sourceId),
    poll_id: polls[0]!.id,
    author_id: authorId(index % 2 === 0 ? 'authorA' : 'authorB'),
    parent_comment_id: roots[0]!.id,
    body: `Pagination fixture reply ${index + 1}`,
    created_at: createdAt,
    createdAt,
    deleted_at: null
  }));

  const targetPollSourceId = fixture.target.pollId;
  const targetPoll = {
    sourceId: targetPollSourceId,
    id: id(targetPollSourceId),
    author_id: authorId('authorA'),
    question: 'Pagination target poll',
    visibility: 'public',
    created_at: fixture.target.pollCreatedAt,
    createdAt: fixture.target.pollCreatedAt,
    deleted_at: null
  };
  const feedPolls = [...polls, targetPoll];
  const targetRoots = expandCollection(fixture.target.roots, seed, (sourceId, index, createdAt) => ({
    sourceId,
    id: id(sourceId),
    poll_id: targetPoll.id,
    author_id: authorId(index % 2 === 0 ? 'authorA' : 'authorB'),
    parent_comment_id: null,
    body: `Pagination target root ${index + 1}`,
    created_at: createdAt,
    createdAt,
    deleted_at: null
  }));
  const targetReplies = expandCollection(fixture.target.replies, seed, (sourceId, index, createdAt) => ({
    sourceId,
    id: id(sourceId),
    poll_id: targetPoll.id,
    author_id: authorId(index % 2 === 0 ? 'authorA' : 'authorB'),
    parent_comment_id: targetRoots[0]!.id,
    body: `Pagination target reply ${index + 1}`,
    created_at: createdAt,
    createdAt,
    deleted_at: null
  }));

  const followingPoll = fixture.contextCases.followingPoll;
  const privatePoll = fixture.contextCases.privatePoll;
  const deletedPoll = fixture.contextCases.deletedPoll;
  const contextPolls = [followingPoll, privatePoll, deletedPoll].map((poll) => ({
    sourceId: poll.id,
    id: id(poll.id),
    author_id: authorId(poll.author),
    question: `Pagination fixture ${poll.visibility} visibility case`,
    visibility: poll.visibility,
    created_at: poll.createdAt,
    createdAt: poll.createdAt,
    deleted_at: 'deletedAt' in poll ? poll.deletedAt : null
  }));
  const deletedRoot = fixture.contextCases.deletedRoot;
  const contextRoots = [{
    sourceId: deletedRoot.id,
    id: id(deletedRoot.id),
    poll_id: polls[deletedRoot.pollIndex - 1]!.id,
    author_id: authorId(deletedRoot.author),
    parent_comment_id: null,
    body: 'Pagination fixture deleted root',
    created_at: deletedRoot.createdAt,
    createdAt: deletedRoot.createdAt,
    deleted_at: deletedRoot.deletedAt
  }];

  const allPolls = [...polls.map((record) => record.id), targetPoll.id, ...contextPolls.map((record) => record.id)];
  const idMap: Record<string, string> = {};
  for (const account of [...accountByKey.values()]) idMap[account.sourceId] = account.id;
  for (const record of [...polls, ...roots, ...replies, targetPoll, ...targetRoots, ...targetReplies, ...contextPolls, ...contextRoots]) {
    idMap[record.sourceId] = record.id;
  }
  const expectedIds = Object.fromEntries(Object.entries(fixture.expectedOrders).map(([key, sourceIds]) => [
    key,
    sourceIds.map((sourceId) => {
      const actualId = idMap[sourceId];
      if (!actualId) throw new Error(`Unknown expected pagination fixture ID: ${sourceId}`);
      return actualId;
    })
  ]));
  const expectedIdWindows = Object.fromEntries(Object.entries(fixture.windows).map(([size, lists]) => [
    size,
    Object.fromEntries(Object.entries(lists).map(([key, sourceIds]) => [
      key,
      sourceIds.map((sourceId) => idMap[sourceId]!)
    ]))
  ]));
  return {
    seed,
    accounts: [...accountByKey.values()],
    polls,
    roots,
    replies,
    feedPolls,
    target: { poll: targetPoll, roots: targetRoots, replies: targetReplies },
    context: { polls: contextPolls, roots: contextRoots },
    expectedOrders: fixture.expectedOrders,
    expectedIds,
    windows: fixture.windows,
    expectedIdWindows,
    idMap,
    ids: {
      accounts: [...accountByKey.values()].map(({ id: accountId }) => accountId),
      polls: polls.map(({ id: pollId }) => pollId),
      roots: roots.map(({ id: rootId }) => rootId),
      replies: replies.map(({ id: replyId }) => replyId),
      targetPolls: [targetPoll.id],
      targetRoots: targetRoots.map(({ id: rootId }) => rootId),
      targetReplies: targetReplies.map(({ id: replyId }) => replyId),
      contextPolls: contextPolls.map(({ id: pollId }) => pollId),
      contextRoots: contextRoots.map(({ id: rootId }) => rootId),
      allPolls
    }
  };
}

export async function seedPollPaginationFixtures(
  database: PollPaginationFixtureDatabase,
  seed: string
): Promise<SeededPollPaginationFixtures> {
  const fixture = expandPollPaginationFixtures(readPollPaginationFixtures(), seed);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const seedSuffix = createHash('sha256').update(seed).digest('hex').slice(0, 10);
    await insertJson(client, 'users',
      `INSERT INTO users (id, email, username, password_hash, status, created_at)
       SELECT fixture_record.id, fixture_record.email, fixture_record.username, fixture_record.password_hash, fixture_record.status, fixture_record.created_at
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(id uuid, email text, username text, password_hash text, status user_status, created_at timestamptz)`,
      fixture.accounts.map((account) => ({
        id: account.id,
        email: `feed-pagination+${seed}-${account.key}@yaskapp.test`,
        username: `pg_${seedSuffix}_${account.key.toLowerCase()}`,
        password_hash: 'pagination-fixture-not-for-login',
        status: 'active',
        created_at: '2026-01-01T00:00:00.000000Z'
      })));
    await insertJson(client, 'profiles',
      `INSERT INTO profiles (user_id, display_name)
       SELECT fixture_record.user_id, fixture_record.display_name
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(user_id uuid, display_name text)`,
      fixture.accounts.map((account) => ({ user_id: account.id, display_name: `Pagination ${account.key}` })));

    const commentRecords = [
      ...fixture.roots,
      ...fixture.replies,
      ...fixture.target.roots,
      ...fixture.target.replies,
      ...fixture.context.roots
    ].map((comment) => ({
      id: comment.id,
      poll_id: comment.poll_id,
      author_id: comment.author_id,
      parent_comment_id: comment.parent_comment_id,
      body: comment.body,
      created_at: comment.created_at,
      deleted_at: comment.deleted_at,
      replies_count: comment.parent_comment_id === fixture.roots[0]!.id
        ? fixture.replies.length
        : comment.parent_comment_id === fixture.target.roots[0]!.id ? fixture.target.replies.length : 0
    }));
    const commentsCountByPoll = new Map<string, number>();
    for (const comment of commentRecords) {
      if (typeof comment.poll_id !== 'string') throw new Error('Pagination fixture comment has no poll ID.');
      if (comment.deleted_at === null) {
        commentsCountByPoll.set(comment.poll_id, (commentsCountByPoll.get(comment.poll_id) ?? 0) + 1);
      }
    }
    const pollRecords = [...fixture.polls, fixture.target.poll, ...fixture.context.polls].map((poll) => ({
      id: poll.id,
      author_id: 'author_id' in poll ? poll.author_id : fixture.accounts[2]!.id,
      question: 'question' in poll ? poll.question : 'Pagination target poll',
      visibility: 'visibility' in poll ? poll.visibility : 'public',
      options_count: 2,
      comments_count: commentsCountByPoll.get(poll.id) ?? 0,
      created_at: 'created_at' in poll ? poll.created_at : '2026-01-01T00:00:00.000000Z',
      deleted_at: 'deleted_at' in poll ? poll.deleted_at : null
    }));
    await insertJson(client, 'polls',
      `INSERT INTO polls (id, author_id, question, visibility, options_count, comments_count, created_at, deleted_at)
       SELECT fixture_record.id, fixture_record.author_id, fixture_record.question, fixture_record.visibility, fixture_record.options_count, fixture_record.comments_count, fixture_record.created_at, fixture_record.deleted_at
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(id uuid, author_id uuid, question text, visibility poll_visibility, options_count integer, comments_count integer, created_at timestamptz, deleted_at timestamptz)`,
      pollRecords);

    const options = pollRecords.flatMap((poll) => [0, 1].map((position) => ({
      id: namespacedUuid(seed, `${poll.id}:option:${position}`),
      poll_id: poll.id,
      text: `Option ${position + 1}`,
      position
    })));
    await insertJson(client, 'poll_options',
      `INSERT INTO poll_options (id, poll_id, text, position)
       SELECT fixture_record.id, fixture_record.poll_id, fixture_record.text, fixture_record.position
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(id uuid, poll_id uuid, text text, position smallint)`,
      options);

    await insertJson(client, 'comments',
      `INSERT INTO comments (id, poll_id, author_id, parent_comment_id, body, created_at, deleted_at, replies_count)
       SELECT fixture_record.id, fixture_record.poll_id, fixture_record.author_id, fixture_record.parent_comment_id, fixture_record.body, fixture_record.created_at, fixture_record.deleted_at, fixture_record.replies_count
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(id uuid, poll_id uuid, author_id uuid, parent_comment_id uuid, body text, created_at timestamptz, deleted_at timestamptz, replies_count integer)`,
      commentRecords);

    const follows = [
      { follower_id: fixture.accounts[0]!.id, followee_id: fixture.accounts[2]!.id },
      { follower_id: fixture.accounts[1]!.id, followee_id: fixture.accounts[3]!.id }
    ];
    await insertJson(client, 'follows',
      `INSERT INTO follows (follower_id, followee_id)
       SELECT fixture_record.follower_id, fixture_record.followee_id
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(follower_id uuid, followee_id uuid)`,
      follows);
    await client.query('COMMIT');
    return { seed, ids: fixture.ids, expectedIds: fixture.expectedIds, expectedIdWindows: fixture.expectedIdWindows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cleanupPollPaginationFixtures(
  database: PollPaginationFixtureDatabase,
  fixture: SeededPollPaginationFixtures
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM polls WHERE id = ANY($1::uuid[])', [fixture.ids.allPolls]);
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixture.ids.accounts]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function expandCollection<T extends { sourceId: string; id: string; createdAt: string }>(
  collection: TimestampSeries,
  seed: string,
  map: (sourceId: string, index: number, createdAt: string) => T
): T[] {
  return Array.from({ length: collection.count }, (_, index) => {
    const itemIndex = index + 1;
    const sourceId = `${collection.idPrefix}${String(itemIndex).padStart(12, '0')}`;
    return map(sourceId, index, timestampAt(collection, itemIndex));
  });
}

function timestampAt(collection: TimestampSeries, index: number): string {
  const tieIndexes = new Set(collection.tieIndexes);
  const base = parseUtcMicros(collection.baseCreatedAt);
  const tiedTime = base + BigInt(collection.stepMicroseconds) * BigInt(collection.tieIndexes[0]! - 1);
  const value = tieIndexes.has(index)
    ? tiedTime
    : index === collection.microsecondNeighborIndex
      ? tiedTime + 1n
      : base + BigInt(collection.stepMicroseconds) * BigInt(index - 1);
  const seconds = value / 1_000_000n;
  const fractional = String(value % 1_000_000n).padStart(6, '0');
  return `${new Date(Number(seconds * 1000n)).toISOString().slice(0, 19)}.${fractional}Z`;
}

function parseUtcMicros(value: string): bigint {
  const [wholeSeconds, fraction = '000000'] = value.slice(0, -1).split('.');
  return BigInt(Date.parse(`${wholeSeconds}Z`)) * 1000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

function namespacedUuid(seed: string, sourceId: string): string {
  const sourceUuid = sourceId.match(/^([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-([0-9a-f]{12})$/i);
  const namespace = sourceUuid?.[1] ?? sourceId;
  const bytes = createHash('sha256').update(`feed-comments-pagination:v1\0${seed}\0${namespace}`).digest();
  const uuidBytes = Buffer.from(bytes.subarray(0, 16));
  if (sourceUuid) Buffer.from(sourceUuid[2]!, 'hex').copy(uuidBytes, 10);
  uuidBytes[6] = (uuidBytes[6]! & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8]! & 0x3f) | 0x80;
  const hex = uuidBytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertSeed(seed: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(seed)) {
    throw new Error('Pagination fixture seed must be 1–32 lowercase letters, digits, or hyphens.');
  }
}

async function insertJson(client: FixtureClient, table: string, sql: string, rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await client.query(sql, [JSON.stringify(rows)]);
  } catch (error) {
    throw new Error(`Could not seed pagination fixture table ${table}.`, { cause: error });
  }
}
