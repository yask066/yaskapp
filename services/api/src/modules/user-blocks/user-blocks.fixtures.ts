import { createHash } from 'node:crypto';

export type UserBlockingFixtureAccountKey =
  | 'A'
  | 'B'
  | 'C'
  | 'moderator'
  | 'unavailable'
  | 'globallyBlocked'
  | 'reusedUsername';

type FixtureClient = {
  query(sql: string, values?: unknown[]): Promise<unknown>;
  release(): void;
};

export type UserBlockingFixtureDatabase = {
  connect(): Promise<FixtureClient>;
};

type FixtureAccount = {
  key: UserBlockingFixtureAccountKey;
  source_id: string;
  id: string;
  email: string;
  username: string;
  password_hash: string;
  status: 'active' | 'blocked' | 'deleted';
  role: 'user' | 'moderator';
  created_at: string;
  deleted_at: string | null;
};

type FixturePoll = {
  source_id: string;
  id: string;
  author_key: 'A' | 'B' | 'C';
  author_id: string;
  question: string;
  visibility: 'public' | 'followers' | 'private';
  options_count: number;
  votes_count: number;
  comments_count: number;
  likes_count: number;
  created_at: string;
};

type FixtureComment = {
  source_id: string;
  id: string;
  poll_id: string;
  author_key: 'A' | 'B' | 'C';
  author_id: string;
  parent_comment_id: string | null;
  body: string;
  replies_count: number;
  created_at: string;
};

type FixtureNotification = {
  source_id: string;
  id: string;
  recipient_key: 'A' | 'B' | 'C';
  recipient_user_id: string;
  actor_key: 'A' | 'B' | 'C';
  actor_user_id: string;
  poll_id: string;
  poll_author_key: 'A' | 'B' | 'C';
  comment_id: string | null;
  type: 'poll_vote' | 'comment' | 'comment_reply' | 'like' | 'follow';
  payload: Record<string, string>;
  read_at: null;
  created_at: string;
};

type FixturePushJob = {
  source_id: string;
  id: string;
  notification_id: string;
  recipient_user_id: string;
  type: string;
  poll_id: string;
  comment_id: string | null;
  status: 'pending' | 'sending';
  attempts: number;
  available_at: string;
  max_attempts: number;
  claimed_at: string | null;
  last_error: null;
  created_at: string;
};

export type ExpandedUserBlockingFixtures = {
  seed: string;
  accounts: FixtureAccount[];
  profiles: Array<{
    user_id: string;
    display_name: string;
    polls_count: number;
    followers_count: number;
    following_count: number;
  }>;
  follows: Array<{ follower_id: string; followee_id: string; created_at: string }>;
  blockStates: Array<{
    name: 'none' | 'A-blocks-B' | 'B-blocks-A' | 'both';
    blockedByA: boolean;
    blockedByB: boolean;
  }>;
  moderationControl: {
    moderatorKey: 'moderator';
    targetOwnerKey: 'B';
    targetType: 'comment';
    targetId: string;
    blockerKey: 'B';
    blockedKey: 'moderator';
  };
  polls: FixturePoll[];
  pollOptions: Array<{ source_id: string; id: string; poll_id: string; text: string; position: number }>;
  comments: {
    root: FixtureComment & { poll_author_key: 'C' };
    replies: FixtureComment[];
  };
  notifications: FixtureNotification[];
  pushJobs: FixturePushJob[];
  requestContexts: Array<
    | { kind: 'guest'; viewerId: null }
    | { kind: 'bearer' | 'cookie'; viewerId: string }
  >;
  usernameReuse: {
    username: string;
    previousUsername: string;
    previousUserId: string;
    currentUserId: string;
  };
  ids: {
    accounts: string[];
    polls: string[];
    pollOptions: string[];
    comments: string[];
    notifications: string[];
    pushJobs: string[];
    all: string[];
  };
  idsByTable: Record<string, string[]>;
};

export type SeededUserBlockingFixtures = Pick<ExpandedUserBlockingFixtures, 'seed' | 'ids' | 'idsByTable'>;

const FIXTURE_TIMESTAMP = '2026-09-01T00:00:00.000Z';
const FIXTURE_TIMESTAMP_MS = Date.parse(FIXTURE_TIMESTAMP);

const blockStates: ExpandedUserBlockingFixtures['blockStates'] = [
  { name: 'none', blockedByA: false, blockedByB: false },
  { name: 'A-blocks-B', blockedByA: true, blockedByB: false },
  { name: 'B-blocks-A', blockedByA: false, blockedByB: true },
  { name: 'both', blockedByA: true, blockedByB: true }
];

