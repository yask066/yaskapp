import { db } from '../../config/database.js';
import { findUserById } from '../auth/auth.repository.js';

export type BlockUserResult =
  | { status: 'blocked' | 'already_blocked' }
  | { status: 'not_found' | 'self' | 'protected' };

export type AdminPoll = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  question: string;
  description: string | null;
  visibility: 'public' | 'followers' | 'private';
  status: 'active' | 'deleted';
  votesCount: number;
  commentsCount: number;
  likesCount: number;
  createdAt: string;
  deletedAt: string | null;
};

export type AdminCommentDeleteResult =
  | { status: 'deleted' | 'already_deleted'; pollId: string }
  | { status: 'not_found' };

export async function blockUser(actorId: string, targetUserId: string): Promise<BlockUserResult> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const actorResult = await client.query<{ role: string }>(
      `
        SELECT role
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [actorId]
    );
    const targetResult = await client.query<{
      status: 'active' | 'blocked' | 'deleted';
      role: string;
    }>(
      `
        SELECT status, role
        FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [targetUserId]
    );

    const actor = actorResult.rows[0];
    const target = targetResult.rows[0];

    if (!actor || !target) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }

    if (actorId === targetUserId) {
      await client.query('ROLLBACK');
      return { status: 'self' };
    }

    if (target.role === 'superadmin' ||
        (actor.role === 'moderator' && target.role !== 'user')) {
      await client.query('ROLLBACK');
      return { status: 'protected' };
    }

    if (target.status === 'blocked') {
      await client.query('COMMIT');
      return { status: 'already_blocked' };
    }

    await client.query(
      `
        UPDATE users
        SET status = 'blocked', updated_at = now()
        WHERE id = $1
      `,
      [targetUserId]
    );

    await client.query('COMMIT');
    return { status: 'blocked' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getBlockedUser(userId: string) {
  return findUserById(userId);
}

function mapAdminPoll(row: {
  id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  question: string;
  description: string | null;
  visibility: 'public' | 'followers' | 'private';
  deleted_at: Date | null;
  votes_count: number;
  comments_count: number;
  likes_count: number;
  created_at: Date;
}): AdminPoll {
  return {
    id: row.id,
    authorId: row.author_id,
    authorUsername: row.author_username,
    authorDisplayName: row.author_display_name,
    question: row.question,
    description: row.description,
    visibility: row.visibility,
    status: row.deleted_at ? 'deleted' : 'active',
    votesCount: row.votes_count,
    commentsCount: row.comments_count,
    likesCount: row.likes_count,
    createdAt: row.created_at.toISOString(),
    deletedAt: row.deleted_at?.toISOString() ?? null
  };
}

export async function listAdminPolls(input: {
  limit: number;
  offset: number;
  query?: string;
  status?: 'active' | 'deleted' | 'all';
  authorId?: string;
}) {
  const values: unknown[] = [];
  const conditions = ['TRUE'];

  if (input.query) {
    values.push(`%${input.query}%`);
    conditions.push(`p.question ILIKE $${values.length}`);
  }

  if (input.status === 'active') {
    conditions.push('p.deleted_at IS NULL');
  } else if (input.status === 'deleted') {
    conditions.push('p.deleted_at IS NOT NULL');
  }

  if (input.authorId) {
    values.push(input.authorId);
    conditions.push(`p.author_id = $${values.length}`);
  }

  values.push(input.limit, input.offset);
  const result = await db.query<Parameters<typeof mapAdminPoll>[0]>(
    `
      SELECT
        p.id,
        p.author_id,
        u.username::text AS author_username,
        pr.display_name AS author_display_name,
        p.question,
        p.description,
        p.visibility,
        p.deleted_at,
        p.votes_count,
        p.comments_count,
        p.likes_count,
        p.created_at
      FROM polls p
      JOIN users u ON u.id = p.author_id
      JOIN profiles pr ON pr.user_id = p.author_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
    `,
    values
  );

  return result.rows.map(mapAdminPoll);
}

export async function getAdminPoll(pollId: string) {
  const result = await db.query<Parameters<typeof mapAdminPoll>[0]>(
    `
      SELECT
        p.id,
        p.author_id,
        u.username::text AS author_username,
        pr.display_name AS author_display_name,
        p.question,
        p.description,
        p.visibility,
        p.deleted_at,
        p.votes_count,
        p.comments_count,
        p.likes_count,
        p.created_at
      FROM polls p
      JOIN users u ON u.id = p.author_id
      JOIN profiles pr ON pr.user_id = p.author_id
      WHERE p.id = $1
      LIMIT 1
    `,
    [pollId]
  );

  const row = result.rows[0];
  return row ? mapAdminPoll(row) : null;
}

export async function deleteAdminPoll(pollId: string) {
  const result = await db.query<{ id: string }>(
    `
      UPDATE polls
      SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
      WHERE id = $1
        AND deleted_at IS NULL
      RETURNING id
    `,
    [pollId]
  );

  if (result.rowCount === 1) {
    return { status: 'deleted' as const };
  }

  const existing = await db.query<{ id: string }>(
    'SELECT id FROM polls WHERE id = $1',
    [pollId]
  );

  return existing.rowCount === 1
    ? { status: 'already_deleted' as const }
    : { status: 'not_found' as const };
}

export async function deleteAdminComment(
  commentId: string
): Promise<AdminCommentDeleteResult> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const current = await client.query<{
      poll_id: string;
      deleted_at: Date | null;
    }>(
      `
        SELECT poll_id, deleted_at
        FROM comments
        WHERE id = $1
        FOR UPDATE
      `,
      [commentId]
    );
    const comment = current.rows[0];

    if (!comment) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }

    if (comment.deleted_at) {
      await client.query('COMMIT');
      return { status: 'already_deleted', pollId: comment.poll_id };
    }

    await client.query(
      `
        UPDATE comments
        SET deleted_at = now(), updated_at = now()
        WHERE id = $1
      `,
      [commentId]
    );
    await client.query(
      `
        UPDATE polls
        SET comments_count = GREATEST(comments_count - 1, 0), updated_at = now()
        WHERE id = $1
      `,
      [comment.poll_id]
    );

    await client.query('COMMIT');
    return { status: 'deleted', pollId: comment.poll_id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
