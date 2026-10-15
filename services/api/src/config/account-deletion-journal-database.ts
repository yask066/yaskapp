import pg from 'pg';

import { env } from './env.js';

let journalPool: pg.Pool | undefined;
let retentionPool: pg.Pool | undefined;

function unavailable(): Error & { code: string } {
  return Object.assign(new Error('account_deletion_journal_unavailable'), {
    code: 'account_deletion_journal_unavailable'
  });
}

function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
}

export function getAccountDeletionJournalDatabase(): pg.Pool {
  const connectionString = env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL;
  if (!connectionString) throw unavailable();
  journalPool ??= createPool(connectionString);
  return journalPool;
}

export function getAccountDeletionJournalRetentionDatabase(): pg.Pool {
  const connectionString = env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL;
  if (!connectionString) throw unavailable();
  retentionPool ??= createPool(connectionString);
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
