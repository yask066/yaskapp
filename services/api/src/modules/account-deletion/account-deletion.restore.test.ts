import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/yaskapp_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';
const { createJournalEntry, reconcileAccountDeletionJournal } = await import('./account-deletion.journal.js');
const { reapplyAcceptedDeletions } = await import('./account-deletion.restore.js');

const signingKey = 'restore-test-signing-key-is-at-least-32-characters';
process.env.ACCOUNT_DELETION_JOURNAL_HMAC_KEY = signingKey;
const acceptance = {
  operationId: 'e15d4d2b-5358-45a7-b036-f3648d34b361',
  userId: '3ce3e770-fd0e-4e98-8472-0541d3e27cf1',
  acceptedAt: new Date('2026-10-12T12:00:00.000Z'),
  deadlineAt: new Date('2026-10-13T12:00:00.000Z')
};

function fakeJournal(initialEntries: ReturnType<typeof createJournalEntry>[] = []) {
  const entries = [...initialEntries];
  let preparedWrites = 0;
  let acceptedWrites = 0;
  const journal = {
    async assertReady() {},
    async readAll() { return entries.filter((entry) => entry.state === 'accepted'); },
    async writePrepared(value: typeof acceptance) {
      preparedWrites++;
      const entry = createJournalEntry(value, signingKey, 'prepared');
      if (!entries.some((candidate) => candidate.state === 'prepared' && candidate.operationId === entry.operationId)) entries.push(entry);
    },
    async writeAccepted(value: typeof acceptance) {
      acceptedWrites++;
      const entry = createJournalEntry(value, signingKey, 'accepted');
      if (!entries.some((candidate) => candidate.state === 'accepted' && candidate.operationId === entry.operationId)) entries.push(entry);
    }
  };
  return { journal, entries, get preparedWrites() { return preparedWrites; }, get acceptedWrites() { return acceptedWrites; } };
}

function acceptedOperationRows() {
  return [{ id: acceptance.operationId, user_id: acceptance.userId, accepted_at: acceptance.acceptedAt, deadline_at: acceptance.deadlineAt }];
}

function fakeExecutor(onQuery?: () => void) {
  return { async query<T>() { onQuery?.(); return { rows: acceptedOperationRows() as T[] }; } };
}

test('reconcile_restores_missing_accepted_entry', async () => {
  const journal = fakeJournal();
  const result = await reconcileAccountDeletionJournal(fakeExecutor(), journal.journal);
  assert.deepEqual(result, { reconciled: 1, journalEntries: 1 });
  assert.equal(journal.preparedWrites, 1);
  assert.equal(journal.acceptedWrites, 1);
});

test('reconcile_fails_on_journal_outage', async () => {
  let queriedApplication = false;
  const journal = fakeJournal();
  journal.journal.readAll = async () => { throw new Error('account_deletion_journal_unavailable'); };
  await assert.rejects(
    reconcileAccountDeletionJournal(fakeExecutor(() => { queriedApplication = true; }), journal.journal),
    /account_deletion_journal_unavailable/
  );
  assert.equal(queriedApplication, false);
  assert.equal(journal.preparedWrites, 0);
});

test('reconcile_fails_on_owner_or_timestamp_conflict', async () => {
  const wrongOwner = createJournalEntry({ ...acceptance, userId: 'b4ae7aed-1111-4f8f-b37a-2111184c34d9' }, signingKey);
  const journal = fakeJournal([wrongOwner]);
  await assert.rejects(
    reconcileAccountDeletionJournal(fakeExecutor(), journal.journal),
    /account_deletion_journal_conflict/
  );
  assert.equal(journal.preparedWrites, 0);
  const wrongTimestamp = createJournalEntry({ ...acceptance, deadlineAt: new Date('2026-10-14T12:00:00.000Z') }, signingKey);
  const timestampJournal = fakeJournal([wrongTimestamp]);
  await assert.rejects(
    reconcileAccountDeletionJournal(fakeExecutor(), timestampJournal.journal),
    /account_deletion_journal_conflict/
  );
  assert.equal(timestampJournal.acceptedWrites, 0);
});

