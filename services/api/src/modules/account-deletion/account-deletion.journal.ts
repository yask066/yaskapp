import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';

export type AccountDeletionJournalAcceptance = {
  operationId: string;
  userId: string;
  acceptedAt: Date;
  deadlineAt: Date;
};

export type AccountDeletionJournalEntry = {
  version: 1;
  state: 'prepared' | 'accepted';
  operationId: string;
  intentId: string;
  userId: string;
  acceptedAt: string;
  deadlineAt: string;
  hmac: string;
};

const JOURNAL_ENTRY_SELECT = `SELECT operation_id, intent_id, user_id, state, accepted_at, deadline_at, payload, hmac
  FROM account_deletion_journal_entries`;

function journalPayload(entry: Omit<AccountDeletionJournalEntry, 'hmac'>) {
  return JSON.stringify({
    version: entry.version,
    state: entry.state,
    operationId: entry.operationId,
    intentId: entry.intentId,
    userId: entry.userId,
    acceptedAt: entry.acceptedAt,
    deadlineAt: entry.deadlineAt
  });
}

export function createJournalEntry(
  acceptance: AccountDeletionJournalAcceptance,
  signingKey: string,
  state: AccountDeletionJournalEntry['state'] = 'accepted'
): AccountDeletionJournalEntry {
  if (signingKey.length < 32) throw new Error('account_deletion_journal_hmac_key_too_short');
  const entry = {
    version: 1 as const,
    state,
    operationId: acceptance.operationId,
    intentId: createHash('sha256').update(`${acceptance.operationId}\n${acceptance.acceptedAt.toISOString()}`).digest('hex'),
    userId: acceptance.userId,
    acceptedAt: acceptance.acceptedAt.toISOString(),
    deadlineAt: acceptance.deadlineAt.toISOString()
  };
  return { ...entry, hmac: createHmac('sha256', signingKey).update(journalPayload(entry)).digest('hex') };
}

