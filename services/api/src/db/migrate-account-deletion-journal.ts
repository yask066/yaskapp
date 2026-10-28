import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import type { Pool, PoolClient } from 'pg';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'journal-migrations');
const migrationLockId = 7_450_291_318;
const identityMigrationName = '001_account_deletion_journal.sql';

type MigrationRow = { name: string; checksum: string | null };
type MigrationFile = { name: string; checksum: string; sql: string };

async function listMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(path.join(directory, name), 'utf8');
    return { name, checksum: createHash('sha256').update(sql).digest('hex'), sql };
  }));
}

async function ensureMigrationLedger(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS account_deletion_journal_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT NOT NULL
    )
  `);
}

async function applyMigration(client: PoolClient, migration: MigrationFile, journalId: string) {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    if (migration.name === identityMigrationName) {
      await client.query(
        'INSERT INTO account_deletion_journal_meta (singleton, journal_id) VALUES (TRUE, $1)',
        [journalId]
      );
    }
    await client.query(
      'INSERT INTO account_deletion_journal_migrations (name, checksum) VALUES ($1, $2)',
      [migration.name, migration.checksum]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function assertJournalIdentity(client: PoolClient, journalId: string) {
  const result = await client.query<{ journal_id: string }>(
    'SELECT journal_id FROM account_deletion_journal_meta WHERE singleton = TRUE'
  );
  const storedId = result.rows[0]?.journal_id;
  if (!storedId) throw new Error('account_deletion_journal_identity_missing');
  if (storedId !== journalId) throw new Error('account_deletion_journal_identity_mismatch');
}

export async function runAccountDeletionJournalMigrations(
  pool: Pool,
  options: { migrationsDir: string; journalId: string }
): Promise<void> {
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [migrationLockId]);
    lockAcquired = true;
    await ensureMigrationLedger(client);

    const appliedRows = await client.query<MigrationRow>(
      'SELECT name, checksum FROM account_deletion_journal_migrations ORDER BY name ASC'
    );
    const applied = new Map(appliedRows.rows.map((row) => [row.name, row.checksum]));
    const migrations = await listMigrationFiles(options.migrationsDir);
    if (!migrations.some((migration) => migration.name === identityMigrationName)) {
      throw new Error(`Required journal identity migration ${identityMigrationName} is missing.`);
    }

    for (const migration of migrations) {
      const checksum = applied.get(migration.name);
      if (checksum !== undefined && checksum !== migration.checksum) {
        throw new Error(`Applied journal migration ${migration.name} was modified.`);
      }
    }
    const knownNames = new Set(migrations.map((migration) => migration.name));
    const missingFiles = [...applied.keys()].filter((name) => !knownNames.has(name));
    if (missingFiles.length) {
      throw new Error(`Applied journal migration files are missing: ${missingFiles.join(', ')}`);
    }

    const pending = migrations.filter((migration) => !applied.has(migration.name));
    const identityAlreadyApplied = applied.has(identityMigrationName);
    if (identityAlreadyApplied) await assertJournalIdentity(client, options.journalId);
    for (const migration of pending) {
      await applyMigration(client, migration, options.journalId);
    }
    await assertJournalIdentity(client, options.journalId);
  } finally {
    try {
      if (lockAcquired) await client.query('SELECT pg_advisory_unlock($1::bigint)', [migrationLockId]);
    } finally {
      client.release();
    }
  }
}

async function main() {
  const [{ env }, journalDatabase] = await Promise.all([
    import('../config/env.js'),
    import('../config/account-deletion-journal-database.js')
  ]);
  if (!env.ACCOUNT_DELETION_JOURNAL_ID) {
    throw new Error('ACCOUNT_DELETION_JOURNAL_ID is required to initialize the account deletion journal.');
  }
  await runAccountDeletionJournalMigrations(journalDatabase.getAccountDeletionJournalDatabase(), {
    migrationsDir,
    journalId: env.ACCOUNT_DELETION_JOURNAL_ID
  });
  console.log('Account deletion journal migrations are current.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error('Account deletion journal migration failed.');
    console.error(error instanceof Error ? error.message : 'Unknown migration error.');
    process.exitCode = 1;
  } finally {
    const { closeAccountDeletionJournalDatabase } = await import('../config/account-deletion-journal-database.js');
    await closeAccountDeletionJournalDatabase();
  }
}
