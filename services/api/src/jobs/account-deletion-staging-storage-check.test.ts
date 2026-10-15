import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertJournalDatabaseRoles } from './account-deletion-staging-storage-check.js';

function database(responses: Array<{ rows: unknown[] }>) {
  let index = 0;
  return {
    async query<T extends Record<string, unknown>>() {
      const response = responses[index++];
      assert.ok(response, 'unexpected journal database query');
      return response as { rows: T[] };
    }
  };
}

function readyDatabases(options: {
  journalId?: string;
  runtimeRole?: string;
  runtimeCanUpdate?: boolean;
  runtimeCanDelete?: boolean;
  runtimeCanTruncate?: boolean;
  runtimeCanPrune?: boolean;
  runtimeMetaCanUpdate?: boolean;
  runtimeMetaCanDelete?: boolean;
  retentionRole?: string;
  retentionCanPrune?: boolean;
  retentionCanReadEntries?: boolean;
  retentionCanInsertEntries?: boolean;
  retentionMetaCanUpdate?: boolean;
  retentionMetaCanDelete?: boolean;
  retentionCanUpdate?: boolean;
  retentionCanDelete?: boolean;
  retentionCanTruncate?: boolean;
  retentionMetaCanTruncate?: boolean;
} = {}) {
  return {
    runtimeDatabase: database([
      { rows: [{ journal_id: options.journalId ?? 'staging-journal' }] },
      { rows: [{ role: options.runtimeRole ?? 'account_deletion_journal_runtime', can_select: true, can_insert: true, can_update: options.runtimeCanUpdate ?? false, can_delete: options.runtimeCanDelete ?? false, can_truncate: options.runtimeCanTruncate ?? false, can_prune: options.runtimeCanPrune ?? false, meta_can_select: true, meta_can_insert: false, meta_can_update: options.runtimeMetaCanUpdate ?? false, meta_can_delete: options.runtimeMetaCanDelete ?? false, meta_can_truncate: false }] }
    ]),
    retentionDatabase: database([
      { rows: [{ role: options.retentionRole ?? 'account_deletion_journal_retention', can_prune: options.retentionCanPrune ?? true, can_read_entries: options.retentionCanReadEntries ?? false, can_insert_entries: options.retentionCanInsertEntries ?? false, can_update: options.retentionCanUpdate ?? false, can_delete: options.retentionCanDelete ?? false, can_truncate_entries: options.retentionCanTruncate ?? false, meta_can_select: false, meta_can_insert: false, meta_can_update: options.retentionMetaCanUpdate ?? false, meta_can_delete: options.retentionMetaCanDelete ?? false, meta_can_truncate: options.retentionMetaCanTruncate ?? false }] }
    ])
  };
}

test('staging_check_requires_matching_journal_identity', async () => {
  const clients = readyDatabases();
  await assert.doesNotReject(() => assertJournalDatabaseRoles({
    ...clients,
    journalId: 'staging-journal'
  }));

  const mismatched = readyDatabases({ journalId: 'replaced-journal' });
  await assert.rejects(() => assertJournalDatabaseRoles({
    ...mismatched,
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:identity_mismatch/);
});

test('staging_check_requires_append_only_runtime_role', async () => {
  await assert.doesNotReject(() => assertJournalDatabaseRoles({
    ...readyDatabases(),
    journalId: 'staging-journal'
  }));

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ runtimeCanDelete: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:runtime_role_not_append_only/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ runtimeCanUpdate: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:runtime_role_not_append_only/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ runtimeCanTruncate: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:runtime_role_not_append_only/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ runtimeCanPrune: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:runtime_role_not_append_only/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ runtimeMetaCanDelete: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:runtime_role_not_append_only/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ runtimeMetaCanUpdate: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:runtime_role_not_append_only/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ runtimeRole: 'postgres' }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:runtime_role_invalid/);
});

test('staging_check_requires_restricted_retention_role', async () => {
  await assert.doesNotReject(() => assertJournalDatabaseRoles({
    ...readyDatabases(),
    journalId: 'staging-journal'
  }));

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ retentionCanPrune: false }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:retention_function_unavailable/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ retentionCanDelete: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:retention_role_unrestricted/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ retentionCanUpdate: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:retention_role_unrestricted/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ retentionMetaCanDelete: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:retention_role_unrestricted/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ retentionMetaCanUpdate: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:retention_role_unrestricted/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ retentionCanReadEntries: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:retention_role_unrestricted/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ retentionCanInsertEntries: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:retention_role_unrestricted/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ retentionCanTruncate: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:retention_role_unrestricted/);

  await assert.rejects(() => assertJournalDatabaseRoles({
    ...readyDatabases({ retentionMetaCanTruncate: true }),
    journalId: 'staging-journal'
  }), /account_deletion_storage_check:journal:retention_role_unrestricted/);
});
