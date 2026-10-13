import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { test } from 'node:test';

import type { Database } from '../../config/database.js';
import { isSessionRevoked } from '../auth/auth.utils.js';
import { createAccountDeletionCompletionRepository, createAccountDeletionCompletionService } from './account-deletion.completion.js';

function fixture(options: {
  mediaPurgeDone?: boolean;
  mediaEmpty?: boolean;
  residues?: boolean;
  stepsComplete?: boolean;
  userExists?: boolean;
} = {}) {
  const state = {
    operation: { userId: 'user-1', status: 'processing' as const },
    receiptExists: true,
    userExists: options.userExists ?? true,
    manifestRemoved: false,
    targetsRemoved: false,
    mediaCalls: [] as string[],
    residues: options.residues ?? false,
    stepsComplete: options.stepsComplete ?? true
  };
  const service = createAccountDeletionCompletionService({
    repository: {
      async getOperation() { return state.operation; },
      async arePreviousStepsComplete() { return state.stepsComplete; },
      async hasDatabaseRemainders() { return state.residues; },
      async deleteUser() { state.userExists = false; },
      async removeManifest() { state.manifestRemoved = true; },
      async removeContentTargets() { state.targetsRemoved = true; },
      async removeDeletedContentTargets() { state.targetsRemoved = true; },
      async removeCounterTargets() { state.targetsRemoved = true; },
      async hasPostDeleteRemainders() { return state.residues || state.userExists; }
    },
    media: {
      async discover() { state.mediaCalls.push('discover'); return { done: true }; },
      async purge() { state.mediaCalls.push('purge'); return { done: options.mediaPurgeDone ?? true }; },
      async verifyEmpty() { state.mediaCalls.push('verify'); return options.mediaEmpty ?? true; }
    }
  });
  return { state, service };
}

test('remaining_object_prevents_completed', async () => {
  const { state, service } = fixture({ mediaEmpty: false });
  assert.deepEqual(await service.verifyAndCompleteDeletion('operation-1'), { done: false });
  assert.equal(state.userExists, true);
  assert.equal(state.manifestRemoved, false);
  assert.deepEqual(state.mediaCalls, ['discover', 'purge', 'verify']);
});

test('user_physical_delete_preserves_receipt', async () => {
  const { state, service } = fixture();
  assert.deepEqual(await service.verifyAndCompleteDeletion('operation-1'), { done: true });
  assert.equal(state.userExists, false);
  assert.equal(await state.receiptExists, true);
  assert.equal(state.manifestRemoved, true);
  assert.equal(state.targetsRemoved, true);
});

test('incomplete_cleanup_step_prevents_identity_delete', async () => {
  const { state, service } = fixture({ stepsComplete: false });
  assert.deepEqual(await service.verifyAndCompleteDeletion('operation-1'), { done: false });
  assert.equal(state.userExists, true);
  assert.deepEqual(state.mediaCalls, []);
});

test('database_remainder_prevents_identity_delete', async () => {
  const { state, service } = fixture({ residues: true });
  assert.deepEqual(await service.verifyAndCompleteDeletion('operation-1'), { done: false });
  assert.equal(state.userExists, true);
  assert.equal(state.manifestRemoved, false);
});

