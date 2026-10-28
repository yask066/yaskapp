import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';

const CONTENT_BATCH_SIZE = 100;

type AffectedContentTarget = { targetType: 'poll' | 'comment'; targetId: string };

async function rememberTargets(client: PoolClient, operationId: string, userId: string) {
  await client.query(
    `INSERT INTO account_deletion_content_targets (operation_id, target_type, target_id)
     SELECT $1, 'poll', p.id
     FROM polls p
     WHERE p.author_id = $2
        OR EXISTS (SELECT 1 FROM comments c WHERE c.poll_id = p.id AND c.author_id = $2)
     ON CONFLICT DO NOTHING`,
    [operationId, userId]
  );
  await client.query(
    `INSERT INTO account_deletion_content_targets (operation_id, target_type, target_id)
     SELECT $1, 'comment', parent.id
     FROM comments removed
     JOIN polls p ON p.id = removed.poll_id AND p.author_id <> $2
     JOIN comments parent ON parent.id = removed.parent_comment_id
     WHERE removed.author_id = $2 AND parent.author_id <> $2
     ON CONFLICT DO NOTHING`,
    [operationId, userId]
  );
  await client.query(
    `INSERT INTO account_deletion_deleted_content_targets (operation_id, target_type, target_id)
     SELECT $1, 'poll', p.id FROM polls p WHERE p.author_id = $2
     ON CONFLICT DO NOTHING`,
    [operationId, userId]
  );
  await client.query(
    `INSERT INTO account_deletion_deleted_content_targets (operation_id, target_type, target_id)
     SELECT $1, 'comment', comment.id FROM comments comment
     LEFT JOIN polls poll ON poll.id = comment.poll_id
     WHERE comment.author_id = $2 OR poll.author_id = $2
     ON CONFLICT DO NOTHING`,
    [operationId, userId]
  );
  await client.query(
    `INSERT INTO account_deletion_counter_targets (operation_id, target_type, target_id)
     SELECT operation_id, target_type, target_id FROM account_deletion_content_targets
     WHERE operation_id = $1
     ON CONFLICT DO NOTHING`,
    [operationId]
  );
}

async function deleteOwnedPollBatch(client: PoolClient, operationId: string, userId: string) {
  const selected = await client.query<{ id: string; image_object_key: string | null }>(
    `SELECT id, image_object_key FROM polls
     WHERE author_id = $1
     ORDER BY id
     LIMIT $2
     FOR UPDATE`,
    [userId, CONTENT_BATCH_SIZE]
  );
  if (selected.rowCount === 0) return 0;

  const imageKeys = selected.rows.flatMap((row) => row.image_object_key ? [row.image_object_key] : []);
  if (imageKeys.length > 0) {
    await client.query(
      `INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key)
       SELECT $1, $2, keys.object_key FROM unnest($3::text[]) AS keys(object_key)
       ON CONFLICT (operation_id, object_key, version_id) DO NOTHING`,
      [operationId, userId, imageKeys]
    );
  }
  const deleted = await client.query(
    'DELETE FROM polls WHERE id = ANY($1::uuid[]) AND author_id = $2',
    [selected.rows.map((row) => row.id), userId]
  );
  return deleted.rowCount ?? 0;
}

