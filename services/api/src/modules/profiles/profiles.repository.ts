import { db } from '../../config/database.js';
import type { PublicUser, UserWithProfileRow } from '../auth/auth.repository.js';

type UpdateProfileInput = {
  userId: string;
  displayName?: string;
  bio?: string | null;
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
