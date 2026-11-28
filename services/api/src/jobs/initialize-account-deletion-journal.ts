import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeAccountDeletionJournalDatabase } from '../config/account-deletion-journal-database.js';
import { initializeAccountDeletionJournal } from '../modules/account-deletion/account-deletion.journal.js';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  initializeAccountDeletionJournal()
    .then(() => console.info(JSON.stringify({ event: 'account_deletion.journal_initialized' })))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Account deletion journal initialization failed.');
      process.exitCode = 1;
    })
    .finally(closeAccountDeletionJournalDatabase);
}
