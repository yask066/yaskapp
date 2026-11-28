import pg from 'pg';

import { env } from './env.js';

let journalPool: pg.Pool | undefined;
let retentionPool: pg.Pool | undefined;

function unavailable(): Error & { code: string } {
  return Object.assign(new Error('account_deletion_journal_unavailable'), {
    code: 'account_deletion_journal_unavailable'
  });
}

function createPool(connectionString: string, label: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 5_000
  });
  pool.on('error', (error) => {
    if (env.NODE_ENV !== 'test') {
      console.error(`[${label}] Unexpected idle client error:`, error.message);
    }
  });
  return pool;
}

export function getAccountDeletionJournalDatabase(): pg.Pool {
  const connectionString = env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL;
  if (!connectionString) throw unavailable();
  journalPool ??= createPool(connectionString, 'account-deletion-journal-db');
  return journalPool;
}

export function getAccountDeletionJournalRetentionDatabase(): pg.Pool {
  const connectionString = env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL;
  if (!connectionString) throw unavailable();
  retentionPool ??= createPool(connectionString, 'account-deletion-journal-retention-db');
  return retentionPool;
}

export async function checkAccountDeletionJournalDatabase(): Promise<{
  connected: true;
  serverTime: string;
}> {
  const result = await getAccountDeletionJournalDatabase().query<{ server_time: Date | string }>(
    'SELECT now() AS server_time'
  );
  const serverTime = result.rows[0]?.server_time;
  if (!serverTime) throw unavailable();
  return {
    connected: true,
    serverTime: serverTime instanceof Date ? serverTime.toISOString() : new Date(serverTime).toISOString()
  };
}

export async function closeAccountDeletionJournalDatabase(): Promise<void> {
  const pools = [journalPool, retentionPool].filter((pool): pool is pg.Pool => Boolean(pool));
  journalPool = undefined;
  retentionPool = undefined;
  await Promise.all(pools.map((pool) => pool.end()));
}
