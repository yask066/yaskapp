import { pathToFileURL } from 'node:url';

type JournalDatabase = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
};

function checkError(reason: string): Error {
  return new Error(`account_deletion_storage_check:journal:${reason}`);
}

export async function assertJournalDatabaseRoles(options: {
  runtimeDatabase: JournalDatabase;
  retentionDatabase: JournalDatabase;
  journalId: string;
}) {
  let identity: { journal_id: string } | undefined;
  try {
    const result = await options.runtimeDatabase.query<{ journal_id: string }>(
      'SELECT journal_id FROM account_deletion_journal_meta WHERE singleton = TRUE'
    );
    identity = result.rows[0];
  } catch {
    throw checkError('identity_unavailable');
  }
  if (!identity?.journal_id) throw checkError('identity_missing');
  if (identity.journal_id !== options.journalId) throw checkError('identity_mismatch');

  let runtime: {
    role: string;
    can_select: boolean;
    can_insert: boolean;
    can_update: boolean;
    can_delete: boolean;
    can_truncate: boolean;
    can_prune: boolean;
    meta_can_select: boolean;
    meta_can_insert: boolean;
    meta_can_update: boolean;
    meta_can_delete: boolean;
    meta_can_truncate: boolean;
  } | undefined;
  try {
    const result = await options.runtimeDatabase.query<{
      role: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
      can_prune: boolean;
      meta_can_select: boolean;
      meta_can_insert: boolean;
      meta_can_update: boolean;
      meta_can_delete: boolean;
      meta_can_truncate: boolean;
    }>(`SELECT current_user AS role,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'SELECT') AS can_select,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'INSERT') AS can_insert,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'UPDATE') AS can_update,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'DELETE') AS can_delete,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'TRUNCATE') AS can_truncate,
        has_function_privilege(current_user, 'public.prune_completed_account_deletion_journal(text[])', 'EXECUTE') AS can_prune,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'SELECT') AS meta_can_select,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'INSERT') AS meta_can_insert,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'UPDATE') AS meta_can_update,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'DELETE') AS meta_can_delete,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'TRUNCATE') AS meta_can_truncate`);
    runtime = result.rows[0];
  } catch {
    throw checkError('runtime_role_unavailable');
  }
  if (runtime?.role !== 'account_deletion_journal_runtime') throw checkError('runtime_role_invalid');
  if (!runtime.can_select || !runtime.can_insert || !runtime.meta_can_select || runtime.meta_can_insert ||
      runtime.can_update || runtime.can_delete || runtime.can_truncate || runtime.can_prune ||
      runtime.meta_can_update || runtime.meta_can_delete || runtime.meta_can_truncate) {
    throw checkError('runtime_role_not_append_only');
  }

  let retention: {
    role: string;
    can_prune: boolean;
    can_read_entries: boolean;
    can_insert_entries: boolean;
    can_update: boolean;
    can_delete: boolean;
    can_truncate_entries: boolean;
    meta_can_select: boolean;
    meta_can_insert: boolean;
    meta_can_update: boolean;
    meta_can_delete: boolean;
    meta_can_truncate: boolean;
  } | undefined;
  try {
    const result = await options.retentionDatabase.query<{
      role: string;
      can_prune: boolean;
      can_read_entries: boolean;
      can_insert_entries: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate_entries: boolean;
      meta_can_select: boolean;
      meta_can_insert: boolean;
      meta_can_update: boolean;
      meta_can_delete: boolean;
      meta_can_truncate: boolean;
    }>(`SELECT current_user AS role,
        has_function_privilege(current_user, 'public.prune_completed_account_deletion_journal(text[])', 'EXECUTE') AS can_prune,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'SELECT') AS can_read_entries,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'INSERT') AS can_insert_entries,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'UPDATE') AS can_update,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'DELETE') AS can_delete,
        has_table_privilege(current_user, 'public.account_deletion_journal_entries', 'TRUNCATE') AS can_truncate_entries,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'SELECT') AS meta_can_select,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'INSERT') AS meta_can_insert,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'UPDATE') AS meta_can_update,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'DELETE') AS meta_can_delete,
        has_table_privilege(current_user, 'public.account_deletion_journal_meta', 'TRUNCATE') AS meta_can_truncate`);
    retention = result.rows[0];
  } catch {
    throw checkError('retention_function_unavailable');
  }
  if (retention?.role !== 'account_deletion_journal_retention') throw checkError('retention_role_invalid');
  if (!retention.can_prune) throw checkError('retention_function_unavailable');
  if (retention.can_read_entries || retention.can_insert_entries || retention.can_update || retention.can_delete ||
      retention.can_truncate_entries || retention.meta_can_select || retention.meta_can_insert || retention.meta_can_update ||
      retention.meta_can_delete || retention.meta_can_truncate) {
    throw checkError('retention_role_unrestricted');
  }
}

export async function checkAccountDeletionStagingStorage() {
  const [
    { env },
    { getAccountDeletionJournalDatabase, getAccountDeletionJournalRetentionDatabase, closeAccountDeletionJournalDatabase }
  ] = await Promise.all([
    import('../config/env.js'),
    import('../config/account-deletion-journal-database.js')
  ]);
  if (!env.ACCOUNT_DELETION_JOURNAL_ID) throw checkError('identity_configuration_missing');

  try {
    const runtimeDatabase = getAccountDeletionJournalDatabase();
    const retentionDatabase = getAccountDeletionJournalRetentionDatabase();
    const connectivity = await runtimeDatabase.query<{ server_time: Date | string }>('SELECT now() AS server_time');
    if (!connectivity.rows[0]?.server_time) throw checkError('connection_unavailable');
    await assertJournalDatabaseRoles({ runtimeDatabase, retentionDatabase, journalId: env.ACCOUNT_DELETION_JOURNAL_ID });
    console.log('account_deletion_storage_check:journal:ok');
  } finally {
    await closeAccountDeletionJournalDatabase();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkAccountDeletionStagingStorage().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown_error';
    console.error(message);
    process.exitCode = 1;
  });
}
