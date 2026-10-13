import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';

const [{ db, closeDatabaseConnection }, { closeRedisConnection }, { closeStorageConnection }, { purgeAccountRelationships }] = await Promise.all([
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('../../config/storage.js'),
  import('./account-deletion.relationships.js')
]);

const userIds = new Set<string>();
const operationIds = new Set<string>();

async function createUser() {
  const userId = randomUUID();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  await db.query(
    'INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)',
    [userId, `ad08_${suffix}@yaskapp.test`, `ad08_${suffix}`, 'test-hash']
  );
  await db.query('INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)', [userId, suffix]);
  userIds.add(userId);
  return userId;
}

async function createPoll(authorId: string, closed = false) {
  const pollId = randomUUID();
  await db.query(
    `INSERT INTO polls (id, author_id, question, created_at, ends_at)
     VALUES ($1, $2, 'AD-08 closed poll',
             CASE WHEN $3 THEN now() - interval '2 hours' ELSE now() END,
             CASE WHEN $3 THEN now() - interval '1 hour' ELSE NULL END)`,
    [pollId, authorId, closed]
  );
  const optionIds = [randomUUID(), randomUUID()];
  await db.query(
    `INSERT INTO poll_options (id, poll_id, text, position)
     VALUES ($1, $3, 'A', 0), ($2, $3, 'B', 1)`,
    [optionIds[0], optionIds[1], pollId]
  );
  await db.query('UPDATE polls SET options_count = 2 WHERE id = $1', [pollId]);
  return { pollId, optionIds };
}

async function createOperation(userId: string) {
  const operationId = randomUUID();
  await db.query(
    `INSERT INTO account_deletion_operations (id, user_id, status, accepted_at, deadline_at)
     VALUES ($1, $2, 'pending', now(), now() + interval '24 hours')`,
    [operationId, userId]
  );
  await db.query(
    `INSERT INTO account_deletion_steps (operation_id, step_key, position)
     VALUES ($1, 'relationships', 4)`,
    [operationId]
  );
  await db.query("UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = $1", [userId]);
  operationIds.add(operationId);
  return operationId;
}

