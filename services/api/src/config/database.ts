import pg from 'pg';

import { env } from './env.js';

export const db = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

export type Database = typeof db;

export async function checkDatabaseConnection() {
  const result = await db.query<{ now: Date }>('SELECT now() AS now');

  return {
    connected: true,
    serverTime: result.rows[0]?.now.toISOString()
  };
}

export async function closeDatabaseConnection() {
  await db.end();
}
