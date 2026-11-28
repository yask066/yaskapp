import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import { UserBlockNotFoundError, lockUserBlockParticipants } from './user-blocks.policy.js';

export type UserBlockState = {
  targetUserId: string;
  blockedByViewer: boolean;
  viewerVisibilityRevision: string;
};

export class InvalidUserBlockError extends Error {
  readonly code = 'invalid_block';
  readonly statusCode = 400;

  constructor() {
    super('A user cannot block themselves.');
    this.name = 'InvalidUserBlockError';
  }
}

type Follow = { follower_id: string; followee_id: string };
type ProfileDelta = { followers: number; following: number };

async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function validateUsers(client: PoolClient, blockerId: string, blockedId: string, blocked: boolean) {
  const result = await client.query<{
    id: string;
    status: string;
    deleted_at: Date | null;
  }>(
    'SELECT id, status, deleted_at FROM users WHERE id = ANY($1::uuid[])',
    [[blockerId, blockedId]]
  );
  const users = new Map(result.rows.map((user) => [user.id, user]));
  const blocker = users.get(blockerId);
  const target = users.get(blockedId);

  if (!blocker || blocker.status !== 'active' || blocker.deleted_at) {
    throw new UserBlockNotFoundError();
  }
  if (blocked && (!target || target.status !== 'active' || target.deleted_at)) {
    throw new UserBlockNotFoundError();
  }
}

async function removeFollows(client: PoolClient, firstUserId: string, secondUserId: string) {
  const result = await client.query<Follow>(
    `DELETE FROM follows
     WHERE (follower_id = $1 AND followee_id = $2)
        OR (follower_id = $2 AND followee_id = $1)
     RETURNING follower_id, followee_id`,
    [firstUserId, secondUserId]
  );
  const deltas = new Map<string, ProfileDelta>();
  const forUser = (userId: string) => {
    let delta = deltas.get(userId);
    if (!delta) {
      delta = { followers: 0, following: 0 };
      deltas.set(userId, delta);
    }
    return delta;
  };

  for (const follow of result.rows) {
    forUser(follow.follower_id).following += 1;
    forUser(follow.followee_id).followers += 1;
  }
  for (const [userId, delta] of [...deltas.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    await client.query(
      `UPDATE profiles
       SET followers_count = GREATEST(followers_count - $2, 0),
           following_count = GREATEST(following_count - $3, 0)
       WHERE user_id = $1`,
      [userId, delta.followers, delta.following]
    );
  }
}

async function suppressNotifications(client: PoolClient, firstUserId: string, secondUserId: string) {
  await client.query(
    `INSERT INTO notification_suppressions (notification_id, recipient_user_id)
     SELECT n.id, n.recipient_user_id
     FROM notifications n
     LEFT JOIN polls poll ON poll.id = n.poll_id
     LEFT JOIN comments comment ON comment.id = n.comment_id
     LEFT JOIN polls comment_poll ON comment_poll.id = comment.poll_id
     WHERE (n.recipient_user_id = $1 AND (
              n.actor_user_id = $2 OR poll.author_id = $2
              OR comment.author_id = $2 OR comment_poll.author_id = $2
            ))
        OR (n.recipient_user_id = $2 AND (
              n.actor_user_id = $1 OR poll.author_id = $1
              OR comment.author_id = $1 OR comment_poll.author_id = $1
            ))
     ON CONFLICT (notification_id, recipient_user_id) DO NOTHING`,
    [firstUserId, secondUserId]
  );
}

async function incrementVisibilityRevisions(client: PoolClient, userIds: string[]) {
  const result = await client.query<{ user_id: string; revision: string }>(
    `INSERT INTO user_visibility_revisions (user_id, revision, updated_at)
     SELECT user_id, 1, now() FROM unnest($1::uuid[]) AS participants(user_id)
     ON CONFLICT (user_id) DO UPDATE
       SET revision = user_visibility_revisions.revision + 1, updated_at = now()
     RETURNING user_id, revision::text`,
    [userIds]
  );
  return new Map(result.rows.map((row) => [row.user_id, row.revision]));
}

async function currentVisibilityRevision(client: PoolClient, userId: string) {
  const result = await client.query<{ revision: string }>(
    `SELECT COALESCE((
       SELECT revision::text FROM user_visibility_revisions WHERE user_id = $1
     ), '0') AS revision`,
    [userId]
  );
  return result.rows[0]?.revision ?? '0';
}

async function enqueueEvent(
  client: PoolClient,
  recipientId: string,
  eventType: 'user_blocks.changed' | 'viewer.visibility_invalidated',
  payload: Record<string, string | boolean>
) {
  await client.query(
    `INSERT INTO user_blocks_outbox (recipient_user_id, event_type, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [recipientId, eventType, JSON.stringify(payload)]
  );
}

async function recordChange(
  client: PoolClient,
  blockerId: string,
  blockedId: string,
  blocked: boolean
) {
  const revisions = await incrementVisibilityRevisions(client, [blockerId, blockedId].sort());
  const viewerVisibilityRevision = revisions.get(blockerId) ?? '0';
  await enqueueEvent(client, blockerId, 'user_blocks.changed', {
    targetUserId: blockedId,
    blockedByViewer: blocked,
    viewerVisibilityRevision
  });
  for (const userId of [blockerId, blockedId]) {
    await enqueueEvent(client, userId, 'viewer.visibility_invalidated', {
      viewerVisibilityRevision: revisions.get(userId) ?? '0'
    });
  }
  return viewerVisibilityRevision;
}

export async function setUserBlock(input: {
  blockerId: string;
  blockedId: string;
  blocked: boolean;
}): Promise<UserBlockState> {
  const blockerId = input.blockerId.toLowerCase();
  const blockedId = input.blockedId.toLowerCase();
  if (blockerId === blockedId) throw new InvalidUserBlockError();

  return withTransaction(async (client) => {
    await lockUserBlockParticipants(client, [blockerId, blockedId]);
    await validateUsers(client, blockerId, blockedId, input.blocked);

    const change = input.blocked
      ? await client.query(
          `INSERT INTO user_blocks (blocker_user_id, blocked_user_id)
           VALUES ($1, $2) ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
           RETURNING blocked_user_id`,
          [blockerId, blockedId]
        )
      : await client.query(
          `DELETE FROM user_blocks
           WHERE blocker_user_id = $1 AND blocked_user_id = $2
           RETURNING blocked_user_id`,
          [blockerId, blockedId]
        );

    if (change.rows.length === 0) {
      return {
        targetUserId: blockedId,
        blockedByViewer: input.blocked,
        viewerVisibilityRevision: await currentVisibilityRevision(client, blockerId)
      };
    }

    if (input.blocked) {
      await removeFollows(client, blockerId, blockedId);
      await suppressNotifications(client, blockerId, blockedId);
    }
    const viewerVisibilityRevision = await recordChange(client, blockerId, blockedId, input.blocked);
    return { targetUserId: blockedId, blockedByViewer: input.blocked, viewerVisibilityRevision };
  });
}