test('closed_poll_vote_removed', async () => {
  const deletedUserId = await createUser();
  const pollAuthorId = await createUser();
  const voterIds = [await createUser(), await createUser()];
  const operationId = await createOperation(deletedUserId);
  const { pollId, optionIds } = await createPoll(pollAuthorId, true);
  await db.query(
    `INSERT INTO poll_votes (poll_id, option_id, voter_id)
     VALUES ($1, $2, $3), ($1, $2, $4), ($1, $5, $6)`,
    [pollId, optionIds[0], deletedUserId, voterIds[0], optionIds[1], voterIds[1]]
  );
  await db.query(
    `UPDATE poll_options SET votes_count = CASE WHEN id = $2 THEN 2 ELSE 1 END WHERE poll_id = $1`,
    [pollId, optionIds[0]]
  );
  const commentId = randomUUID();
  const replyId = randomUUID();
  await db.query('INSERT INTO comments (id, poll_id, author_id, body) VALUES ($1, $2, $3, \'Parent\')', [commentId, pollId, pollAuthorId]);
  await db.query(
    'INSERT INTO comments (id, poll_id, author_id, parent_comment_id, body) VALUES ($1, $2, $3, $4, \'Reply\')',
    [replyId, pollId, voterIds[0], commentId]
  );
  await db.query('INSERT INTO likes (user_id, poll_id) VALUES ($1, $2)', [deletedUserId, pollId]);
  await db.query('INSERT INTO likes (user_id, comment_id) VALUES ($1, $2)', [deletedUserId, commentId]);
  await db.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2), ($3, $1)', [deletedUserId, voterIds[0], voterIds[1]]);
  await db.query('UPDATE profiles SET following_count = 1 WHERE user_id = $1', [deletedUserId]);
  await db.query('UPDATE profiles SET followers_count = 1 WHERE user_id = $1', [deletedUserId]);
  await db.query('UPDATE profiles SET followers_count = 1 WHERE user_id = $1', [voterIds[0]]);
  await db.query('UPDATE profiles SET following_count = 1 WHERE user_id = $1', [voterIds[1]]);
  await db.query('UPDATE polls SET votes_count = 3, likes_count = 1, comments_count = 2 WHERE id = $1', [pollId]);
  await db.query('UPDATE comments SET likes_count = 1, replies_count = 0 WHERE id = $1', [commentId]);

  const first = await purgeAccountRelationships(operationId);
  const second = await purgeAccountRelationships(operationId);
  const retry = await purgeAccountRelationships(operationId);
  const state = await db.query<{
    votes_count: number;
    option_a: number;
    option_b: number;
    votes_revision: string;
    votes_left: number;
    likes_count: number;
    likes_revision: string;
    comments_count: number;
    comments_revision: string;
    comment_likes: number;
    replies_count: number;
  }>(
    `SELECT p.votes_count, a.votes_count AS option_a, b.votes_count AS option_b,
            p.likes_count, p.likes_revision::text AS likes_revision,
            p.comments_count, p.comments_revision::text AS comments_revision,
            p.votes_revision::text AS votes_revision,
            (SELECT count(*)::int FROM poll_votes v WHERE v.poll_id = p.id) AS votes_left,
            (SELECT likes_count FROM comments WHERE id = $4) AS comment_likes,
            (SELECT replies_count FROM comments WHERE id = $4) AS replies_count
     FROM polls p
     JOIN poll_options a ON a.poll_id = p.id AND a.id = $2
     JOIN poll_options b ON b.poll_id = p.id AND b.id = $3
     WHERE p.id = $1`,
    [pollId, optionIds[0], optionIds[1], commentId]
  );
  const followCounts = await db.query<{ followers_count: number; following_count: number }>(
    'SELECT followers_count, following_count FROM profiles WHERE user_id = ANY($1::uuid[]) ORDER BY user_id',
    [[voterIds[0], voterIds[1]]]
  );
  const relationshipRows = await db.query('SELECT id FROM follows WHERE follower_id = $1 OR followee_id = $1', [deletedUserId]);
  const outbox = await db.query<{ event_payload: { type: string; payload: { poll: { votesCount: number } } } }>(
    'SELECT event_payload FROM account_deletion_relationship_events WHERE operation_id = $1 AND poll_id = $2',
    [operationId, pollId]
  );

  assert.deepEqual(first, { done: false });
  assert.deepEqual(second, { done: true });
  assert.deepEqual(retry, { done: true });
  assert.equal(state.rows[0]?.votes_count, 2);
  assert.equal(state.rows[0]?.option_a, 1);
  assert.equal(state.rows[0]?.option_b, 1);
  assert.equal(state.rows[0]?.votes_left, 2);
  assert.equal(state.rows[0]?.votes_revision, '1');
  assert.equal(state.rows[0]?.likes_count, 0);
  assert.equal(state.rows[0]?.likes_revision, '1');
  assert.equal(state.rows[0]?.comments_count, 2);
  assert.equal(state.rows[0]?.comments_revision, '1');
  assert.equal(state.rows[0]?.comment_likes, 0);
  assert.equal(state.rows[0]?.replies_count, 1);
  assert.deepEqual(followCounts.rows, [
    { followers_count: 0, following_count: 0 },
    { followers_count: 0, following_count: 0 }
  ]);
  assert.equal(relationshipRows.rowCount, 0);
  assert.equal(outbox.rows[0]?.event_payload.type, 'poll.vote.updated');
  assert.equal(outbox.rows[0]?.event_payload.payload.poll.votesCount, 2);
});

after(async () => {
  for (const operationId of operationIds) await db.query('DELETE FROM account_deletion_operations WHERE id = $1', [operationId]);
  for (const userId of userIds) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await closeDatabaseConnection();
  await closeRedisConnection();
  await closeStorageConnection();
});
