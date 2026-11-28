import pg from 'pg';

import { env } from './env.js';

export const db = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  query_timeout: 10_000
});

db.on('error', (error) => {
  if (env.NODE_ENV !== 'test') {
    console.error('[db] Unexpected idle client error:', error.message);
  }
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
