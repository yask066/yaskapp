import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, test } from 'node:test';
import type { PoolClient } from 'pg';

process.env.NODE_ENV = 'test';

const { db, closeDatabaseConnection } = await import('../../config/database.js');
after(closeDatabaseConnection);

// Each case rolls back its fixtures, including DDL, on the dedicated test DB.
async function inTransaction(run: (client: PoolClient) => Promise<void>) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await run(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function createUser(client: PoolClient) {
  const id = randomUUID();
  await client.query(
    'INSERT INTO users (id, email, username, password_hash) VALUES ($1, $2, $3, $4)',
    [id, `${id}@yaskapp.test`, `ad_${id.slice(0, 12).replaceAll('-', '_')}`, 'test-only-hash']
  );
  return id;
}

function permissionInput(userId: string) {
  return {
    userId,
    deletionTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
    statusTokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
    deletionTokenExpiresAt: new Date(Date.now() + 10 * 60_000),
    statusTokenExpiresAt: new Date(Date.now() + 48 * 60 * 60_000)
  };
}

test('operation_survives_user_delete', async () => {
  const repository = await import('./account-deletion.repository.js');
  await inTransaction(async (client) => {
    const userId = await createUser(client);
    const input = permissionInput(userId);
    const prepared = await repository.prepareDeletionOperation(input, client);
    const acceptance = {
      operationId: prepared.operationId,
      userId,
      acceptedAt: new Date('2026-10-12T10:15:00.000Z'),
      deadlineAt: new Date('2026-10-13T10:15:00.000Z')
    };
    const accepted = await repository.acceptDeletionOperation(acceptance, client);
    await client.query('INSERT INTO account_deletion_steps (operation_id, step_key, position) VALUES ($1, $2, 0)', [prepared.operationId, 'content']);
    await client.query('INSERT INTO account_deletion_events (operation_id, event_key) VALUES ($1, $2)', [prepared.operationId, 'access_revoked']);
    await client.query('INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key) VALUES ($1, $2, $3)', [prepared.operationId, userId, `avatars/${userId}/avatar.webp`]);

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    assert.deepEqual(await repository.getDeletionOperation(prepared.operationId, client), {
      operationId: prepared.operationId,
      status: 'pending',
      acceptedAt: '2026-10-12T10:15:00.000Z',
      deadlineAt: '2026-10-13T10:15:00.000Z',
      completedAt: null
    });
    assert.deepEqual(await repository.acceptDeletionOperation(acceptance, client), accepted);
    for (const scope of ['delete', 'status'] as const) {
      const hash = scope === 'delete' ? input.deletionTokenHash : input.statusTokenHash;
      const permission = await repository.getDeletionPermission(hash, scope, client);
      assert.equal(permission?.operationId, prepared.operationId);
      assert.equal(permission?.userId, userId);
    }
    for (const table of ['account_deletion_operations', 'account_deletion_steps', 'account_deletion_events', 'account_deletion_media_manifest']) {
      const result = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${table === 'account_deletion_operations' ? 'user_id' : 'operation_id'} = $1`, [table === 'account_deletion_operations' ? userId : prepared.operationId]);
      assert.equal(result.rows[0].count, 1, `${table} must survive user deletion`);
    }
  });
});

test('prepared_status_is_private_and_new_verification_revokes_old_permissions', async () => {
  const repository = await import('./account-deletion.repository.js');
  await inTransaction(async (client) => {
    const userId = await createUser(client);
    const oldInput = permissionInput(userId);
    const oldOperation = await repository.prepareDeletionOperation(oldInput, client);
    const input = permissionInput(userId);
    const prepared = await repository.prepareDeletionOperation(input, client);
    assert.notEqual(prepared.operationId, oldOperation.operationId);
    assert.deepEqual(prepared, {
      operationId: prepared.operationId, status: 'not_started',
      acceptedAt: null, deadlineAt: null, completedAt: null
    });
    assert.equal(await repository.getDeletionPermission(oldInput.deletionTokenHash, 'delete', client), null);
    assert.equal(await repository.getDeletionPermission(oldInput.statusTokenHash, 'status', client), null);
    assert.equal(await repository.getDeletionPermission(input.statusTokenHash, 'delete', client), null);
    assert.equal(await repository.getDeletionOperation(randomUUID(), client), null);
    const hashes = await client.query('SELECT token_hash FROM account_deletion_permissions WHERE operation_id = $1 ORDER BY scope', [prepared.operationId]);
    assert.deepEqual(hashes.rows, [{ token_hash: input.deletionTokenHash }, { token_hash: input.statusTokenHash }]);
  });
});

test('accepted_operation_is_reused_and_wrong_owner_cannot_accept', async () => {
  const repository = await import('./account-deletion.repository.js');
  await inTransaction(async (client) => {
    const userId = await createUser(client);
    const prepared = await repository.prepareDeletionOperation(permissionInput(userId), client);
    const input = { operationId: prepared.operationId, userId, acceptedAt: new Date(), deadlineAt: new Date(Date.now() + 86_400_000) };
    assert.equal(await repository.acceptDeletionOperation({ ...input, userId: randomUUID() }, client), null);
    const accepted = await repository.acceptDeletionOperation(input, client);
    assert.deepEqual(await repository.prepareDeletionOperation(permissionInput(userId), client), accepted);
    assert.deepEqual(await repository.acceptDeletionOperation({ ...input, acceptedAt: new Date('2030-01-01'), deadlineAt: new Date('2030-01-02') }, client), accepted);
  });
});

test('expired_and_revoked_permissions_are_rejected_but_consumed_delete_token_supports_replay', async () => {
  const repository = await import('./account-deletion.repository.js');
  await inTransaction(async (client) => {
    const input = permissionInput(await createUser(client));
    const prepared = await repository.prepareDeletionOperation(input, client);
    await client.query("UPDATE account_deletion_permissions SET consumed_at = now() WHERE operation_id = $1 AND scope = 'delete'", [prepared.operationId]);
    assert.ok(await repository.getDeletionPermission(input.deletionTokenHash, 'delete', client));
    await client.query("UPDATE account_deletion_permissions SET revoked_at = now() WHERE operation_id = $1 AND scope = 'delete'", [prepared.operationId]);
    assert.equal(await repository.getDeletionPermission(input.deletionTokenHash, 'delete', client), null);
    await client.query("UPDATE account_deletion_permissions SET expires_at = now() WHERE operation_id = $1 AND scope = 'status'", [prepared.operationId]);
    assert.equal(await repository.getDeletionPermission(input.statusTokenHash, 'status', client), null);
  });
});

test('migration_is_repeatable_and_manifest_is_operation_owner_scoped', async () => {
  const sql = await readFile(new URL('../../db/migrations/028_account_deletion_operations.sql', import.meta.url), 'utf8');
  await inTransaction(async (client) => {
    await client.query(sql);
    await client.query(sql);
    const repository = await import('./account-deletion.repository.js');
    const userId = await createUser(client);
    const operation = await repository.prepareDeletionOperation(permissionInput(userId), client);
    await client.query('SAVEPOINT wrong_owner');
    await assert.rejects(client.query('INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key) VALUES ($1, $2, $3)', [operation.operationId, randomUUID(), 'private/file.webp']), { code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT wrong_owner');
    await client.query('INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [operation.operationId, userId, `avatars/${userId}/avatar.webp`]);
    await client.query('INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [operation.operationId, userId, `avatars/${userId}/avatar.webp`]);
    const rows = await client.query('SELECT count(*)::int AS count FROM account_deletion_media_manifest WHERE operation_id = $1', [operation.operationId]);
    assert.equal(rows.rows[0].count, 1);
  });
});

test('database_prevents_duplicate_unfinished_acceptance_and_unsafe_permission_values', async () => {
  const repository = await import('./account-deletion.repository.js');
  await inTransaction(async (client) => {
    const userId = await createUser(client);
    const first = await repository.prepareDeletionOperation(permissionInput(userId), client);
    await repository.acceptDeletionOperation({ operationId: first.operationId, userId, acceptedAt: new Date(), deadlineAt: new Date(Date.now() + 86_400_000) }, client);
    await client.query('SAVEPOINT duplicate');
    await assert.rejects(client.query("INSERT INTO account_deletion_operations (user_id, status, accepted_at, deadline_at) VALUES ($1, 'pending', now(), now() + interval '1 day')", [userId]), { code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT duplicate');
    await client.query('SAVEPOINT raw_token');
    await assert.rejects(client.query("INSERT INTO account_deletion_permissions (operation_id, scope, token_hash, expires_at) VALUES ($1, 'status', 'raw-secret', now() + interval '2 days')", [first.operationId]), { code: '23514' });
    await client.query('ROLLBACK TO SAVEPOINT raw_token');
  });
});

test('status_dates_follow_worker_progress_and_do_not_expose_internal_records', async () => {
  const repository = await import('./account-deletion.repository.js');
  await inTransaction(async (client) => {
    const userId = await createUser(client);
    const operation = await repository.prepareDeletionOperation(permissionInput(userId), client);
    await repository.acceptDeletionOperation({
      operationId: operation.operationId, userId,
      acceptedAt: new Date('2026-10-12T10:15:00Z'), deadlineAt: new Date('2026-10-13T10:15:00Z')
    }, client);
    for (const status of ['processing', 'retrying', 'completed'] as const) {
      await client.query(
        `UPDATE account_deletion_operations SET status = $2, attempts = 2,
         last_error_code = 'storage_unavailable', completed_at = $3 WHERE id = $1`,
        [operation.operationId, status, status === 'completed' ? new Date('2026-10-12T11:15:00Z') : null]
      );
      assert.deepEqual(await repository.getDeletionOperation(operation.operationId, client), {
        operationId: operation.operationId, status,
        acceptedAt: '2026-10-12T10:15:00.000Z', deadlineAt: '2026-10-13T10:15:00.000Z',
        completedAt: status === 'completed' ? '2026-10-12T11:15:00.000Z' : null
      });
    }
  });
});

test('outbox_events_are_visible_only_after_commit_and_rollback_removes_preparation', async () => {
  const repository = await import('./account-deletion.repository.js');
  const client = await db.connect();
  let operationId: string | undefined;
  let userId: string | undefined;
  try {
    await client.query('BEGIN');
    userId = await createUser(client);
    const prepared = await repository.prepareDeletionOperation(permissionInput(userId), client);
    operationId = prepared.operationId;
    await client.query("INSERT INTO account_deletion_events (operation_id, event_key) VALUES ($1, 'access_revoked')", [operationId]);
    assert.equal((await db.query('SELECT id FROM account_deletion_events WHERE operation_id = $1', [operationId])).rowCount, 0);
    await client.query('COMMIT');
    assert.equal((await db.query('SELECT id FROM account_deletion_events WHERE operation_id = $1', [operationId])).rowCount, 1);

    await client.query('BEGIN');
    const replacement = await repository.prepareDeletionOperation(permissionInput(userId), client);
    await client.query('ROLLBACK');
    assert.equal(await repository.getDeletionOperation(replacement.operationId), null);
    assert.equal((await repository.getDeletionOperation(operationId))?.status, 'not_started');
  } finally {
    await client.query('ROLLBACK');
    if (operationId) await client.query('DELETE FROM account_deletion_operations WHERE id = $1', [operationId]);
    if (userId) await client.query('DELETE FROM users WHERE id = $1', [userId]);
    client.release();
  }
});
