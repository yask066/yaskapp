import { closeDatabaseConnection, db } from '../config/database.js';
import { closeAccountDeletionJournalDatabase } from '../config/account-deletion-journal-database.js';
import { reconcileAccountDeletionJournal } from '../modules/account-deletion/account-deletion.journal.js';

export async function reconcileAccountDeletionJournalJob() {
  return reconcileAccountDeletionJournal(db);
}

reconcileAccountDeletionJournalJob()
  .then((result) => console.info(JSON.stringify({ event: 'account_deletion.journal_reconciled', ...result })))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Account deletion journal reconciliation failed.');
    process.exitCode = 1;
  })
  .finally(async () => Promise.all([closeDatabaseConnection(), closeAccountDeletionJournalDatabase()]));