export function expandUserBlockingFixtures(seed: string): ExpandedUserBlockingFixtures {
  assertSeed(seed);

  const id = (sourceId: string) => namespacedUuid(seed, sourceId);
  const seedSuffix = createHash('sha256').update(seed).digest('hex').slice(0, 8);
  const username = (key: string) => `ub_${seedSuffix}_${key.toLowerCase()}`;
  const accountSpecs: Array<{
    key: UserBlockingFixtureAccountKey;
    status: FixtureAccount['status'];
    role: FixtureAccount['role'];
  }> = [
    { key: 'A', status: 'active', role: 'user' },
    { key: 'B', status: 'active', role: 'user' },
    { key: 'C', status: 'active', role: 'user' },
    { key: 'moderator', status: 'active', role: 'moderator' },
    { key: 'unavailable', status: 'deleted', role: 'user' },
    { key: 'globallyBlocked', status: 'blocked', role: 'user' },
    { key: 'reusedUsername', status: 'active', role: 'user' }
  ];

  const accounts: FixtureAccount[] = accountSpecs.map(({ key, status, role }) => ({
    key,
    source_id: `account-${key}`,
    id: id(`account-${key}`),
    email: `user-blocking+${seed}-${key.toLowerCase()}@yaskapp.test`,
    username: key === 'reusedUsername' ? `reuse_${seedSuffix}` : username(key),
    password_hash: 'user-blocking-fixture-not-for-login',
    status,
    role,
    created_at: timestampFor(key === 'unavailable' ? -2 : 0),
    deleted_at: status === 'deleted' ? timestampFor(-1) : null
  }));
  const accountByKey = new Map(accounts.map((account) => [account.key, account]));
  const accountId = (key: UserBlockingFixtureAccountKey) => {
    const account = accountByKey.get(key);
    if (!account) throw new Error(`Unknown user-blocking fixture account: ${key}`);
    return account.id;
  };

  const follows = [
    { follower_id: accountId('A'), followee_id: accountId('B'), created_at: timestampFor(-60) },
    { follower_id: accountId('B'), followee_id: accountId('A'), created_at: timestampFor(-59) }
  ];

  const pollSpecs: Array<{ key: 'A' | 'B' | 'C'; visibility: FixturePoll['visibility'] }> = [
    { key: 'A', visibility: 'public' }, { key: 'A', visibility: 'followers' }, { key: 'A', visibility: 'private' },
    { key: 'B', visibility: 'public' }, { key: 'B', visibility: 'followers' }, { key: 'B', visibility: 'private' },
    { key: 'C', visibility: 'public' }
  ];
  const polls: FixturePoll[] = pollSpecs.map(({ key, visibility }, index) => {
    const source_id = `poll-${key}-${visibility}`;
    return {
      source_id,
      id: id(source_id),
      author_key: key,
      author_id: accountId(key),
      question: `User blocking fixture ${key} ${visibility} poll`,
      visibility,
      options_count: 2,
      votes_count: 0,
      comments_count: key === 'C' ? 26 : 0,
      likes_count: 0,
      created_at: timestampFor(index)
    };
  });
  const profiles = accounts
    .filter((account) => account.status !== 'deleted')
    .map((account) => ({
      user_id: account.id,
      display_name: `User blocking ${account.key}`,
      polls_count: polls.filter((poll) => poll.author_id === account.id).length,
      followers_count: follows.filter((follow) => follow.followee_id === account.id).length,
      following_count: follows.filter((follow) => follow.follower_id === account.id).length
    }));
  const targetPoll = polls.find((poll) => poll.author_key === 'C' && poll.visibility === 'public')!;
  const pollOptions = polls.flatMap((poll) => [0, 1].map((position) => {
    const source_id = `${poll.source_id}-option-${position + 1}`;
    return {
      source_id,
      id: id(source_id),
      poll_id: poll.id,
      text: `Option ${position + 1}`,
      position
    };
  }));

  const rootSourceId = 'comment-root-B-on-C';
  const root = {
    source_id: rootSourceId,
    id: id(rootSourceId),
    poll_id: targetPoll.id,
    author_key: 'B' as const,
    author_id: accountId('B'),
    poll_author_key: 'C' as const,
    parent_comment_id: null,
    body: 'Fixture root authored by B',
    replies_count: 25,
    created_at: timestampFor(100)
  };
  const replies: FixtureComment[] = Array.from({ length: 25 }, (_, index) => {
    const author_key = index % 2 === 0 ? 'A' as const : 'C' as const;
    const source_id = `comment-reply-${String(index + 1).padStart(2, '0')}`;
    return {
      source_id,
      id: id(source_id),
      poll_id: targetPoll.id,
      author_key,
      author_id: accountId(author_key),
      parent_comment_id: root.id,
      body: `Fixture reply ${index + 1}`,
      replies_count: 0,
      created_at: timestampFor(101 + index)
    };
  });

  const pollByKeyAndVisibility = (key: 'A' | 'B' | 'C', visibility: FixturePoll['visibility']) => {
    const poll = polls.find((candidate) => candidate.author_key === key && candidate.visibility === visibility);
    if (!poll) throw new Error(`Missing fixture poll ${key}/${visibility}.`);
    return poll;
  };
  const notificationSpecs: Array<{
    source_id: string;
    recipient_key: 'A' | 'B' | 'C';
    actor_key: 'A' | 'B' | 'C';
    poll_author_key: 'A' | 'B' | 'C';
    poll_id: string;
    comment_id: string | null;
    type: FixtureNotification['type'];
  }> = [
    {
      source_id: 'notification-old-unread-actor-B', recipient_key: 'A', actor_key: 'B', poll_author_key: 'C',
      poll_id: targetPoll.id, comment_id: root.id, type: 'comment'
    },
    {
      source_id: 'notification-old-unread-target-owner-B', recipient_key: 'C', actor_key: 'A', poll_author_key: 'B',
      poll_id: pollByKeyAndVisibility('B', 'public').id, comment_id: null, type: 'poll_vote'
    },
    {
      source_id: 'notification-control-actor-C', recipient_key: 'A', actor_key: 'C', poll_author_key: 'C',
      poll_id: targetPoll.id, comment_id: replies.find((reply) => reply.author_key === 'C')!.id, type: 'comment'
    }
  ];
  const notifications: FixtureNotification[] = notificationSpecs.map((spec, index) => ({
    ...spec,
    id: id(spec.source_id),
    recipient_user_id: accountId(spec.recipient_key),
    actor_user_id: accountId(spec.actor_key),
    payload: { fixture: 'user-blocking' },
    read_at: null,
    created_at: timestampFor(14 * 24 * 60 * 60 + index)
  }));
  const pushJobs: FixturePushJob[] = notifications.map((notification, index) => {
    const source_id = `push-${notification.source_id}`;
    const status = index === 1 ? 'sending' as const : 'pending' as const;
    const created_at = notification.created_at;
    return {
      source_id,
      id: id(source_id),
      notification_id: notification.id,
      recipient_user_id: notification.recipient_user_id,
      type: notification.type,
      poll_id: notification.poll_id,
      comment_id: notification.comment_id,
      status,
      attempts: status === 'sending' ? 1 : 0,
      available_at: created_at,
      max_attempts: 8,
      claimed_at: status === 'sending' ? timestampFor(14 * 24 * 60 * 60 + index + 1) : null,
      last_error: null,
      created_at
    };
  });

  const usernameReuse = {
    username: `reuse_${seedSuffix}`,
    previousUsername: `reuse_${seedSuffix}`,
    previousUserId: id('account-reusedUsername-previous'),
    currentUserId: accountId('reusedUsername')
  };
  const comments = { root, replies };
  const moderationControl = {
    moderatorKey: 'moderator' as const,
    targetOwnerKey: 'B' as const,
    targetType: 'comment' as const,
    targetId: root.id,
    blockerKey: 'B' as const,
    blockedKey: 'moderator' as const
  };
  const ids = {
    accounts: accounts.map((account) => account.id),
    polls: polls.map((poll) => poll.id),
    pollOptions: pollOptions.map((option) => option.id),
    comments: [root.id, ...replies.map((reply) => reply.id)],
    notifications: notifications.map((notification) => notification.id),
    pushJobs: pushJobs.map((job) => job.id),
    all: [
      ...accounts.map((account) => account.id),
      ...polls.map((poll) => poll.id),
      ...pollOptions.map((option) => option.id),
      root.id,
      ...replies.map((reply) => reply.id),
      ...notifications.map((notification) => notification.id),
      ...pushJobs.map((job) => job.id)
    ]
  };
  const idsByTable = {
    users: ids.accounts,
    profiles: accounts.filter((account) => account.status !== 'deleted').map((account) => account.id),
    polls: ids.polls,
    poll_options: ids.pollOptions,
    comments: ids.comments,
    follows: follows.map((follow) => `${follow.follower_id}:${follow.followee_id}`),
    notifications: ids.notifications,
    notification_push_jobs: ids.pushJobs
  };

  return {
    seed,
    accounts,
    profiles,
    follows,
    blockStates: blockStates.map((state) => ({ ...state })),
    moderationControl,
    polls,
    pollOptions,
    comments,
    notifications,
    pushJobs,
    requestContexts: [
      { kind: 'guest', viewerId: null },
      { kind: 'bearer', viewerId: accountId('A') },
      { kind: 'cookie', viewerId: accountId('B') }
    ],
    usernameReuse,
    ids,
    idsByTable
  };
}

