import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';

export type FollowMutation = {
  followerId: string;
  followeeId: string;
};

export type FollowMutationResult = {
  following: boolean;
  followerFollowingCount: number;
  followeeFollowersCount: number;
};

export class FollowRepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: 'SELF_FOLLOW' | 'USER_NOT_FOUND'
  ) {
    super(message);
    this.name = 'FollowRepositoryError';
  }
}

async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
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

async function lockUserProfiles(
  client: PoolClient,
  userIds: string[]
): Promise<Set<string>> {
  const result = await client.query<{ user_id: string }>(
    `
      SELECT p.user_id
      FROM profiles p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ANY($1::uuid[])
        AND u.deleted_at IS NULL
      ORDER BY p.user_id
      FOR UPDATE
    `,
    [userIds]
  );

  return new Set(result.rows.map((row) => row.user_id));
}

async function readFollowCounts(
  client: PoolClient,
  followerId: string,
  followeeId: string
) {
  const result = await client.query<{
    user_id: string;
    followers_count: number;
    following_count: number;
  }>(
    `
      SELECT user_id, followers_count, following_count
      FROM profiles
      WHERE user_id = ANY($1::uuid[])
    `,
    [[followerId, followeeId]]
  );

  const counts = new Map(result.rows.map((row) => [row.user_id, row]));
  const follower = counts.get(followerId);
  const followee = counts.get(followeeId);

  if (!follower || !followee) {
    throw new FollowRepositoryError(
      'One or more users do not have profiles.',
      'USER_NOT_FOUND'
    );
  }

  return {
    followerFollowingCount: follower.following_count,
    followeeFollowersCount: followee.followers_count
  };
}

export async function followUserRecord(
  input: FollowMutation
): Promise<FollowMutationResult> {
  if (input.followerId === input.followeeId) {
    throw new FollowRepositoryError(
      'Users cannot follow themselves.',
      'SELF_FOLLOW'
    );
  }

  return withTransaction(async (client) => {
    const userIds = [input.followerId, input.followeeId].sort();
    const existingUsers = await lockUserProfiles(client, userIds);

    if (existingUsers.size !== userIds.length) {
      throw new FollowRepositoryError(
        'The follower or followee does not exist.',
        'USER_NOT_FOUND'
      );
    }

    const insertResult = await client.query(
      `
        INSERT INTO follows (follower_id, followee_id)
        VALUES ($1, $2)
        ON CONFLICT (follower_id, followee_id) DO NOTHING
        RETURNING id
      `,
      [input.followerId, input.followeeId]
    );

    if (insertResult.rowCount === 1) {
      await client.query(
        `
          UPDATE profiles
          SET following_count = following_count + 1
          WHERE user_id = $1
        `,
        [input.followerId]
      );

      await client.query(
        `
          UPDATE profiles
          SET followers_count = followers_count + 1
          WHERE user_id = $1
        `,
        [input.followeeId]
      );
    }

    return {
      following: true,
      ...(await readFollowCounts(
        client,
        input.followerId,
        input.followeeId
      ))
    };
  });
}

export async function unfollowUserRecord(
  input: FollowMutation
): Promise<FollowMutationResult> {
  if (input.followerId === input.followeeId) {
    throw new FollowRepositoryError(
      'Users cannot unfollow themselves.',
      'SELF_FOLLOW'
    );
  }

  return withTransaction(async (client) => {
    const userIds = [input.followerId, input.followeeId].sort();
    const existingUsers = await lockUserProfiles(client, userIds);

    if (existingUsers.size !== userIds.length) {
      throw new FollowRepositoryError(
        'The follower or followee does not exist.',
        'USER_NOT_FOUND'
      );
    }

    const deleteResult = await client.query(
      `
        DELETE FROM follows
        WHERE follower_id = $1 AND followee_id = $2
        RETURNING id
      `,
      [input.followerId, input.followeeId]
    );

    if (deleteResult.rowCount === 1) {
      await client.query(
        `
          UPDATE profiles
          SET following_count = GREATEST(following_count - 1, 0)
          WHERE user_id = $1
        `,
        [input.followerId]
      );

      await client.query(
        `
          UPDATE profiles
          SET followers_count = GREATEST(followers_count - 1, 0)
          WHERE user_id = $1
        `,
        [input.followeeId]
      );
    }

    return {
      following: false,
      ...(await readFollowCounts(
        client,
        input.followerId,
        input.followeeId
      ))
    };
  });
}