export function verifyJournalEntry(value: unknown, signingKey: string): value is AccountDeletionJournalEntry {
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'acceptedAt,deadlineAt,hmac,intentId,operationId,state,userId,version') return false;
  if (signingKey.length < 32) return false;
  const entry = value as Partial<AccountDeletionJournalEntry>;
  if (
    entry.version !== 1 ||
    (entry.state !== 'prepared' && entry.state !== 'accepted') ||
    typeof entry.operationId !== 'string' ||
    typeof entry.intentId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(entry.intentId) ||
    typeof entry.userId !== 'string' ||
    typeof entry.acceptedAt !== 'string' ||
    typeof entry.deadlineAt !== 'string' ||
    typeof entry.hmac !== 'string' ||
    !Number.isFinite(Date.parse(entry.acceptedAt)) ||
    !Number.isFinite(Date.parse(entry.deadlineAt)) ||
    Date.parse(entry.deadlineAt) < Date.parse(entry.acceptedAt)
  ) return false;
  if (!/^[a-f0-9]{64}$/.test(entry.hmac)) return false;
  if (entry.intentId !== createHash('sha256').update(`${entry.operationId}\n${entry.acceptedAt}`).digest('hex')) return false;

  const unsigned = {
    version: entry.version,
    state: entry.state,
    operationId: entry.operationId,
    intentId: entry.intentId,
    userId: entry.userId,
    acceptedAt: entry.acceptedAt,
    deadlineAt: entry.deadlineAt
  };
  const expected = createHmac('sha256', signingKey).update(journalPayload(unsigned)).digest();
  const actual = Buffer.from(entry.hmac, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

type JournalRow = {
  operation_id: string;
  intent_id: string;
  user_id: string;
  state: string;
  accepted_at: Date | string;
  deadline_at: Date | string;
  payload: unknown;
  hmac: string;
};

export type AccountDeletionJournal = {
  initialize(): Promise<void>;
  assertReady(): Promise<void>;
  writePrepared(acceptance: AccountDeletionJournalAcceptance): Promise<void>;
  writeAccepted(acceptance: AccountDeletionJournalAcceptance): Promise<void>;
  deletePrepared(operationId: string): Promise<void>;
  deletePreparedIntent(operationId: string, intentId: string): Promise<void>;
  deleteAccepted(operationId: string): Promise<void>;
  cleanupStalePrepared(now: Date): Promise<number>;
  readAll(): Promise<AccountDeletionJournalEntry[]>;
  close(): void;
};

export function createAccountDeletionJournal(options: {
  database: Pick<Pool, 'query' | 'connect'>;
  signingKey: string;
  journalId: string;
}): AccountDeletionJournal {
  if (options.signingKey.length < 32) throw new Error('account_deletion_journal_hmac_key_too_short');
  let closed = false;

  function parseRow(row: JournalRow): AccountDeletionJournalEntry {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) as unknown : row.payload;
    if (!verifyJournalEntry(payload, options.signingKey)) {
      throw new Error('account_deletion_journal_integrity_failed');
    }
    const entry = payload;
    if (
      row.state !== entry.state || row.operation_id !== entry.operationId || row.intent_id !== entry.intentId ||
      row.user_id !== entry.userId || dateIso(row.accepted_at) !== entry.acceptedAt ||
      dateIso(row.deadline_at) !== entry.deadlineAt || row.hmac !== entry.hmac
    ) throw new Error('account_deletion_journal_integrity_failed');
    return entry;
  }

  function dateIso(value: Date | string) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toISOString();
  }

  async function rowsForOperation(operationId: string) {
    const result = await options.database.query<JournalRow>(
      `${JOURNAL_ENTRY_SELECT} WHERE operation_id = $1 ORDER BY state, intent_id`, [operationId]
    );
    return result.rows.map(parseRow);
  }

  async function insert(entry: AccountDeletionJournalEntry) {
    const existing = await rowsForOperation(entry.operationId);
    if (entry.state === 'prepared' && existing.some((candidate) => !sameAcceptance(candidate, { ...entry, state: candidate.state }))) {
      throw new Error('account_deletion_journal_conflict');
    }
    if (entry.state === 'accepted') {
      const prepared = existing.filter((candidate) => candidate.state === 'prepared' && candidate.intentId === entry.intentId);
      if (!prepared.some((candidate) => sameAcceptance(candidate, { ...entry, state: 'prepared' }))) {
        throw new Error(existing.some((candidate) => candidate.state === 'prepared')
          ? 'account_deletion_journal_conflict'
          : 'account_deletion_journal_incomplete');
      }
      if (existing.some((candidate) => candidate.state === 'accepted' && candidate.intentId !== entry.intentId)) {
        throw new Error('account_deletion_journal_conflict');
      }
    }
    await options.database.query(
      `INSERT INTO account_deletion_journal_entries
        (operation_id, intent_id, user_id, state, accepted_at, deadline_at, payload, hmac)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::jsonb, $8)
       ON CONFLICT DO NOTHING`,
      [entry.operationId, entry.intentId, entry.userId, entry.state, entry.acceptedAt, entry.deadlineAt, JSON.stringify(entry), entry.hmac]
    );
    const stored = await rowsForOperation(entry.operationId);
    const matches = stored.filter((candidate) => candidate.state === entry.state && candidate.intentId === entry.intentId);
    if (matches.length !== 1 || journalPayload(matches[0]) !== journalPayload(entry) || matches[0].hmac !== entry.hmac) {
      throw new Error('account_deletion_journal_conflict');
    }
    if (entry.state === 'accepted') {
      const prepared = stored.filter((candidate) => candidate.state === 'prepared' && candidate.intentId === entry.intentId);
      if (prepared.length !== 1 || !sameAcceptance(prepared[0], { ...entry, state: 'prepared' })) {
        throw new Error('account_deletion_journal_incomplete');
      }
    }
    if (stored.filter((candidate) => candidate.state === 'accepted').length > 1) {
      throw new Error('account_deletion_journal_conflict');
    }
  }

  async function readAll(): Promise<AccountDeletionJournalEntry[]> {
    await assertReady();
    const result = await options.database.query<JournalRow>(`${JOURNAL_ENTRY_SELECT} ORDER BY operation_id, state, intent_id`);
    const entries = result.rows.map(parseRow);
    const prepared = new Map<string, AccountDeletionJournalEntry>();
    const acceptedByOperation = new Map<string, AccountDeletionJournalEntry>();
    const identityByStateAndOperation = new Map<string, string>();
    for (const entry of entries) {
      const operationStateKey = `${entry.state}:${entry.operationId}`;
      const knownIntent = identityByStateAndOperation.get(operationStateKey);
      if (entry.state === 'accepted' && knownIntent && knownIntent !== entry.intentId) {
        throw new Error('account_deletion_journal_conflict');
      }
      identityByStateAndOperation.set(operationStateKey, entry.intentId);
      if (entry.state === 'prepared') {
        const key = `${entry.operationId}:${entry.intentId}`;
        if (prepared.has(key)) throw new Error('account_deletion_journal_conflict');
        prepared.set(key, entry);
      } else {
        if (acceptedByOperation.has(entry.operationId)) throw new Error('account_deletion_journal_conflict');
        acceptedByOperation.set(entry.operationId, entry);
      }
    }
    for (const accepted of acceptedByOperation.values()) {
      const intent = prepared.get(`${accepted.operationId}:${accepted.intentId}`);
      if (!intent || !sameAcceptance(intent, accepted)) throw new Error('account_deletion_journal_incomplete');
    }
    for (const intent of prepared.values()) {
      const accepted = acceptedByOperation.get(intent.operationId);
      if (!accepted || !sameAcceptance(intent, { ...accepted, state: 'prepared' })) {
        throw new Error('account_deletion_journal_incomplete');
      }
    }
    return [...acceptedByOperation.values()];
  }

  async function assertReady() {
    const result = await options.database.query<{ journal_id: string }>(
      'SELECT journal_id FROM account_deletion_journal_meta WHERE singleton = TRUE'
    );
    const storedId = result.rows[0]?.journal_id;
    if (!storedId) throw new Error('account_deletion_journal_identity_missing');
    if (storedId !== options.journalId) throw new Error('account_deletion_journal_identity_mismatch');
  }

  return {
    async initialize() {
      if (!options.journalId) throw new Error('account_deletion_journal_configuration_invalid');
      await assertReady();
    },
    assertReady,
    async writePrepared(acceptance) {
      await assertReady();
      await insert(createJournalEntry(acceptance, options.signingKey, 'prepared'));
    },
    async writeAccepted(acceptance) {
      await assertReady();
      await insert(createJournalEntry(acceptance, options.signingKey, 'accepted'));
    },
    async deletePrepared(operationId) {
      await options.database.query(
        "DELETE FROM account_deletion_journal_entries WHERE operation_id = $1 AND state = 'prepared'", [operationId]
      );
    },
    async deletePreparedIntent(operationId, intentId) {
      await options.database.query(
        "DELETE FROM account_deletion_journal_entries WHERE operation_id = $1 AND intent_id = $2 AND state = 'prepared'", [operationId, intentId]
      );
    },
    async deleteAccepted(operationId) {
      await options.database.query('DELETE FROM account_deletion_journal_entries WHERE operation_id = $1', [operationId]);
    },
    async cleanupStalePrepared(now) {
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('account_deletion_journal_invalid_cleanup_time');
      await readAll();
      return 0;
    },
    readAll,
    close() {
      if (closed) return;
      closed = true;
      const database = options.database as Pick<Pool, 'query' | 'connect'> & { end?: () => Promise<void> };
      if (typeof database.end === 'function') void database.end();
    }
  };
}

