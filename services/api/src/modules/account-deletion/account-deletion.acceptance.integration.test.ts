import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PoolClient } from 'pg';

import { InactiveAccountError, lockActiveAccount } from './account-activity.guard.js';

test('lockActiveAccount waits for the user row and rejects a closed account', async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      return { rows: [{ status: 'deleted' }] };
    }
  } as never;

  await assert.rejects(lockActiveAccount(client, 'user-1'), /account_not_active/);
  assert.match(statements[0] ?? '', /SELECT status, deleted_at FROM users WHERE id = \$1 FOR UPDATE/);
});

test('write_started_before_deletion_cannot_commit_after_acceptance', async () => {
  let status = 'active';
  let tail = Promise.resolve();
  let notifyWriter!: () => void;
  let releaseWriter!: () => void;
  let notifyAcceptanceFinished!: () => void;
  const writerStarted = new Promise<void>((resolve) => { notifyWriter = resolve; });
  const continueWriter = new Promise<void>((resolve) => { releaseWriter = resolve; });
  const acceptanceFinished = new Promise<void>((resolve) => { notifyAcceptanceFinished = resolve; });

  function createTransactionClient() {
    let releaseRowLock: (() => void) | undefined;
    return {
      async query(sql: string): Promise<{ rows: { status: string; deleted_at: Date | null }[] }> {
        if (sql === 'BEGIN') return { rows: [] };
        if (sql.includes('SELECT status, deleted_at FROM users')) {
          const previous = tail;
          let unlock!: () => void;
          tail = new Promise<void>((resolve) => { unlock = resolve; });
          await previous;
          releaseRowLock = unlock;
          return { rows: [{ status, deleted_at: status === 'deleted' ? new Date() : null }] };
        }
        if (sql.startsWith("UPDATE users SET status = 'deleted'")) status = 'deleted';
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          releaseRowLock?.();
          releaseRowLock = undefined;
        }
        return { rows: [] };
      }
    };
  }

  const writer = (async () => {
    const client = createTransactionClient() as unknown as PoolClient;
    await client.query('BEGIN');
    await lockActiveAccount(client, 'user-1');
    notifyWriter();
    await continueWriter;
    await client.query('COMMIT');
  })();
  await writerStarted;
  const acceptance = (async () => {
    const client = createTransactionClient() as unknown as PoolClient;
    await client.query('BEGIN');
    await lockActiveAccount(client, 'user-1');
    await client.query("UPDATE users SET status = 'deleted' WHERE id = $1");
    await client.query('COMMIT');
    notifyAcceptanceFinished();
  })();
  await new Promise((resolve) => setImmediate(resolve));
  let finishedWhileWriterHeld = false;
  void acceptanceFinished.then(() => { finishedWhileWriterHeld = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finishedWhileWriterHeld, false);

  releaseWriter();
  await Promise.all([writer, acceptance]);
  const lateWrite = createTransactionClient() as unknown as PoolClient;
  await lateWrite.query('BEGIN');
  await assert.rejects(lockActiveAccount(lateWrite, 'user-1'), InactiveAccountError);
  await lateWrite.query('ROLLBACK');
});

test('upload_finalize_after_close_is_rejected', async () => {
  let finalized = false;
  const client = {
    async query() { return { rows: [{ status: 'deleted', deleted_at: new Date() }] }; }
  } as never;

  await assert.rejects(async () => {
    await lockActiveAccount(client, 'user-1');
    finalized = true;
  }, InactiveAccountError);
  assert.equal(finalized, false);
});

