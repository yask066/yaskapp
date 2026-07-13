import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, closeDatabaseConnection } from '../config/database.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

type MigrationRow = {
  name: string;
};

async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations() {
  const result = await db.query<MigrationRow>(
    'SELECT name FROM schema_migrations ORDER BY name ASC'
  );

  return new Set(result.rows.map((row) => row.name));
}

async function listMigrationFiles() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function applyMigration(fileName: string) {
  const filePath = path.join(migrationsDir, fileName);
  const sql = await readFile(filePath, 'utf8');
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [fileName]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function migrate() {
  await ensureMigrationsTable();

  const appliedMigrations = await getAppliedMigrations();
  const migrationFiles = await listMigrationFiles();
  const pendingMigrations = migrationFiles.filter((fileName) => !appliedMigrations.has(fileName));

  if (pendingMigrations.length === 0) {
    console.log('No pending database migrations.');
    return;
  }

  for (const fileName of pendingMigrations) {
    console.log(`Applying migration: ${fileName}`);
    await applyMigration(fileName);
  }

  console.log(`Applied ${pendingMigrations.length} database migration(s).`);
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
