import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';

const [{ db, closeDatabaseConnection }, { closeRedisConnection }, { closeStorageConnection }, { getAccountDeletionContentTargets, purgeAccountContent }] = await Promise.all([
  import('../../config/database.js'),
  import('../../config/redis.js'),
  import('../../config/storage.js'),
  import('./account-deletion.content.js')
]);

const userIds = new Set<string>();
const operationIds = new Set<string>();

function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser() {
  const userId = randomUUID();
  const username = `ad07_${uniqueSuffix()}`;
  await db.query(
    'INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)',
    [userId, `${username}@yaskapp.test`, username, 'test-hash']
  );
  await db.query('INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)', [userId, username]);
  userIds.add(userId);
  return userId;
}

async function createOperation(userId: string) {
  const operationId = randomUUID();
  await db.query(
    `INSERT INTO account_deletion_operations (id, user_id, status, accepted_at, deadline_at)
     VALUES ($1, $2, 'pending', now(), now() + interval '24 hours')`,
    [operationId, userId]
  );
  await db.query("UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = $1", [userId]);
  operationIds.add(operationId);
  return operationId;
}

async function createPoll(authorId: string, input: { visibility?: 'public' | 'followers' | 'private'; deleted?: boolean; imageObjectKey?: string } = {}) {
  const pollId = randomUUID();
  await db.query(
    `INSERT INTO polls (id, author_id, question, visibility, deleted_at, image_object_key)
     VALUES ($1, $2, 'AD-07 fixture', $3, CASE WHEN $4 THEN now() ELSE NULL END, $5)`,
    [pollId, authorId, input.visibility ?? 'public', input.deleted ?? false, input.imageObjectKey ?? null]
  );
  return pollId;
}

async function createComment(pollId: string, authorId: string, parentCommentId: string | null, body: string) {
  const commentId = randomUUID();
  await db.query(
    `INSERT INTO comments (id, poll_id, author_id, parent_comment_id, body)
     VALUES ($1, $2, $3, $4, $5)`,
    [commentId, pollId, authorId, parentCommentId, body]
  );
  return commentId;
}

async function finishContentPurge(operationId: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await purgeAccountContent(operationId);
    if (result.done) return;
  }
  assert.fail('content cleanup did not finish within 10 batches');
}

test('surviving_reply_reparents_to_nearest_ancestor', async () => {
  const deletedUserId = await createUser();
  const otherUserId = await createUser();
  const operationId = await createOperation(deletedUserId);
  const foreignPollId = await createPoll(otherUserId);
  const ownPollId = await createPoll(deletedUserId, {
    visibility: 'private',
    deleted: true,
    imageObjectKey: `poll-images/${deletedUserId}/hidden.webp`
  });
  const ancestorId = await createComment(foreignPollId, otherUserId, null, 'A');
  const removedParentId = await createComment(foreignPollId, deletedUserId, ancestorId, 'B');
  const removedMiddleId = await createComment(foreignPollId, deletedUserId, removedParentId, 'C');
  const survivingReplyId = await createComment(foreignPollId, otherUserId, removedMiddleId, 'D');
  await db.query('UPDATE comments SET deleted_at = now() WHERE id = $1', [removedParentId]);
  await db.query('INSERT INTO likes (user_id, comment_id) VALUES ($1, $2)', [otherUserId, removedParentId]);
  const cascadedCommentId = await createComment(ownPollId, otherUserId, null, 'Deleted with the owned poll');

  await finishContentPurge(operationId);

  const reply = await db.query<{ parent_comment_id: string | null }>(
    'SELECT parent_comment_id FROM comments WHERE id = $1',
    [survivingReplyId]
  );
  const removed = await db.query<{ id: string }>(
    'SELECT id FROM comments WHERE id = ANY($1::uuid[])',
    [[removedParentId, removedMiddleId]]
  );
  const ownPoll = await db.query('SELECT id FROM polls WHERE id = $1', [ownPollId]);
  const ownPollMedia = await db.query<{ object_key: string }>(
    `SELECT object_key FROM account_deletion_media_manifest
     WHERE operation_id = $1 AND object_key = $2`,
    [operationId, `poll-images/${deletedUserId}/hidden.webp`]
  );
  const counts = await db.query<{ comments_count: number; replies_count: number }>(
    `SELECT p.comments_count,
            (SELECT c.replies_count FROM comments c WHERE c.id = $2) AS replies_count
     FROM polls p WHERE p.id = $1`,
    [foreignPollId, ancestorId]
  );
  const targets = await getAccountDeletionContentTargets(operationId);
  const cascadeTargets = await db.query<{ target_id: string }>(
    `SELECT target_id FROM account_deletion_deleted_content_targets
     WHERE operation_id = $1 AND target_type = 'comment' AND target_id = $2`,
    [operationId, cascadedCommentId]
  );
  const removedReaction = await db.query('SELECT id FROM likes WHERE comment_id = $1', [removedParentId]);

  assert.equal(reply.rows[0]?.parent_comment_id, ancestorId);
  assert.equal(removed.rowCount, 0);
  assert.equal(removedReaction.rowCount, 0);
  assert.equal(ownPoll.rowCount, 0);
  assert.equal(ownPollMedia.rowCount, 1);
  assert.equal(counts.rows[0]?.comments_count, 2);
  assert.equal(counts.rows[0]?.replies_count, 1);
  assert.ok(targets.some((target) => target.targetType === 'poll' && target.targetId === foreignPollId));
  assert.ok(targets.some((target) => target.targetType === 'comment' && target.targetId === ancestorId));
  assert.equal(cascadeTargets.rowCount, 1);
});