test('restore replay closes accounts and resets cleanup for repeatable worker processing', async () => {
  const statements: string[] = [];
  const database = {
    async connect() {
      return {
        async query(sql: string) {
          statements.push(sql);
          if (sql.includes('SELECT user_id FROM account_deletion_operations')) return { rows: [] };
          return { rows: [] };
        },
        release() {}
      };
    }
  } as never;
  const entry = createJournalEntry(acceptance, signingKey);

  assert.deepEqual(await reapplyAcceptedDeletions([entry], database), { reapplied: 1 });
  assert.ok(statements.some((sql) => sql.includes("status = 'deleted'")));
  assert.ok(statements.some((sql) => sql.includes("WHEN status <> 'deleted' OR deleted_at IS NULL THEN 1 ELSE 0 END")));
  assert.ok(statements.some((sql) => sql.includes("status = 'pending'")));
  assert.ok(statements.some((sql) => sql.includes('UPDATE account_deletion_media_manifest')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO account_deletion_media_manifest')));
  assert.ok(statements.some((sql) => sql.includes('INSERT INTO account_deletion_events')));
  const stepsInsert = statements.find((sql) => sql.includes('INSERT INTO account_deletion_steps')) ?? '';
  assert.match(stepsInsert, /position\s*-\s*1/);
  assert.equal(statements.filter((sql) => sql === 'COMMIT').length, 1);
});

test('restore fails closed when the journal contains multiple operations for one user', async () => {
  const entry = createJournalEntry(acceptance, signingKey);
  let connected = false;
  const database = { async connect() { connected = true; throw new Error('unexpected_connect'); } } as never;

  await assert.rejects(
    reapplyAcceptedDeletions([
      entry,
      createJournalEntry({ ...acceptance, operationId: 'd5c5f5f8-e9c0-4822-8b3f-cd34a71a695d' }, signingKey)
    ], database),
    /account_deletion_journal_duplicate_user/
  );
  assert.equal(connected, false);
});

test('restore_rejects_duplicate_operation_or_user', async () => {
  const entry = createJournalEntry(acceptance, signingKey);
  let connected = false;
  const database = { async connect() { connected = true; throw new Error('unexpected_connect'); } } as never;
  await assert.rejects(reapplyAcceptedDeletions([entry, { ...entry }], database), /account_deletion_journal_duplicate_operation/);
  await assert.rejects(reapplyAcceptedDeletions([
    entry,
    createJournalEntry({ ...acceptance, operationId: 'd5c5f5f8-e9c0-4822-8b3f-cd34a71a695d' }, signingKey)
  ], database), /account_deletion_journal_duplicate_user/);
  assert.equal(connected, false);
});

test('restore_rejects_invalid_signature', async () => {
  const invalid = { ...createJournalEntry(acceptance, signingKey), hmac: '0'.repeat(64) };
  let connected = false;
  const database = { async connect() { connected = true; throw new Error('unexpected_connect'); } } as never;
  await assert.rejects(reapplyAcceptedDeletions([invalid], database), /account_deletion_journal_integrity_failed/);
  await assert.rejects(
    reapplyAcceptedDeletions([createJournalEntry(acceptance, signingKey, 'prepared')], database),
    /account_deletion_journal_integrity_failed/
  );
  assert.equal(connected, false);
});

test('restore_replay_is_idempotent', async () => {
  const entry = createJournalEntry(acceptance, signingKey);
  const statements: string[] = [];
  const database = {
    async connect() {
      return {
        async query(sql: string) {
          statements.push(sql);
          if (sql.includes('SELECT user_id FROM account_deletion_operations')) return { rows: [] };
          return { rows: [] };
        },
        release() {}
      };
    }
  } as never;
  await reapplyAcceptedDeletions([entry], database);
  await reapplyAcceptedDeletions([entry], database);
  assert.equal(statements.filter((sql) => sql.includes('INSERT INTO account_deletion_steps')).length, 2);
  assert.equal(statements.filter((sql) => sql.includes('INSERT INTO account_deletion_events')).length, 2);
  assert.ok(statements.filter((sql) => sql.includes('INSERT INTO account_deletion_steps'))
    .every((sql) => sql.includes('ON CONFLICT (operation_id, step_key)')));
  assert.ok(statements.filter((sql) => sql.includes('INSERT INTO account_deletion_events'))
    .every((sql) => sql.includes('ON CONFLICT (operation_id, event_key)')));
});
