import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';

export type UserStatus = 'active' | 'blocked' | 'deleted';

export type UserWithProfileRow = {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
  display_name: string;
  bio: string | null;
  avatar_object_key: string | null;
  polls_count: number;
  followers_count: number;
  following_count: number;
};

export type PublicUser = {
  id: string;
  email: string;
  username: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  profile: {
    displayName: string;
    bio: string | null;
    avatarObjectKey: string | null;
    pollsCount: number;
    followersCount: number;
    followingCount: number;
  };
};

export type CreateUserInput = {
  email: string;
  username: string;
  passwordHash: string;
  displayName: string;
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

function mapUserWithPassword(row: UserWithProfileRow) {
  return {
    user: mapUser(row),
    passwordHash: row.password_hash
  };
}

async function findUserByIdWithClient(client: PoolClient, userId: string) {
  const result = await client.query<UserWithProfileRow>(
    `
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
      JOIN profiles p ON p.user_id = u.id
      WHERE u.id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId]
  );

  const row = result.rows[0];

  return row ? mapUserWithPassword(row) : null;
}

export async function createUser(input: CreateUserInput) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query<{ id: string }>(
      `
        INSERT INTO users (email, username, password_hash)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [input.email, input.username, input.passwordHash]
    );

    const userId = userResult.rows[0]?.id;

    if (!userId) {
      throw new Error('User insert did not return an id.');
    }

    await client.query(
      `
        INSERT INTO profiles (user_id, display_name)
        VALUES ($1, $2)
      `,
      [userId, input.displayName]
    );

    const createdUser = await findUserByIdWithClient(client, userId);

    if (!createdUser) {
      throw new Error('Created user could not be loaded.');
    }

    await client.query('COMMIT');

    return createdUser.user;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function findUserByEmailOrUsername(login: string) {
  const result = await db.query<UserWithProfileRow>(
    `
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
      JOIN profiles p ON p.user_id = u.id
      WHERE (u.email = $1 OR u.username = $1)
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [login]
  );

  const row = result.rows[0];

  return row ? mapUserWithPassword(row) : null;
}

export async function findUserById(userId: string) {
  const result = await db.query<UserWithProfileRow>(
    `
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
      JOIN profiles p ON p.user_id = u.id
      WHERE u.id = $1
        AND u.deleted_at IS NULL
      LIMIT 1
    `,
    [userId]
  );

  const row = result.rows[0];

  return row ? mapUser(row) : null;
}

export async function markUserSeen(userId: string) {
  await db.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [userId]);
}
