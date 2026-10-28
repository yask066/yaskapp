import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Pool, QueryResult } from 'pg';

import { runAccountDeletionJournalMigrations } from './migrate-account-deletion-journal.js';

type QueryCall = { text: string; values?: unknown[] };

function createFakePool(applied: Map<string, string | null> = new Map()) {
  const calls: QueryCall[] = [];
  let journalId: string | undefined;
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (text.includes('SELECT name, checksum FROM account_deletion_journal_migrations')) {
        return { rows: [...applied].map(([name, checksum]) => ({ name, checksum })) };
      }
      if (text.includes('SELECT journal_id FROM account_deletion_journal_meta')) {
        return { rows: journalId ? [{ journal_id: journalId }] : [] };
      }
      if (text.includes('INSERT INTO account_deletion_journal_meta')) {
        journalId = String(values?.[0]);
      }
      if (text.includes('INSERT INTO account_deletion_journal_migrations')) {
        applied.set(String(values?.[0]), String(values?.[1]));
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } } as unknown as Pool;
  return { pool, calls, applied };
}

async function withMigrations(files: Record<string, string>, run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'account-deletion-journal-migrations-'));
  try {
    await mkdir(directory, { recursive: true });
    await Promise.all(Object.entries(files).map(([name, sql]) => writeFile(path.join(directory, name), sql)));
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('journal_migrations_apply_in_order_with_checksums', async () => {
  await withMigrations({ '002_second.sql': 'SELECT 2;', '001_account_deletion_journal.sql': 'SELECT 1;' }, async (directory) => {
    const fake = createFakePool();
    await runAccountDeletionJournalMigrations(fake.pool, { migrationsDir: directory, journalId: 'journal-test' });

    const inserts = fake.calls.filter((call) => call.text.includes('INSERT INTO account_deletion_journal_migrations'));
    assert.deepEqual(inserts.map((call) => call.values?.[0]), ['001_account_deletion_journal.sql', '002_second.sql']);
    assert.deepEqual(inserts.map((call) => call.values?.[1]), [
      createHash('sha256').update('SELECT 1;').digest('hex'),
      createHash('sha256').update('SELECT 2;').digest('hex')
    ]);
  });
});

test('modified_applied_journal_migration_fails', async () => {
  await withMigrations({ '001_account_deletion_journal.sql': 'SELECT changed;' }, async (directory) => {
    const fake = createFakePool(new Map([['001_account_deletion_journal.sql', 'old-checksum']]));

    await assert.rejects(
      runAccountDeletionJournalMigrations(fake.pool, { migrationsDir: directory, journalId: 'journal-test' }),
      /Applied journal migration 001_account_deletion_journal\.sql was modified/
    );
    assert.equal(fake.calls.some((call) => call.text === 'COMMIT'), false);
  });
});

test('failed_journal_migration_rolls_back', async () => {
  await withMigrations({ '001_account_deletion_journal.sql': 'FAIL;' }, async (directory) => {
    const calls: QueryCall[] = [];
    const client = {
      async query(text: string, values?: unknown[]): Promise<QueryResult> {
        calls.push({ text, values });
        if (text === 'FAIL;') throw new Error('migration SQL failed');
        if (text.includes('SELECT name, checksum FROM account_deletion_journal_migrations')) return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
        return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
      },
      release() {}
    };
    const pool = { async connect() { return client; } } as unknown as Pool;

    await assert.rejects(
      runAccountDeletionJournalMigrations(pool, { migrationsDir: directory, journalId: 'journal-test' }),
      /migration SQL failed/
    );
    assert.ok(calls.some((call) => call.text === 'ROLLBACK'));
    assert.equal(calls.some((call) => call.text.includes('INSERT INTO account_deletion_journal_migrations')), false);
  });
});
