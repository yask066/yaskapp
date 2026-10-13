import { closeDatabaseConnection, db } from '../config/database.js';
import { exportAcceptedDeletionsToJournal } from '../modules/account-deletion/account-deletion.journal.js';

export async function exportAccountDeletionJournal() {
  return exportAcceptedDeletionsToJournal(db);
}

exportAccountDeletionJournal()
  .then((result) => console.info(JSON.stringify({ event: 'account_deletion.journal_exported', ...result })))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Account deletion journal export failed.');
    process.exitCode = 1;
  })
  .finally(closeDatabaseConnection);
