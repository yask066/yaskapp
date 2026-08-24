import { db } from '../../config/database.js';
import { findUserById } from '../auth/auth.repository.js';

export type BlockUserResult =
  | { status: 'blocked' | 'already_blocked' }
  | { status: 'not_found' | 'self' | 'protected' };

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
