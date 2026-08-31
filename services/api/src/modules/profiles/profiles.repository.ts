import { db } from '../../config/database.js';
import { avatarUrlForUser } from './avatar-url.js';
import { searchUserRecords } from '../search/search.repository.js';
import type { PublicUser, UserWithProfileRow } from '../auth/auth.repository.js';

type UpdateProfileInput = {
  userId: string;
  displayName?: string;
  bio?: string | null;
  countryCode?: string | null;
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
    countryCode: string | null;
    avatarObjectKey: string | null;
    avatarUrl: string | null;
    pollsCount: number;
    followersCount: number;
    followingCount: number;
  };
};

export async function findProfileCountryCode(userId: string) {
  const result = await db.query<{ country_code: string | null }>(
    `
      SELECT p.country_code
      FROM profiles p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0]?.country_code;
}

export async function updateAvatarObjectKey(userId: string, objectKey: string) {
  const result = await db.query(
    `
      UPDATE profiles
      SET avatar_object_key = $2
      WHERE user_id = $1
      RETURNING user_id
    `,
    [userId, objectKey]
  );

  return result.rowCount === 1;
}

export async function clearAvatarObjectKey(userId: string) {
  const result = await db.query(
    `
      UPDATE profiles
      SET avatar_object_key = NULL
      WHERE user_id = $1
      RETURNING user_id
    `,
    [userId]
  );

  return result.rowCount === 1;
}

export async function findAvatarObjectKey(userId: string) {
  const result = await db.query<{ avatar_object_key: string | null }>(
    `
      SELECT p.avatar_object_key
      FROM profiles p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0]?.avatar_object_key;
}

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
      countryCode: row.country_code,
      avatarObjectKey: row.avatar_object_key,
      avatarUrl: avatarUrlForUser(row.id, row.avatar_object_key),
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
      countryCode: row.country_code,
      avatarObjectKey: row.avatar_object_key,
      avatarUrl: avatarUrlForUser(row.id, row.avatar_object_key),
      pollsCount: row.polls_count,
      followersCount: row.followers_count,
      followingCount: row.following_count
    }
  };
}

async function listPublicProfiles(
  query: string,
  values: unknown[]
): Promise<PublicProfile[]> {
  const result = await db.query<PublicProfileRow>(query, values);

  return result.rows.map(mapPublicProfile);
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
        p.country_code,
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
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId, viewerId ?? null]
  );

  const row = result.rows[0];

  return row ? mapPublicProfile(row) : null;
}

export async function listFollowingRecords(userId: string, limit: number) {
  return listPublicProfiles(
    `
      SELECT
        u.id,
        u.username::text AS username,
        u.status,
        u.created_at,
        u.updated_at,
        p.display_name,
        p.bio,
        p.country_code,
        p.avatar_object_key,
        p.polls_count,
        p.followers_count,
        p.following_count,
        true AS viewer_is_following
      FROM follows f
      JOIN users u ON u.id = f.followee_id
      JOIN profiles p ON p.user_id = u.id
      WHERE f.follower_id = $1
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      ORDER BY f.created_at DESC, f.followee_id DESC
      LIMIT $2
    `,
    [userId, limit]
  );
}

export async function listFollowerRecords(
  userId: string,
  viewerId: string | undefined,
  limit: number
) {
  return listPublicProfiles(
    `
      SELECT
        u.id,
        u.username::text AS username,
        u.status,
        u.created_at,
        u.updated_at,
        p.display_name,
        p.bio,
        p.country_code,
        p.avatar_object_key,
        p.polls_count,
        p.followers_count,
        p.following_count,
        CASE
          WHEN $2::uuid IS NULL THEN false
          ELSE EXISTS (
            SELECT 1
            FROM follows viewer_follow
            WHERE viewer_follow.follower_id = $2::uuid
              AND viewer_follow.followee_id = u.id
          )
        END AS viewer_is_following
      FROM follows f
      JOIN users u ON u.id = f.follower_id
      JOIN profiles p ON p.user_id = u.id
      WHERE f.followee_id = $1
        AND u.status = 'active'
        AND u.deleted_at IS NULL
      ORDER BY f.created_at DESC, f.follower_id DESC
      LIMIT $3
    `,
    [userId, viewerId ?? null, limit]
  );
}

export async function listPopularProfileRecords(viewerId: string | undefined, limit: number) {
  const records = await searchUserRecords({
    viewerId: viewerId ?? (null as unknown as string),
    query: '',
    type: 'users',
    sort: 'popular',
    limit
  });

  return records.map((record) => record.user);
}

export async function updateProfileRecord(input: UpdateProfileInput) {
  const result = await db.query<UserWithProfileRow>(
    `
      WITH updated_profile AS (
        UPDATE profiles
        SET
          display_name = COALESCE($2, display_name),
          bio = CASE WHEN $4 THEN $3 ELSE bio END,
          country_code = CASE WHEN $6 THEN $5 ELSE country_code END
        WHERE user_id = $1
        RETURNING
          user_id,
          display_name,
          bio,
          country_code,
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
        p.country_code,
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
    [
      input.userId,
      input.displayName ?? null,
      input.bio ?? null,
      'bio' in input,
      input.countryCode ?? null,
      'countryCode' in input
    ]
  );

  const row = result.rows[0];

  return row ? mapUser(row) : null;
}
