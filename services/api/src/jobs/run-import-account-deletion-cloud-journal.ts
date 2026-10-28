import { getAccountDeletionJournalDatabase, closeAccountDeletionJournalDatabase } from '../config/account-deletion-journal-database.js';
import { createAccountDeletionJournal } from '../modules/account-deletion/account-deletion.journal.js';
import { createLegacyS3AccountDeletionJournalSourceFromEnvironment } from '../modules/account-deletion/account-deletion.legacy-s3-journal.js';
import { importLegacyAccountDeletionJournal } from './import-account-deletion-cloud-journal.js';

const signingKey = process.env.ACCOUNT_DELETION_JOURNAL_HMAC_KEY;
const journalId = process.env.ACCOUNT_DELETION_JOURNAL_ID;
if (!signingKey || signingKey.length < 32 || !journalId) {
  throw new Error('account_deletion_journal_unavailable');
}

const target = createAccountDeletionJournal({
  database: getAccountDeletionJournalDatabase(),
  signingKey,
  journalId
});
let source: ReturnType<typeof createLegacyS3AccountDeletionJournalSourceFromEnvironment> | undefined;

try {
  source = createLegacyS3AccountDeletionJournalSourceFromEnvironment();
  const result = await importLegacyAccountDeletionJournal(source, target, signingKey);
  console.log(JSON.stringify(result));
} catch (error) {
  const code = error instanceof Error ? error.message : '';
  const message = /^account_deletion_[a-z0-9_]+$/.test(code)
    ? code
    : 'account_deletion_legacy_journal_import_failed';
  console.error(`Legacy account deletion journal import failed: ${message}`);
  process.exitCode = 1;
} finally {
  source?.close?.();
  await closeAccountDeletionJournalDatabase();
}
