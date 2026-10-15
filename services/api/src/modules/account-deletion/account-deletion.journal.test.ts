import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { createAccountDeletionJournal, createJournalEntry, verifyJournalEntry } from './account-deletion.journal.js';

const signingKey = 'test-key-at-least-32-characters-long';
const acceptance = {
  operationId: 'e15d4d2b-5358-45a7-b036-f3648d34b361',
  userId: '3ce3e770-fd0e-4e98-8472-0541d3e27cf1',
  acceptedAt: new Date('2026-10-12T12:00:00.000Z'),
  deadlineAt: new Date('2026-10-13T12:00:00.000Z')
};

type StoredRow = {
  operation_id: string;
  intent_id: string;
  user_id: string;
  state: string;
  accepted_at: Date;
  deadline_at: Date;
  payload: unknown;
  hmac: string;
};

function fakeDatabase(options: { journalId?: string } = {}) {
  const rows: StoredRow[] = [];
  let closeCount = 0;
  const query = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => {
    if (sql.includes('SELECT journal_id FROM account_deletion_journal_meta')) {
      return { rows: options.journalId ? [{ journal_id: options.journalId } as T] : [], rowCount: options.journalId ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO account_deletion_journal_entries')) {
      const [operationId, intentId, userId, state, acceptedAt, deadlineAt, payload, hmac] = values;
      const duplicate = rows.some((row) => row.state === state && row.operation_id === operationId && row.intent_id === intentId);
      const acceptedConflict = state === 'accepted' && rows.some((row) => row.state === 'accepted' && row.operation_id === operationId);
      if (!duplicate && !acceptedConflict) rows.push({
        operation_id: String(operationId), intent_id: String(intentId), user_id: String(userId), state: String(state),
        accepted_at: new Date(String(acceptedAt)), deadline_at: new Date(String(deadlineAt)), payload, hmac: String(hmac)
      });
      return { rows: [] as T[], rowCount: duplicate || acceptedConflict ? 0 : 1 };
    }
    if (sql.includes('SELECT') && sql.includes('FROM account_deletion_journal_entries')) {
      const operationId = values[0];
      const selected = operationId === undefined ? rows : rows.filter((row) => row.operation_id === operationId);
      return { rows: selected.map((row) => ({ ...row })) as T[], rowCount: selected.length };
    }
    if (sql.includes('DELETE FROM account_deletion_journal_entries')) {
      const [operationId, intentId, state] = values;
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].operation_id === operationId && (!intentId || rows[i].intent_id === intentId) && (!state || rows[i].state === state)) rows.splice(i, 1);
      }
      return { rows: [] as T[], rowCount: before - rows.length };
    }
    throw new Error(`unexpected_query:${sql}`);
  };
  const client = { query, release() {} } as unknown as PoolClient;
  const database = {
    query,
    async connect() { return client; },
    async end() { closeCount++; }
  } as unknown as Pick<Pool, 'query' | 'connect'> & { end(): Promise<void> };
  return { database, rows, get closeCount() { return closeCount; } };
}

function createJournal(options: { journalId?: string } = {}) {
  const fake = fakeDatabase({ journalId: options.journalId ?? 'staging-account-deletion-journal' });
  const journal = createAccountDeletionJournal({
    database: fake.database,
    signingKey,
    journalId: 'staging-account-deletion-journal'
  });
  return { database: fake.database, rows: fake.rows, get closeCount() { return fake.closeCount; }, journal };
}

test('journal entry contains only replay identifiers and timestamps and verifies integrity', () => {
  const entry = createJournalEntry(acceptance, signingKey);
  assert.deepEqual(Object.keys(entry).sort(), [
    'acceptedAt', 'deadlineAt', 'hmac', 'intentId', 'operationId', 'state', 'userId', 'version'
  ]);
  assert.equal(verifyJournalEntry(entry, signingKey), true);
  assert.equal(verifyJournalEntry({ ...entry, userId: 'b4ae7aed-1111-4f8f-b37a-2111184c34d9' }, signingKey), false);
});

test('journal_write_is_idempotent_for_identical_entry', async () => {
  const { journal, rows } = createJournal();
  await journal.assertReady();
  await journal.writePrepared(acceptance);
  await journal.writePrepared(acceptance);
  await journal.writeAccepted(acceptance);
  await journal.writeAccepted(acceptance);
  assert.equal(rows.length, 2);
  assert.deepEqual((await journal.readAll()).map((entry) => entry.state), ['accepted']);
});

test('journal_conflict_rejects_changed_entry', async () => {
  const { journal } = createJournal();
  await journal.writePrepared(acceptance);
  await journal.writeAccepted(acceptance);
  await assert.rejects(journal.writeAccepted({ ...acceptance, userId: 'b4ae7aed-1111-4f8f-b37a-2111184c34d9' }), /journal_conflict/);
});

test('journal_read_rejects_tampered_hmac', async () => {
  const { journal, rows } = createJournal();
  await journal.writePrepared(acceptance);
  await journal.writeAccepted(acceptance);
  rows[1].hmac = '0'.repeat(64);
  await assert.rejects(journal.readAll(), /journal_integrity_failed/);
});

test('journal_identity_must_match_initialized_id', async () => {
  const { journal } = createJournal({ journalId: 'another-journal' });
  await assert.rejects(journal.initialize(), /journal_identity_mismatch/);
  await assert.rejects(journal.assertReady(), /journal_identity_mismatch/);
});

test('accepted_requires_matching_prepared', async () => {
  const { journal, rows } = createJournal();
  await assert.rejects(journal.writeAccepted(acceptance), /journal_incomplete/);
  assert.equal(rows.length, 0);
});

test('prepared_only_blocks_inventory_read', async () => {
  const { journal } = createJournal();
  await journal.writePrepared(acceptance);
  await assert.rejects(journal.readAll(), /journal_incomplete/);
});

test('journal_close_closes_pool', async () => {
  const fake = createJournal();
  const { journal } = fake;
  await journal.close();
  await journal.close();
  assert.equal(fake.closeCount, 1);
  assert.equal(typeof fake.database.connect, 'function');
});

test('journal read rejects a database state that differs from its signed payload', async () => {
  const { journal, rows } = createJournal();
  await journal.writePrepared(acceptance);
  await journal.writeAccepted(acceptance);
  rows[1].state = 'prepared';
  await assert.rejects(journal.readAll(), /journal_integrity_failed/);
});
