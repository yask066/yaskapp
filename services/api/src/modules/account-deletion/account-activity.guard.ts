import type { PoolClient } from 'pg';
import { db } from '../../config/database.js';

type AccountState = { status: string; deleted_at?: Date | null };
export const superadminMutationLockKey = 731105051;

export async function lockSuperadminMutation(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [superadminMutationLockKey]);
}

export class InactiveAccountError extends Error {
  readonly code = 'account_not_active';
  readonly statusCode = 409;

  constructor() {
    super('account_not_active');
  }
}

export async function withActiveAccountTransaction<T>(userId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await lockActiveAccount(client, userId);
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function lockActiveAccount(client: PoolClient, userId: string): Promise<void> {
  const result = await client.query<AccountState>(
    'SELECT status, deleted_at FROM users WHERE id = $1 FOR UPDATE',
    [userId]
  );
  const account = result.rows[0];
  if (!account || account.status !== 'active' || account.deleted_at) {
    throw new InactiveAccountError();
  }
}

export async function isActiveAccount(userId: string) {
  const result = await db.query<{ active: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM users WHERE id = $1 AND status = 'active' AND deleted_at IS NULL
     ) AS active`,
    [userId]
  );
  return result.rows[0]?.active === true;
}

export async function lockActiveAccounts(client: PoolClient, userIds: readonly string[]): Promise<void> {
  const orderedIds = [...new Set(userIds)].sort();
  for (const userId of orderedIds) {
    await lockActiveAccount(client, userId);
  }
}