export async function seedUserBlockingFixtures(
  database: UserBlockingFixtureDatabase,
  seed: string
): Promise<SeededUserBlockingFixtures> {
  const fixture = expandUserBlockingFixtures(seed);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await insertJson(client, 'users',
      `INSERT INTO users (id, email, username, password_hash, status, role, created_at, deleted_at)
       SELECT fixture_record.id, fixture_record.email, fixture_record.username, fixture_record.password_hash,
              fixture_record.status, fixture_record.role, fixture_record.created_at, fixture_record.deleted_at
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(
         id uuid, email text, username text, password_hash text, status user_status, role user_role,
         created_at timestamptz, deleted_at timestamptz
       )`,
      fixture.accounts);

    await insertJson(client, 'profiles',
      `INSERT INTO profiles (user_id, display_name, polls_count, followers_count, following_count)
       SELECT fixture_record.user_id, fixture_record.display_name, fixture_record.polls_count,
              fixture_record.followers_count, fixture_record.following_count
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(
         user_id uuid, display_name text, polls_count integer, followers_count integer, following_count integer
       )`,
      fixture.profiles);

    await insertJson(client, 'polls',
      `INSERT INTO polls (id, author_id, question, visibility, options_count, votes_count, comments_count, likes_count, created_at)
       SELECT fixture_record.id, fixture_record.author_id, fixture_record.question, fixture_record.visibility,
              fixture_record.options_count, fixture_record.votes_count, fixture_record.comments_count,
              fixture_record.likes_count, fixture_record.created_at
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(
         id uuid, author_id uuid, question text, visibility poll_visibility, options_count integer,
         votes_count integer, comments_count integer, likes_count integer, created_at timestamptz
       )`,
      fixture.polls);
    await insertJson(client, 'poll_options',
      `INSERT INTO poll_options (id, poll_id, text, position)
       SELECT fixture_record.id, fixture_record.poll_id, fixture_record.text, fixture_record.position
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(id uuid, poll_id uuid, text text, position smallint)`,
      fixture.pollOptions);
    await insertJson(client, 'comments',
      `INSERT INTO comments (id, poll_id, author_id, parent_comment_id, body, replies_count, created_at)
       SELECT fixture_record.id, fixture_record.poll_id, fixture_record.author_id, fixture_record.parent_comment_id,
              fixture_record.body, fixture_record.replies_count, fixture_record.created_at
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(
         id uuid, poll_id uuid, author_id uuid, parent_comment_id uuid, body text, replies_count integer,
         created_at timestamptz
       )`,
      [fixture.comments.root, ...fixture.comments.replies]);
    await insertJson(client, 'follows',
      `INSERT INTO follows (follower_id, followee_id, created_at)
       SELECT fixture_record.follower_id, fixture_record.followee_id, fixture_record.created_at
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(follower_id uuid, followee_id uuid, created_at timestamptz)`,
      fixture.follows);
    await insertJson(client, 'notifications',
      `INSERT INTO notifications (id, recipient_user_id, actor_user_id, type, poll_id, comment_id, payload, read_at, created_at)
       SELECT fixture_record.id, fixture_record.recipient_user_id, fixture_record.actor_user_id, fixture_record.type,
              fixture_record.poll_id, fixture_record.comment_id, fixture_record.payload, fixture_record.read_at,
              fixture_record.created_at
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(
         id uuid, recipient_user_id uuid, actor_user_id uuid, type notification_type, poll_id uuid, comment_id uuid,
         payload jsonb, read_at timestamptz, created_at timestamptz
       )`,
      fixture.notifications);
    await insertJson(client, 'notification_push_jobs',
      `INSERT INTO notification_push_jobs (
         id, notification_id, recipient_user_id, type, poll_id, comment_id, status, attempts,
         available_at, max_attempts, claimed_at, last_error, created_at
       )
       SELECT fixture_record.id, fixture_record.notification_id, fixture_record.recipient_user_id, fixture_record.type,
              fixture_record.poll_id, fixture_record.comment_id, fixture_record.status, fixture_record.attempts,
              fixture_record.available_at, fixture_record.max_attempts, fixture_record.claimed_at,
              fixture_record.last_error, fixture_record.created_at
       FROM jsonb_to_recordset($1::jsonb) AS fixture_record(
         id uuid, notification_id uuid, recipient_user_id uuid, type text, poll_id uuid, comment_id uuid,
         status text, attempts integer, available_at timestamptz, max_attempts integer, claimed_at timestamptz,
         last_error text, created_at timestamptz
       )`,
      fixture.pushJobs);

    await client.query('COMMIT');
    return { seed, ids: fixture.ids, idsByTable: fixture.idsByTable };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cleanupUserBlockingFixtures(
  database: UserBlockingFixtureDatabase,
  fixture: SeededUserBlockingFixtures
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const fixtureFollowPairs = fixture.idsByTable.follows.map((pair) => {
      const [follower_id, followee_id] = pair.split(':');
      if (!follower_id || !followee_id) throw new Error('Invalid fixture follow identifier.');
      return { follower_id, followee_id };
    });
    // FK inserts take KEY SHARE locks; hold stronger locks through the check and account deletion.
    await client.query(
      `SELECT id
       FROM users
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [fixture.ids.accounts]
    );
    const externalFollows = await client.query(
      `SELECT 1
       FROM follows f
       WHERE (f.follower_id = ANY($1::uuid[]) OR f.followee_id = ANY($1::uuid[]))
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_to_recordset($2::jsonb) AS fixture_record(follower_id uuid, followee_id uuid)
           WHERE fixture_record.follower_id = f.follower_id
             AND fixture_record.followee_id = f.followee_id
         )
       LIMIT 1`,
      [fixture.ids.accounts, JSON.stringify(fixtureFollowPairs)]
    ) as { rows?: unknown[] };
    if (externalFollows.rows?.length) {
      throw new Error('Refusing fixture cleanup: follow rows outside the fixture reference fixture accounts.');
    }
    await client.query('DELETE FROM notification_push_jobs WHERE id = ANY($1::uuid[])', [fixture.ids.pushJobs]);
    await client.query('DELETE FROM notifications WHERE id = ANY($1::uuid[])', [fixture.ids.notifications]);
    await client.query('DELETE FROM comments WHERE id = ANY($1::uuid[])', [fixture.ids.comments]);
    await client.query('DELETE FROM poll_options WHERE id = ANY($1::uuid[])', [fixture.ids.pollOptions]);
    await client.query(
      `DELETE FROM follows f
       USING jsonb_to_recordset($1::jsonb) AS fixture_record(follower_id uuid, followee_id uuid)
       WHERE fixture_record.follower_id = f.follower_id
         AND fixture_record.followee_id = f.followee_id`,
      [JSON.stringify(fixtureFollowPairs)]
    );
    await client.query('DELETE FROM profiles WHERE user_id = ANY($1::uuid[])', [fixture.ids.accounts]);
    await client.query('DELETE FROM polls WHERE id = ANY($1::uuid[])', [fixture.ids.polls]);
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [fixture.ids.accounts]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function insertJson(client: FixtureClient, table: string, sql: string, rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await client.query(sql, [JSON.stringify(rows)]);
  } catch (error) {
    throw new Error(`Could not seed user-blocking fixture table ${table}.`, { cause: error });
  }
}

function timestampFor(offsetSeconds: number): string {
  return new Date(FIXTURE_TIMESTAMP_MS + offsetSeconds * 1000).toISOString();
}

function namespacedUuid(seed: string, sourceId: string): string {
  const bytes = createHash('sha256').update(`user-blocking-fixtures:v1\0${seed}\0${sourceId}`).digest();
  const uuidBytes = Buffer.from(bytes.subarray(0, 16));
  uuidBytes[6] = (uuidBytes[6]! & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8]! & 0x3f) | 0x80;
  const hex = uuidBytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertSeed(seed: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(seed)) {
    throw new Error('User-blocking fixture seed must be 1–32 lowercase letters, digits, or hyphens.');
  }
}