function sameAcceptance(left: AccountDeletionJournalEntry, right: AccountDeletionJournalEntry) {
  return left.operationId === right.operationId && left.intentId === right.intentId && left.userId === right.userId &&
    left.acceptedAt === right.acceptedAt && left.deadlineAt === right.deadlineAt;
}

async function configuredJournal(options: { retention?: boolean } = {}): Promise<AccountDeletionJournal> {
  const signingKey = process.env.ACCOUNT_DELETION_JOURNAL_HMAC_KEY;
  const journalId = process.env.ACCOUNT_DELETION_JOURNAL_ID;
  if (!signingKey || !journalId) throw new Error('account_deletion_journal_unavailable');
  const databaseConfig = await import('../../config/account-deletion-journal-database.js');
  const database = options.retention
    ? databaseConfig.getAccountDeletionJournalRetentionDatabase()
    : databaseConfig.getAccountDeletionJournalDatabase();
  return createAccountDeletionJournal({ database, signingKey, journalId });
}

async function withConfiguredJournal<T>(run: (journal: AccountDeletionJournal) => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return undefined as T;
  return run(await configuredJournal());
}

export async function initializeAccountDeletionJournal() {
  return withConfiguredJournal((journal) => journal.initialize());
}

export async function assertAccountDeletionJournalReady() {
  const journal = await configuredJournal();
  await journal.assertReady();
}