test('surviving_reply_reparents_to_null_when_no_surviving_ancestor_exists', async () => {
  const deletedUserId = await createUser();
  const otherUserId = await createUser();
  const operationId = await createOperation(deletedUserId);
  const pollId = await createPoll(otherUserId);
  const removedParentId = await createComment(pollId, deletedUserId, null, 'Removed parent');
  const removedMiddleId = await createComment(pollId, deletedUserId, removedParentId, 'Removed middle');
  const survivingReplyId = await createComment(pollId, otherUserId, removedMiddleId, 'Surviving root');

  await finishContentPurge(operationId);

  const reply = await db.query<{ parent_comment_id: string | null }>(
    'SELECT parent_comment_id FROM comments WHERE id = $1',
    [survivingReplyId]
  );
  assert.equal(reply.rows[0]?.parent_comment_id, null);
});

test('cyclic_deleted_comment_ancestors_do_not_leave_a_cycle', async () => {
  const deletedUserId = await createUser();
  const otherUserId = await createUser();
  const operationId = await createOperation(deletedUserId);
  const pollId = await createPoll(otherUserId);
  const firstId = await createComment(pollId, deletedUserId, null, 'First');
  const secondId = await createComment(pollId, deletedUserId, firstId, 'Second');
  const survivingReplyId = await createComment(pollId, otherUserId, firstId, 'Surviving');
  await db.query('UPDATE comments SET parent_comment_id = $2 WHERE id = $1', [firstId, secondId]);

  await finishContentPurge(operationId);

  const reply = await db.query<{ parent_comment_id: string | null }>(
    'SELECT parent_comment_id FROM comments WHERE id = $1',
    [survivingReplyId]
  );
  assert.equal(reply.rows[0]?.parent_comment_id, null);
  assert.equal((await db.query('SELECT id FROM comments WHERE id = ANY($1::uuid[])', [[firstId, secondId]])).rowCount, 0);
});

test('content_cleanup_resumes_after_a_committed_batch_and_is_idempotent', async () => {
  const deletedUserId = await createUser();
  const otherUserId = await createUser();
  const operationId = await createOperation(deletedUserId);
  const pollId = await createPoll(otherUserId);
  await db.query(
    `INSERT INTO comments (poll_id, author_id, body)
     SELECT $1, $2, 'Batch comment ' || i::text FROM generate_series(1, 103) AS i`,
    [pollId, deletedUserId]
  );

  const firstBatch = await purgeAccountContent(operationId);
  const remainingAfterFirstBatch = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM comments WHERE poll_id = $1 AND author_id = $2',
    [pollId, deletedUserId]
  );
  const secondBatch = await purgeAccountContent(operationId);
  const thirdBatch = await purgeAccountContent(operationId);
  const retry = await purgeAccountContent(operationId);

  assert.deepEqual(firstBatch, { done: false });
  assert.equal(remainingAfterFirstBatch.rows[0]?.count, 3);
  assert.deepEqual(secondBatch, { done: false });
  assert.deepEqual(thirdBatch, { done: true });
  assert.deepEqual(retry, { done: true });
  assert.equal((await db.query('SELECT id FROM comments WHERE poll_id = $1', [pollId])).rowCount, 0);
});

after(async () => {
  for (const operationId of operationIds) await db.query('DELETE FROM account_deletion_operations WHERE id = $1', [operationId]);
  for (const userId of userIds) await db.query('DELETE FROM users WHERE id = $1', [userId]);
  await closeDatabaseConnection();
  await closeRedisConnection();
  await closeStorageConnection();
});
