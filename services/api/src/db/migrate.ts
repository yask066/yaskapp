import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';

import { closeDatabaseConnection, db } from '../config/database.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

type MigrationRow = {
  name: string;
  checksum: string | null;
};

type MigrationFile = {
  name: string;
  checksum: string;
  sql: string;
};

const migrationLockId = 7_455_291;

async function ensureMigrationsTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT
    );
  `);

  await client.query(`
    ALTER TABLE schema_migrations
      ADD COLUMN IF NOT EXISTS checksum TEXT;
  `);
}

async function getAppliedMigrations(client: PoolClient) {
  const result = await client.query<MigrationRow>(
    'SELECT name, checksum FROM schema_migrations ORDER BY name ASC'
  );

  return new Map(result.rows.map((row) => [row.name, row.checksum]));
}

async function listMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });

  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(migrationsDir, name), 'utf8');
      return {
        name,
        checksum: createHash('sha256').update(sql).digest('hex'),
        sql
      };
    })
  );
}

async function applyMigration(client: PoolClient, migration: MigrationFile) {
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
      [migration.name, migration.checksum]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function migrate() {
  const client = await db.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [migrationLockId]);
    await ensureMigrationsTable(client);

    const appliedMigrations = await getAppliedMigrations(client);
    const migrationFiles = await listMigrationFiles();

    for (const migration of migrationFiles) {
      const appliedChecksum = appliedMigrations.get(migration.name);
      if (appliedChecksum === undefined) {
        continue;
      }

      // Populate checksums for databases created before checksum tracking existed.
      if (appliedChecksum === null) {
        await client.query('UPDATE schema_migrations SET checksum = $1 WHERE name = $2', [
          migration.checksum,
          migration.name
        ]);
        continue;
      }

      if (appliedChecksum !== migration.checksum) {
        throw new Error(
          `Applied migration ${migration.name} was modified. Restore the original file or create a new migration.`
        );
      }
    }

    const knownMigrationNames = new Set(migrationFiles.map((migration) => migration.name));
    const missingFiles = [...appliedMigrations.keys()].filter(
      (name) => !knownMigrationNames.has(name)
    );
    if (missingFiles.length > 0) {
      throw new Error(`Applied migration files are missing: ${missingFiles.join(', ')}`);
    }

    const pendingMigrations = migrationFiles.filter(
      (migration) => !appliedMigrations.has(migration.name)
    );

    if (pendingMigrations.length === 0) {
      console.log('No pending database migrations.');
      return;
    }

    for (const migration of pendingMigrations) {
      console.log(`Applying migration: ${migration.name}`);
      await applyMigration(client, migration);
    }

    console.log(`Applied ${pendingMigrations.length} database migration(s).`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [migrationLockId]);
    client.release();
  }
}

try {
  await migrate();
} catch (error) {
  console.error('Database migration failed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
