import { db } from '../config/database.js';

const usage = 'Usage: npm run db:bootstrap-superadmin -- --login <email-or-username>';
const bootstrapLockId = 7_455_292;

export function parseBootstrapArgs(args: string[]) {
  let login: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--login') {
      if (login || !args[index + 1] || args[index + 1].startsWith('--')) {
        throw new Error(usage);
      }
      login = args[index + 1].trim();
      index += 1;
      continue;
    }

    if (arg.startsWith('--login=')) {
      if (login || !arg.slice('--login='.length).trim()) {
        throw new Error(usage);
      }
      login = arg.slice('--login='.length).trim();
      continue;
    }

    throw new Error(usage);
  }

  if (!login) {
    throw new Error(usage);
  }

  return { login };
}

export async function bootstrapSuperadmin(login: string) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [bootstrapLockId]);

    const targetResult = await client.query<{
      id: string;
      email: string;
      username: string;
      role: 'user' | 'moderator' | 'superadmin';
      status: 'active' | 'blocked' | 'deleted';
      deleted_at: Date | null;
    }>(
      `
        SELECT id, email::text AS email, username::text AS username, role, status, deleted_at
        FROM users
        WHERE (email = $1 OR username = $1)
        FOR UPDATE
      `,
      [login]
    );
    const target = targetResult.rows[0];

    if (!target) {
      throw new Error(`User not found for login: ${login}`);
    }
    if (target.status !== 'active' || target.deleted_at) {
      throw new Error('Only an active, non-deleted user can become the first superadmin.');
    }
    if (target.role === 'superadmin') {
      await client.query('COMMIT');
      return { status: 'already_superadmin' as const, userId: target.id, login: target.username };
    }

    const countResult = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users WHERE role = 'superadmin' AND status = 'active' AND deleted_at IS NULL"
    );
    if (Number(countResult.rows[0]?.count ?? 0) > 0) {
      throw new Error('An active superadmin already exists. Bootstrap is first-admin only.');
    }

    await client.query(
      "UPDATE users SET role = 'superadmin', updated_at = now() WHERE id = $1",
      [target.id]
    );
    await client.query('COMMIT');
    return { status: 'promoted' as const, userId: target.id, login: target.username };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