test('account_identity_is_allowed_before_physical_delete', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const fakeDatabase = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      return { rows: [{ exists: false }], rowCount: 0 };
    },
    async connect() { throw new Error('not used'); }
  } as unknown as Database;
  const repository = createAccountDeletionCompletionRepository(fakeDatabase);

  await repository.hasDatabaseRemainders('operation-1', 'user-1');
  await repository.hasPostDeleteRemainders('operation-1', 'user-1');

  const residualSql = queries.find(({ sql }) => sql.includes('deleted_targets'))?.sql ?? '';
  assert.match(residualSql, /\$3::boolean AND \(EXISTS \(SELECT 1 FROM users[\s\S]*EXISTS \(SELECT 1 FROM profiles/);
  const countSql = queries.find(({ sql }) => sql.includes('target_polls'))?.sql ?? '';
  assert.match(countSql, /account_deletion_counter_targets/);
  assert.match(countSql, /target_type = 'profile'/);
  assert.equal(queries[0]?.values[2], false);
  assert.equal(queries[2]?.values[2], true);
});

const testDatabaseUrl = process.env.ACCOUNT_DELETION_TEST_DATABASE_URL;

test('reregister_gets_new_empty_account', { skip: !testDatabaseUrl }, async () => {
  const databaseUrl = new URL(testDatabaseUrl!);
  assert.match(databaseUrl.pathname, /test/i, 'integration tests require a dedicated test database');
  const pool = new Pool({ connectionString: testDatabaseUrl });
  const suffix = randomUUID().replaceAll('-', '').slice(0, 18);
  const oldUserId = randomUUID();
  const newUserId = randomUUID();
  const operationId = randomUUID();
  const email = `ad11_${suffix}@yaskapp.test`;
  const username = `ad11_${suffix}`;
  const statusHash = createHash('sha256').update(`status-${suffix}`).digest('hex');
  try {
    await pool.query(
      'INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)',
      [oldUserId, email, username, 'test-hash']
    );
    await pool.query('INSERT INTO profiles (user_id, display_name, bio) VALUES ($1, $2, $3)', [oldUserId, 'Old profile', 'old private data']);
    await pool.query(
      `INSERT INTO account_deletion_operations (id, user_id, status, accepted_at, deadline_at)
       VALUES ($1, $2, 'processing', now() - interval '1 day', now() + interval '1 day')`,
      [operationId, oldUserId]
    );
    const requiredSteps = ['discovery', 'notifications', 'moderation', 'content', 'relationships', 'media'];
    for (const [position, stepKey] of requiredSteps.entries()) {
      await pool.query(
        `INSERT INTO account_deletion_steps (operation_id, step_key, position, status, completed_at)
         VALUES ($1, $2, $3, 'completed', now())`,
        [operationId, stepKey, position]
      );
    }
    await pool.query(
      `INSERT INTO account_deletion_steps (operation_id, step_key, position, status, started_at)
       VALUES ($1, 'completion', 6, 'processing', now())`,
      [operationId]
    );
    await pool.query(
      `INSERT INTO account_deletion_permissions (operation_id, scope, token_hash, expires_at)
       VALUES ($1, 'status', $2, now() + interval '1 day')`,
      [operationId, statusHash]
    );
    const completion = createAccountDeletionCompletionService({
      repository: createAccountDeletionCompletionRepository(pool),
      media: {
        async discover() { return { done: true }; },
        async purge() { return { done: true }; },
        async verifyEmpty() { return true; }
      }
    });
    assert.deepEqual(await completion.verifyAndCompleteDeletion(operationId), { done: true });
    await pool.query(
      `UPDATE account_deletion_steps SET status = 'completed', completed_at = now()
       WHERE operation_id = $1 AND step_key = 'completion'`,
      [operationId]
    );
    await pool.query(
      `UPDATE account_deletion_operations SET status = 'completed', completed_at = now()
       WHERE id = $1`,
      [operationId]
    );

    assert.equal(await isSessionRevoked(oldUserId, 0, pool), true, 'a JWT subject with no active account is rejected');
    await pool.query(
      'INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)',
      [newUserId, email, username, 'new-test-hash']
    );
    await pool.query('INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)', [newUserId, username]);

    const profile = await pool.query<{ bio: string | null; polls_count: number }>(
      'SELECT bio, polls_count FROM profiles WHERE user_id = $1', [newUserId]
    );
    const receipt = await pool.query<{ user_id: string; status: string }>(
      'SELECT user_id, status FROM account_deletion_operations WHERE id = $1', [operationId]
    );
    const permission = await pool.query('SELECT id FROM account_deletion_permissions WHERE token_hash = $1', [statusHash]);
    assert.notEqual(newUserId, oldUserId);
    assert.deepEqual(profile.rows[0], { bio: null, polls_count: 0 });
    assert.deepEqual(receipt.rows[0], { user_id: oldUserId, status: 'completed' });
    assert.equal(permission.rowCount, 1);
  } finally {
    await pool.query('DELETE FROM account_deletion_operations WHERE id = $1', [operationId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[oldUserId, newUserId]]);
    await pool.end();
  }
});