export async function prepareDeletionInJournal(acceptance: AccountDeletionJournalAcceptance) {
  return withConfiguredJournal(async (journal) => {
    await journal.assertReady();
    await journal.writePrepared(acceptance);
  });
}

export async function acceptDeletionInJournal(acceptance: AccountDeletionJournalAcceptance) {
  return withConfiguredJournal(async (journal) => {
    await journal.assertReady();
    await journal.writePrepared(acceptance);
    await journal.writeAccepted(acceptance);
  });
}

export async function writeAcceptedDeletionToJournal(acceptance: AccountDeletionJournalAcceptance) {
  return acceptDeletionInJournal(acceptance);
}

export async function readAcceptedDeletionsFromJournal() {
  const journal = await configuredJournal();
  return journal.readAll();
}

export async function exportAcceptedDeletionsToJournal(executor: {
  query<T>(sql: string): Promise<{ rows: T[] }>;
}) {
  const cleanup = await cleanupExpiredCompletedDeletionJournal(executor);
  const accepted = await executor.query<{
    id: string;
    user_id: string;
    accepted_at: Date;
    deadline_at: Date;
  }>(`SELECT id, user_id, accepted_at, deadline_at FROM account_deletion_operations
      WHERE accepted_at IS NOT NULL AND deadline_at IS NOT NULL
        AND (status <> 'completed' OR accepted_at > now() - interval '35 days')
      ORDER BY accepted_at, id`);
  for (const row of accepted.rows) {
    await acceptDeletionInJournal({
      operationId: row.id,
      userId: row.user_id,
      acceptedAt: new Date(row.accepted_at),
      deadlineAt: new Date(row.deadline_at)
    });
  }
  const journalEntries = await readAcceptedDeletionsFromJournal();
  const journalById = new Map(journalEntries.map((entry) => [entry.operationId, entry]));
  for (const row of accepted.rows) {
    const entry = journalById.get(row.id);
    if (!entry || entry.userId !== row.user_id || entry.acceptedAt !== new Date(row.accepted_at).toISOString() ||
        entry.deadlineAt !== new Date(row.deadline_at).toISOString()) {
      throw new Error('account_deletion_journal_export_incomplete');
    }
  }
  return { exported: accepted.rows.length, journalEntries: journalEntries.length, cleaned: cleanup.deleted };
}

export async function cleanupExpiredCompletedDeletionJournal(
  executor: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> },
  now = new Date()
) {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return { deleted: 0 };
  const completed = await executor.query<{ id: string }>(
    `SELECT id FROM account_deletion_operations
     WHERE status = 'completed' AND accepted_at <= $1::timestamptz - interval '35 days'`, [now]
  );
  const prepared = await executor.query<{ id: string }>(
    `SELECT operation.id FROM account_deletion_operations operation
     WHERE operation.status = 'not_started' AND NOT EXISTS (
       SELECT 1 FROM account_deletion_permissions permission
       WHERE permission.operation_id = operation.id AND permission.expires_at > $1
     )`, [now]
  );
  if (!completed.rows.length && !prepared.rows.length && !process.env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL) {
    return { deleted: 0 };
  }

  const journal = await configuredJournal({ retention: true });
  await journal.cleanupStalePrepared(now);
  for (const operation of completed.rows) await journal.deleteAccepted(operation.id);
  return { deleted: completed.rows.length };
}