async function findForeignPollWithOwnedComments(client: PoolClient, userId: string) {
  const result = await client.query<{ id: string }>(
    `SELECT p.id
     FROM polls p
     WHERE p.author_id <> $1
       AND EXISTS (SELECT 1 FROM comments c WHERE c.poll_id = p.id AND c.author_id = $1)
     ORDER BY p.id
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  return result.rows[0]?.id ?? null;
}

async function reparentForeignReplies(client: PoolClient, operationId: string, pollId: string, userId: string) {
  const children = await client.query<{ id: string }>(
    `SELECT child.id
     FROM comments child
     JOIN comments parent ON parent.id = child.parent_comment_id AND parent.poll_id = child.poll_id
     WHERE child.poll_id = $1 AND child.author_id <> $2 AND parent.author_id = $2
     ORDER BY child.id
     LIMIT $3
     FOR UPDATE OF child`,
    [pollId, userId, CONTENT_BATCH_SIZE]
  );
  if (children.rowCount === 0) return { count: 0, parentIds: [] as string[] };

  const result = await client.query<{ count: number; parent_ids: string[] }>(
    `WITH RECURSIVE parent_chain AS (
       SELECT child.id AS child_id, child.poll_id,
              parent.id AS ancestor_id, parent.parent_comment_id,
              parent.author_id, parent.deleted_at, 1 AS depth,
              ARRAY[child.id, parent.id]::uuid[] AS visited
       FROM comments child
       JOIN comments parent ON parent.id = child.parent_comment_id AND parent.poll_id = child.poll_id
       WHERE child.id = ANY($1::uuid[])
       UNION ALL
       SELECT chain.child_id, chain.poll_id,
              ancestor.id, ancestor.parent_comment_id,
              ancestor.author_id, ancestor.deleted_at, chain.depth + 1,
              chain.visited || ancestor.id
       FROM parent_chain chain
       JOIN comments current_parent ON current_parent.id = chain.ancestor_id
       JOIN comments ancestor ON ancestor.id = current_parent.parent_comment_id
         AND ancestor.poll_id = chain.poll_id
       WHERE (current_parent.author_id = $2 OR current_parent.deleted_at IS NOT NULL)
         AND NOT ancestor.id = ANY(chain.visited)
     ), nearest_survivor AS (
       SELECT DISTINCT ON (chain.child_id) chain.child_id, chain.ancestor_id AS parent_id
       FROM parent_chain chain
       WHERE chain.author_id <> $2 AND chain.deleted_at IS NULL
       ORDER BY chain.child_id, chain.depth
     ), mapping AS (
       SELECT child_id, parent_id FROM nearest_survivor
       UNION ALL
       SELECT ids.id, NULL::uuid AS parent_id FROM unnest($1::uuid[]) AS ids(id)
       WHERE NOT EXISTS (SELECT 1 FROM nearest_survivor WHERE nearest_survivor.child_id = ids.id)
     ), updated AS (
       UPDATE comments child
       SET parent_comment_id = mapping.parent_id, updated_at = now()
       FROM mapping
       WHERE child.id = mapping.child_id
         AND child.parent_comment_id IS DISTINCT FROM mapping.parent_id
       RETURNING child.id, child.poll_id, child.parent_comment_id
     ), remembered AS (
       INSERT INTO account_deletion_content_targets (operation_id, target_type, target_id)
       SELECT $3, 'comment', updated.parent_comment_id
       FROM updated
       WHERE updated.parent_comment_id IS NOT NULL
       ON CONFLICT DO NOTHING
       RETURNING target_id
     )
     SELECT count(*)::int AS count,
            COALESCE(array_agg(DISTINCT parent_comment_id) FILTER (WHERE parent_comment_id IS NOT NULL), '{}') AS parent_ids
     FROM updated`,
    [children.rows.map((row) => row.id), userId, operationId]
  );
  return {
    count: result.rows[0]?.count ?? 0,
    parentIds: result.rows[0]?.parent_ids ?? []
  };
}

async function removeOwnedCommentReactions(client: PoolClient, pollId: string, userId: string) {
  const result = await client.query(
    `WITH selected AS (
       SELECT l.id FROM likes l
       JOIN comments c ON c.id = l.comment_id
       WHERE c.poll_id = $1 AND c.author_id = $2
       ORDER BY l.id
       LIMIT $3
       FOR UPDATE OF l
     )
     DELETE FROM likes l USING selected WHERE l.id = selected.id`,
    [pollId, userId, CONTENT_BATCH_SIZE]
  );
  return result.rowCount ?? 0;
}

async function detachOwnedCommentParents(client: PoolClient, pollId: string, userId: string) {
  const result = await client.query(
    `WITH selected AS (
       SELECT id FROM comments
       WHERE poll_id = $1 AND author_id = $2 AND parent_comment_id IS NOT NULL
       ORDER BY id
       LIMIT $3
       FOR UPDATE
     )
     UPDATE comments c SET parent_comment_id = NULL, updated_at = now()
     FROM selected WHERE c.id = selected.id`,
    [pollId, userId, CONTENT_BATCH_SIZE]
  );
  return result.rowCount ?? 0;
}

async function deleteOwnedCommentBatch(client: PoolClient, pollId: string, userId: string) {
  const result = await client.query(
    `WITH selected AS (
       SELECT id FROM comments
       WHERE poll_id = $1 AND author_id = $2
       ORDER BY id
       LIMIT $3
       FOR UPDATE
     )
     DELETE FROM comments c USING selected WHERE c.id = selected.id`,
    [pollId, userId, CONTENT_BATCH_SIZE]
  );
  return result.rowCount ?? 0;
}

async function recountForeignPoll(client: PoolClient, operationId: string, pollId: string, changedParentIds: string[]) {
  const operationTargets = await client.query<{ id: string }>(
    `SELECT target_id AS id FROM account_deletion_content_targets
     WHERE operation_id = $1 AND target_type = 'comment'`,
    [operationId]
  );
  const parentIds = [...new Set([...changedParentIds, ...operationTargets.rows.map((row) => row.id)])];
  if (parentIds.length > 0) {
    await client.query(
      `UPDATE comments parent
       SET replies_count = (
         SELECT count(*)::int FROM comments reply
         JOIN users reply_author ON reply_author.id = reply.author_id
         WHERE reply.parent_comment_id = parent.id
           AND reply.deleted_at IS NULL
           AND reply_author.status = 'active' AND reply_author.deleted_at IS NULL
       )
       WHERE parent.poll_id = $1 AND parent.id = ANY($2::uuid[])`,
      [pollId, parentIds]
    );
  }
  await client.query(
    `UPDATE polls p
     SET comments_count = (
       SELECT count(*)::int FROM comments c
       JOIN users comment_author ON comment_author.id = c.author_id
       WHERE c.poll_id = p.id AND c.deleted_at IS NULL
         AND comment_author.status = 'active' AND comment_author.deleted_at IS NULL
     ), updated_at = now()
     WHERE p.id = $1`,
    [pollId]
  );
}

export async function getAccountDeletionContentTargets(
  operationId: string,
  targetType?: AffectedContentTarget['targetType']
): Promise<AffectedContentTarget[]> {
  const result = await db.query<AffectedContentTarget>(
    `SELECT target_type AS "targetType", target_id AS "targetId"
     FROM account_deletion_content_targets
     WHERE operation_id = $1 AND ($2::text IS NULL OR target_type = $2)
     ORDER BY target_type, target_id`,
    [operationId, targetType ?? null]
  );
  return result.rows;
}

export async function purgeAccountContent(operationId: string): Promise<{ done: boolean }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const operation = await client.query<{ user_id: string }>(
      `SELECT user_id FROM account_deletion_operations
       WHERE id = $1 AND status <> 'not_started'
       FOR UPDATE`,
      [operationId]
    );
    const userId = operation.rows[0]?.user_id;
    if (!userId) throw new Error('account_deletion_operation_not_found');

    // Serialize with account-guarded writes that started before acceptance.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    await rememberTargets(client, operationId, userId);

    const deletedPolls = await deleteOwnedPollBatch(client, operationId, userId);
    if (deletedPolls > 0) {
      await client.query('COMMIT');
      return { done: false };
    }

    const pollId = await findForeignPollWithOwnedComments(client, userId);
    if (!pollId) {
      await client.query('COMMIT');
      return { done: true };
    }

    const reparented = await reparentForeignReplies(client, operationId, pollId, userId);
    if (reparented.count > 0) {
      await recountForeignPoll(client, operationId, pollId, reparented.parentIds);
      await client.query('COMMIT');
      return { done: false };
    }

    const detachedParents = await detachOwnedCommentParents(client, pollId, userId);
    if (detachedParents > 0) {
      await client.query('COMMIT');
      return { done: false };
    }

    const removedReactions = await removeOwnedCommentReactions(client, pollId, userId);
    if (removedReactions > 0) {
      await client.query('COMMIT');
      return { done: false };
    }

    await deleteOwnedCommentBatch(client, pollId, userId);
    await recountForeignPoll(client, operationId, pollId, []);
    await client.query('COMMIT');
    return { done: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
