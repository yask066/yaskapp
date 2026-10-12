import assert from 'node:assert/strict';
import test from 'node:test';

import { db } from '../../config/database.js';
import { deleteAdminUser } from './admin.users.repository.js';

test('last_superadmin_mutation_is_serialized_before_user_locks', async (context) => {
  const statements: string[] = [];
  context.mock.method(db, 'connect', async () => ({
    async query(sql: string, values: unknown[] = []) {
      statements.push(sql);
      if (sql.includes('SELECT id, role, status, deleted_at FROM users')) {
        const isActor = values[0] === 'actor';
        return { rows: [{ id: values[0], role: isActor ? 'moderator' : 'superadmin', status: 'active', deleted_at: null }] };
      }
      if (sql.includes('count(*)::text AS count FROM users')) return { rows: [{ count: '1' }] };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  } as never));

  const result = await deleteAdminUser('actor', 'target', {
    actorUserId: 'actor', actorRole: 'moderator', reason: 'test'
  });

  assert.deepEqual(result, { status: 'last_superadmin' });
  const advisoryLockIndex = statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
  const firstUserLockIndex = statements.findIndex((sql) => sql.includes('FOR UPDATE'));
  assert.ok(advisoryLockIndex >= 0 && advisoryLockIndex < firstUserLockIndex);
});
