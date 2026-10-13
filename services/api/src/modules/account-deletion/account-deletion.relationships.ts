import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { RealtimeEvent } from '@yaskapp/shared';
import { db } from '../../config/database.js';
import { hydratePolls } from '../polls/polls.repository.js';
import { realtimeBus } from '../../realtime/realtime.bus.js';

type PollTargetRow = { id: string };
type EventRow = { id: string; event_payload: RealtimeEvent };

async function rememberCounterTargets(client: PoolClient, operationId: string, userId: string) {
  await client.query(
    `INSERT INTO account_deletion_counter_targets (operation_id, target_type, target_id)
     SELECT $1, 'poll', affected.poll_id FROM (
       SELECT poll_id FROM poll_votes WHERE voter_id = $2
       UNION SELECT poll_id FROM likes WHERE user_id = $2 AND poll_id IS NOT NULL
       UNION SELECT comment.poll_id FROM likes reaction
         JOIN comments comment ON comment.id = reaction.comment_id
         WHERE reaction.user_id = $2 AND reaction.comment_id IS NOT NULL
     ) affected WHERE affected.poll_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [operationId, userId]
  );
  await client.query(
    `INSERT INTO account_deletion_counter_targets (operation_id, target_type, target_id)
     SELECT $1, 'comment', comment_id FROM likes
     WHERE user_id = $2 AND comment_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [operationId, userId]
  );
  await client.query(
    `INSERT INTO account_deletion_counter_targets (operation_id, target_type, target_id)
     SELECT $1, 'profile', user_id FROM (
       SELECT followee_id AS user_id FROM follows WHERE follower_id = $2
       UNION SELECT follower_id AS user_id FROM follows WHERE followee_id = $2
     ) affected WHERE affected.user_id <> $2
     ON CONFLICT DO NOTHING`,
    [operationId, userId]
  );
}

async function getNextAffectedPoll(client: PoolClient, operationId: string, userId: string, cursorId: string | null) {
  const result = await client.query<PollTargetRow>(
    `WITH targets AS (
       SELECT target_id AS poll_id
       FROM account_deletion_content_targets
       WHERE operation_id = $1 AND target_type = 'poll'
       UNION
       SELECT c.poll_id
       FROM account_deletion_content_targets target
       JOIN comments c ON c.id = target.target_id
       WHERE target.operation_id = $1 AND target.target_type = 'comment'
       UNION
       SELECT poll_id FROM poll_votes WHERE voter_id = $2
       UNION
       SELECT l.poll_id FROM likes l WHERE l.user_id = $2 AND l.poll_id IS NOT NULL
       UNION
       SELECT c.poll_id FROM likes l JOIN comments c ON c.id = l.comment_id
       WHERE l.user_id = $2 AND l.comment_id IS NOT NULL
     )
     SELECT poll_id AS id FROM targets
     WHERE $3::uuid IS NULL OR poll_id > $3::uuid
     ORDER BY poll_id LIMIT 1`,
    [operationId, userId, cursorId]
  );
  return result.rows[0]?.id ?? null;
}

