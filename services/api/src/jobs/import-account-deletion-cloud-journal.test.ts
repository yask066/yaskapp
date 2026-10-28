import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { createAccountDeletionJournal, createJournalEntry } from '../modules/account-deletion/account-deletion.journal.js';
import type { LegacyAccountDeletionJournalEntry } from '../modules/account-deletion/account-deletion.legacy-s3-journal.js';
import { importLegacyAccountDeletionJournal } from './import-account-deletion-cloud-journal.js';

const signingKey = 'legacy-import-test-key-at-least-32-characters';
process.env.ACCOUNT_DELETION_JOURNAL_HMAC_KEY = signingKey;
const journalId = 'account-deletion-import-test';
const acceptance = {
  operationId: 'e15d4d2b-5358-45a7-b036-f3648d34b361',
  userId: '3ce3e770-fd0e-4e98-8472-0541d3e27cf1',
  acceptedAt: new Date('2026-10-12T12:00:00.000Z'),
  deadlineAt: new Date('2026-10-13T12:00:00.000Z')
};

function checkpointFor(value: typeof acceptance): LegacyAccountDeletionJournalEntry {
  const entry = {
    version: 1 as const,
    state: 'checkpoint' as const,
    operationId: value.operationId,
    intentId: createHash('sha256').update(`${value.operationId}\n${value.acceptedAt.toISOString()}`).digest('hex'),
    userId: value.userId,
    acceptedAt: value.acceptedAt.toISOString(),
    deadlineAt: value.deadlineAt.toISOString()
  };
  const payload = JSON.stringify(entry);
  return { ...entry, hmac: createHmac('sha256', signingKey).update(payload).digest('hex') };
}

function inMemorySource(entries: unknown[] = [], checkpoints: unknown[] = []) {
  return {
    async readInventory() { return { entries, checkpoints }; }
  };
}

function fakePostgresJournal() {
  const rows: Array<{
    operation_id: string; intent_id: string; user_id: string; state: string;
    accepted_at: Date; deadline_at: Date; payload: unknown; hmac: string;
  }> = [];
  let writes = 0;
  const query = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => {
    if (sql.includes('SELECT journal_id FROM account_deletion_journal_meta')) {
      return { rows: [{ journal_id: journalId } as T], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO account_deletion_journal_entries')) {
      writes++;
      const [operationId, intentId, userId, state, acceptedAt, deadlineAt, payload, hmac] = values;
      if (!rows.some((row) => row.state === state && row.operation_id === operationId && row.intent_id === intentId)) {
        rows.push({
          operation_id: String(operationId), intent_id: String(intentId), user_id: String(userId), state: String(state),
          accepted_at: new Date(String(acceptedAt)), deadline_at: new Date(String(deadlineAt)), payload, hmac: String(hmac)
        });
      }
      return { rows: [] as T[], rowCount: 1 };
    }
    if (sql.includes('SELECT') && sql.includes('FROM account_deletion_journal_entries')) {
      const operationId = values[0];
      const selected = operationId === undefined ? rows : rows.filter((row) => row.operation_id === operationId);
      return { rows: selected.map((row) => ({ ...row })) as T[], rowCount: selected.length };
    }
    throw new Error(`unexpected_query:${sql}`);
  };
  const client = { query, release() {} } as unknown as PoolClient;
  const database = {
    query,
    async connect() { return client; },
    async end() {}
  } as unknown as Pick<Pool, 'query' | 'connect'>;
  const target = createAccountDeletionJournal({ database, signingKey, journalId });
  return { target, rows, get writes() { return writes; } };
}

function legacyEntries() {
  return [
    createJournalEntry(acceptance, signingKey, 'prepared'),
    createJournalEntry(acceptance, signingKey, 'accepted')
  ];
}

test('legacy_import_accepts_empty_inventory', async () => {
  const fake = fakePostgresJournal();
  const result = await importLegacyAccountDeletionJournal(inMemorySource(), fake.target);
  assert.deepEqual(result, { prepared: 0, accepted: 0, conflicts: 0 });
  assert.equal(fake.writes, 0);
});

test('legacy_import_preserves_valid_entries', async () => {
  const fake = fakePostgresJournal();
  const result = await importLegacyAccountDeletionJournal(
    inMemorySource(legacyEntries(), [checkpointFor(acceptance)]), fake.target
  );
  assert.deepEqual(result, { prepared: 1, accepted: 1, conflicts: 0 });
  assert.deepEqual(fake.rows.map((row) => row.state).sort(), ['accepted', 'prepared']);
  assert.deepEqual(await fake.target.readAll(), [createJournalEntry(acceptance, signingKey)]);
});

test('legacy_import_is_idempotent', async () => {
  const fake = fakePostgresJournal();
  const source = inMemorySource([...legacyEntries(), ...legacyEntries()], [checkpointFor(acceptance)]);
  const first = await importLegacyAccountDeletionJournal(source, fake.target);
  const second = await importLegacyAccountDeletionJournal(source, fake.target);
  assert.deepEqual(first, { prepared: 1, accepted: 1, conflicts: 0 });
  assert.deepEqual(second, first);
  assert.equal(fake.rows.length, 2);
});

test('legacy_import_rejects_invalid_hmac', async () => {
  const fake = fakePostgresJournal();
  const [prepared, accepted] = legacyEntries();
  await assert.rejects(importLegacyAccountDeletionJournal(
    inMemorySource([prepared, { ...accepted, hmac: '0'.repeat(64) }], [checkpointFor(acceptance)]), fake.target
  ), /integrity_failed/);
  await assert.rejects(importLegacyAccountDeletionJournal(
    inMemorySource([prepared, accepted], [{ ...checkpointFor(acceptance), hmac: '0'.repeat(64) }]), fake.target
  ), /integrity_failed/);
  assert.equal(fake.writes, 0);
});

test('legacy_import_rejects_missing_prepared_or_checkpoint', async () => {
  const fake = fakePostgresJournal();
  const [prepared, accepted] = legacyEntries();
  await assert.rejects(importLegacyAccountDeletionJournal(
    inMemorySource([accepted], [checkpointFor(acceptance)]), fake.target
  ), /incomplete/);
  await assert.rejects(importLegacyAccountDeletionJournal(
    inMemorySource([prepared, accepted], []), fake.target
  ), /checkpoint_incomplete/);
  await assert.rejects(importLegacyAccountDeletionJournal(
    inMemorySource([], [checkpointFor(acceptance)]), fake.target
  ), /checkpoint_incomplete/);
  assert.equal(fake.writes, 0);
});

test('legacy_import_rejects_conflicting_operation', async () => {
  const fake = fakePostgresJournal();
  const [prepared, accepted] = legacyEntries();
  const changedAcceptance = { ...acceptance, userId: 'b4ae7aed-1111-4f8f-b37a-2111184c34d9' };
  await assert.rejects(importLegacyAccountDeletionJournal(inMemorySource(
    [prepared, accepted, createJournalEntry(changedAcceptance, signingKey, 'prepared')],
    [checkpointFor(acceptance)]
  ), fake.target), /conflict/);
  assert.equal(fake.writes, 0);
});
