import { db } from '../../config/database.js';
import type { PublicUser, UserWithProfileRow } from '../auth/auth.repository.js';

type UpdateProfileInput = {
  userId: string;
  displayName?: string;
  bio?: string | null;
};

export type PublicProfile = {
  id: string;
  username: string;
  status: 'active';
  createdAt: string;
  updatedAt: string;
  viewerIsFollowing: boolean;
  profile: {
    displayName: string;
    bio: string | null;
    avatarObjectKey: string | null;
    pollsCount: number;
    followersCount: number;
    followingCount: number;
  };
};

function mapUser(row: UserWithProfileRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    profile: {
      displayName: row.display_name,
      bio: row.bio,
      avatarObjectKey: row.avatar_object_key,
      pollsCount: row.polls_count,
      followersCount: row.followers_count,
      followingCount: row.following_count
    }
  };
}

type PublicProfileRow = Omit<UserWithProfileRow, 'email' | 'password_hash'> & {
  viewer_is_following: boolean;
};

function mapPublicProfile(row: PublicProfileRow): PublicProfile {
  return {
    id: row.id,
    username: row.username,
    status: 'active',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    viewerIsFollowing: row.viewer_is_following,
    profile: {
      displayName: row.display_name,
      bio: row.bio,
      avatarObjectKey: row.avatar_object_key,
      pollsCount: row.polls_count,
      followersCount: row.followers_count,
      followingCount: row.following_count
    }
  };
}

export async function findPublicProfileRecord(userId: string, viewerId?: string) {
  const result = await db.query<PublicProfileRow>(
    `
      SELECT
        u.id,
        u.username::text AS username,
        u.status,
        u.created_at,
        u.updated_at,
        p.display_name,
        p.bio,
        p.avatar_object_key,
        p.polls_count,
        p.followers_count,
        p.following_count,
        CASE
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1
            FROM follows f
            WHERE f.follower_id = $2::uuid
              AND f.followee_id = u.id
          )
        END AS viewer_is_following
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      WHERE u.id = $1
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId, viewerId ?? null]
  );

  const row = result.rows[0];

  return row ? mapPublicProfile(row) : null;
}

export async function updateProfileRecord(input: UpdateProfileInput) {
  const result = await db.query<UserWithProfileRow>(
    `
      WITH updated_profile AS (
        UPDATE profiles
        SET
          display_name = COALESCE($2, display_name),
          bio = CASE WHEN $4 THEN $3 ELSE bio END
        WHERE user_id = $1
        RETURNING
          user_id,
          display_name,
          bio,
          avatar_object_key,
          polls_count,
          followers_count,
          following_count
      )
      SELECT
        u.id,
        u.email::text AS email,
        u.username::text AS username,
        u.password_hash,
        u.status,
        u.created_at,
        u.updated_at,
        p.display_name,
        p.bio,
        p.avatar_object_key,
        p.polls_count,
        p.followers_count,
        p.following_count
      FROM users u
      JOIN updated_profile p ON p.user_id = u.id
      WHERE u.id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [input.userId, input.displayName ?? null, input.bio ?? null, 'bio' in input]
  );

  const row = result.rows[0];

  return row ? mapUser(row) : null;
}