async function recountPollRelationships(client: PoolClient, operationId: string, pollId: string, userId: string) {
  const previous = await client.query<{ votes_count: number; likes_count: number; comments_count: number }>(
    'SELECT votes_count, likes_count, comments_count FROM polls WHERE id = $1',
    [pollId]
  );
  const votes = await client.query('DELETE FROM poll_votes WHERE poll_id = $1 AND voter_id = $2', [pollId, userId]);
  const likes = await client.query('DELETE FROM likes WHERE user_id = $2 AND poll_id = $1', [pollId, userId]);
  const commentLikes = await client.query(
    `DELETE FROM likes l USING comments c
     WHERE l.comment_id = c.id AND c.poll_id = $1 AND l.user_id = $2`,
    [pollId, userId]
  );

  const optionCounts = await client.query(
    `WITH actual AS (
       SELECT option.id, count(vote.id)::int AS votes_count
       FROM poll_options option
       LEFT JOIN poll_votes vote ON vote.option_id = option.id
       WHERE option.poll_id = $1
       GROUP BY option.id
     )
     UPDATE poll_options option
     SET votes_count = actual.votes_count
     FROM actual
     WHERE option.id = actual.id AND option.votes_count IS DISTINCT FROM actual.votes_count
     RETURNING option.id`,
    [pollId]
  );
  const comments = await client.query<{ changed_count: number }>(
    `WITH reply_counts AS (
       SELECT parent.id,
              (SELECT count(*)::int FROM comments reply
               JOIN users reply_author ON reply_author.id = reply.author_id
               WHERE reply.parent_comment_id = parent.id AND reply.deleted_at IS NULL
                 AND reply_author.status = 'active' AND reply_author.deleted_at IS NULL) AS replies_count,
              (SELECT count(*)::int FROM likes WHERE comment_id = parent.id) AS likes_count
       FROM comments parent WHERE parent.poll_id = $1
     ), updated AS (
       UPDATE comments comment
       SET replies_count = reply_counts.replies_count,
           likes_count = reply_counts.likes_count
       FROM reply_counts
       WHERE comment.id = reply_counts.id
         AND (comment.replies_count IS DISTINCT FROM reply_counts.replies_count
           OR comment.likes_count IS DISTINCT FROM reply_counts.likes_count)
       RETURNING comment.id
     )
     SELECT count(*)::int AS changed_count FROM updated`,
    [pollId]
  );
  const totals = await client.query<{ votes_count: number; likes_count: number; comments_count: number; changed_count: number }>(
    `WITH totals AS (
       SELECT
         (SELECT count(*)::int FROM poll_votes WHERE poll_id = $1) AS votes_count,
         (SELECT count(*)::int FROM likes WHERE poll_id = $1) AS likes_count,
         (SELECT count(*)::int FROM comments c JOIN users author ON author.id = c.author_id
          WHERE c.poll_id = $1 AND c.deleted_at IS NULL AND author.status = 'active' AND author.deleted_at IS NULL) AS comments_count
     ), updated AS (
       UPDATE polls p
       SET votes_count = totals.votes_count,
           likes_count = totals.likes_count,
           comments_count = totals.comments_count,
           votes_revision = p.votes_revision + CASE WHEN $2::int > 0 OR p.votes_count IS DISTINCT FROM totals.votes_count THEN 1 ELSE 0 END,
           likes_revision = p.likes_revision + CASE WHEN $3::int > 0 OR p.likes_count IS DISTINCT FROM totals.likes_count THEN 1 ELSE 0 END,
           comments_revision = p.comments_revision + CASE
             WHEN p.comments_count IS DISTINCT FROM totals.comments_count OR $4::int > 0 THEN 1 ELSE 0 END,
           updated_at = now()
       FROM totals
       WHERE p.id = $1
       RETURNING p.id
     )
     SELECT (SELECT votes_count FROM totals) AS votes_count,
            (SELECT likes_count FROM totals) AS likes_count,
            (SELECT comments_count FROM totals) AS comments_count,
            (SELECT count(*)::int FROM updated) AS changed_count`,
    [pollId, (votes.rowCount ?? 0) + (optionCounts.rowCount ?? 0), likes.rowCount ?? 0,
      (comments.rows[0]?.changed_count ?? 0) + (commentLikes.rowCount ?? 0)]
  );

  const priorCounters = previous.rows[0];
  const nextCounters = totals.rows[0];
  const pollLikesChanged = (likes.rowCount ?? 0) > 0 || priorCounters?.likes_count !== nextCounters?.likes_count;
  const votesChanged = (votes.rowCount ?? 0) > 0 || (optionCounts.rowCount ?? 0) > 0
    || priorCounters?.votes_count !== nextCounters?.votes_count;
  const commentsChanged = (commentLikes.rowCount ?? 0) > 0 || (comments.rows[0]?.changed_count ?? 0) > 0
    || priorCounters?.comments_count !== nextCounters?.comments_count;
  if (pollLikesChanged || votesChanged || commentsChanged) {
    const [poll] = await hydratePolls(client, [pollId]);
    if (poll?.visibility === 'public') {
      const event: RealtimeEvent = { type: 'poll.vote.updated', payload: { poll } };
      await client.query(
        `INSERT INTO account_deletion_relationship_events (operation_id, poll_id, event_payload)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (operation_id, poll_id) DO UPDATE
           SET event_payload = EXCLUDED.event_payload, delivered_at = NULL,
               available_at = now(), lease_owner = NULL, lease_until = NULL, updated_at = now()`,
        [operationId, pollId, JSON.stringify(event)]
      );
    }
  }

  return { votes: votes.rowCount ?? 0, pollLikes: likes.rowCount ?? 0, commentLikes: commentLikes.rowCount ?? 0 };
}

