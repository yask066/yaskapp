import { initializeAccountDeletionJournal } from '../modules/account-deletion/account-deletion.journal.js';

initializeAccountDeletionJournal()
  .then(() => console.info(JSON.stringify({ event: 'account_deletion.journal_initialized' })))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Account deletion journal initialization failed.');
    process.exitCode = 1;
  });
