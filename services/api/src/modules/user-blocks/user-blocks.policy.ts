import type { Pool, PoolClient } from 'pg';

export type QueryExecutor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export class UserBlockNotFoundError extends Error {
  readonly code = 'not_found';
  readonly statusCode = 404;

  constructor() {
    super('Resource not found.');
    this.name = 'UserBlockNotFoundError';
  }
}

export async function hasEffectiveUserBlock(
  executor: QueryExecutor,
  firstUserId: string,
  secondUserId: string
): Promise<boolean> {
  const result = await executor.query<{ blocked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM user_blocks
       WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
          OR (blocker_user_id = $2 AND blocked_user_id = $1)
     ) AS blocked`,
    [firstUserId, secondUserId]
  );
  return result.rows[0]?.blocked === true;
}

export async function findBlockedUserIds(
  executor: QueryExecutor,
  viewerId: string,
  candidateIds: readonly string[]
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();

  const result = await executor.query<{ user_id: string }>(
    `SELECT candidate.user_id
     FROM unnest($2::uuid[]) AS candidate(user_id)
     WHERE EXISTS (
       SELECT 1 FROM user_blocks
       WHERE (blocker_user_id = $1 AND blocked_user_id = candidate.user_id)
          OR (blocker_user_id = candidate.user_id AND blocked_user_id = $1)
     )`,
    [viewerId, candidateIds]
  );
  return new Set(result.rows.map((row) => row.user_id));
}

/** Locks existing accounts in UUID order; callers still check account status. */
export async function lockUserBlockParticipants(
  client: PoolClient,
  userIds: readonly string[]
): Promise<void> {
  const orderedIds = [...new Set(userIds.map((id) => id.toLowerCase()))].sort();

  for (const userId of orderedIds) {
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
  }
}

/** Requires both participants to be locked in the current transaction. */
export async function assertNoUserBlock(
  client: PoolClient,
  firstUserId: string,
  secondUserId: string
): Promise<void> {
  if (await hasEffectiveUserBlock(client, firstUserId, secondUserId)) {
    throw new UserBlockNotFoundError();
  }
}