async function deleteAccountFollows(client: PoolClient, userId: string) {
  const affectedProfiles = await client.query<{ user_id: string }>(
    `SELECT DISTINCT CASE WHEN follower_id = $1 THEN followee_id ELSE follower_id END AS user_id
     FROM follows WHERE follower_id = $1 OR followee_id = $1 ORDER BY user_id`,
    [userId]
  );
  const profiles = [...new Set([userId, ...affectedProfiles.rows.map((row) => row.user_id)])].sort();
  // Follow mutations lock accounts before profiles; acceptance has already drained any
  // mutation involving the deleted account, and the sorted profile lock serializes recounts.
  await client.query('SELECT user_id FROM profiles WHERE user_id = ANY($1::uuid[]) ORDER BY user_id FOR UPDATE', [profiles]);
  await client.query('DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1', [userId]);
  await client.query(
    `UPDATE profiles p
     SET followers_count = (SELECT count(*)::int FROM follows WHERE followee_id = p.user_id),
         following_count = (SELECT count(*)::int FROM follows WHERE follower_id = p.user_id)
     WHERE p.user_id = ANY($1::uuid[])`,
    [profiles]
  );
}

export async function purgeAccountRelationships(operationId: string): Promise<{ done: boolean }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const operation = await client.query<{ user_id: string }>(
      `SELECT user_id FROM account_deletion_operations
       WHERE id = $1 AND status <> 'not_started' FOR UPDATE`,
      [operationId]
    );
    const userId = operation.rows[0]?.user_id;
    if (!userId) throw new Error('account_deletion_operation_not_found');

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    await rememberCounterTargets(client, operationId, userId);
    const step = await client.query<{ cursor_id: string | null }>(
      `SELECT cursor_id FROM account_deletion_steps
       WHERE operation_id = $1 AND step_key = 'relationships' FOR UPDATE`,
      [operationId]
    );
    if (!step.rows[0]) throw new Error('account_deletion_relationship_step_not_found');

    const pollId = await getNextAffectedPoll(client, operationId, userId, step.rows[0].cursor_id);
    if (pollId) {
      await client.query('SELECT id FROM polls WHERE id = $1 FOR UPDATE', [pollId]);
      await recountPollRelationships(client, operationId, pollId, userId);
      await client.query(
        `UPDATE account_deletion_steps
         SET cursor_id = $2, processed_count = processed_count + 1, updated_at = now()
         WHERE operation_id = $1 AND step_key = 'relationships'`,
        [operationId, pollId]
      );
      await client.query('COMMIT');
      return { done: false };
    }

    await deleteAccountFollows(client, userId);
    await client.query('DELETE FROM poll_votes WHERE voter_id = $1', [userId]);
    await client.query('DELETE FROM likes WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    return { done: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function dispatchPendingRelationshipEvents(limit = 50) {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 100));
  const client = await db.connect();
  const leaseOwner = randomUUID();
  let claimed: EventRow[] = [];
  try {
    await client.query('BEGIN');
    const result = await client.query<EventRow>(
      `WITH claimable AS (
         SELECT id FROM account_deletion_relationship_events
         WHERE delivered_at IS NULL AND available_at <= now()
           AND (lease_until IS NULL OR lease_until <= now())
         ORDER BY available_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE account_deletion_relationship_events event
       SET lease_owner = $2, lease_until = now() + interval '30 seconds', attempts = attempts + 1,
           updated_at = now()
       FROM claimable WHERE event.id = claimable.id
       RETURNING event.id, event.event_payload`,
      [boundedLimit, leaseOwner]
    );
    claimed = result.rows;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  let delivered = 0;
  for (const row of claimed) {
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          realtimeBus.publishBroadcast(row.event_payload),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('realtime_publish_timeout')), 1_000);
            timeout.unref?.();
          })
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      const result = await db.query(
        `UPDATE account_deletion_relationship_events
         SET delivered_at = now(), lease_owner = NULL, lease_until = NULL, last_error_code = NULL,
             updated_at = now()
         WHERE id = $1 AND lease_owner = $2 AND delivered_at IS NULL`,
        [row.id, leaseOwner]
      );
      if (result.rowCount === 1) delivered += 1;
    } catch {
      await db.query(
        `UPDATE account_deletion_relationship_events
         SET available_at = now() + LEAST(interval '15 minutes', interval '5 seconds' * power(2, LEAST(attempts - 1, 8))),
             lease_owner = NULL, lease_until = NULL, last_error_code = 'realtime_unavailable', updated_at = now()
         WHERE id = $1 AND lease_owner = $2 AND delivered_at IS NULL`,
        [row.id, leaseOwner]
      );
    }
  }
  return { claimed: claimed.length, delivered };
}
