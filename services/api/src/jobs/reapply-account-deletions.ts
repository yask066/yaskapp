import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeDatabaseConnection } from '../config/database.js';
import { closeAccountDeletionJournalDatabase } from '../config/account-deletion-journal-database.js';
import { readAcceptedDeletionsFromJournal } from '../modules/account-deletion/account-deletion.journal.js';
import { reapplyAcceptedDeletions } from '../modules/account-deletion/account-deletion.restore.js';

export async function reapplyAccountDeletions() {
  const entries = await readAcceptedDeletionsFromJournal();
  const result = await reapplyAcceptedDeletions(entries);
  if (result.reapplied !== entries.length) throw new Error('account_deletion_restore_incomplete');
  return { verified: entries.length, ...result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  reapplyAccountDeletions()
    .then((result) => console.info(JSON.stringify({ event: 'account_deletion.journal_reapplied', ...result })))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Account deletion journal reapply failed.');
      process.exitCode = 1;
    })
    .finally(async () => Promise.all([closeDatabaseConnection(), closeAccountDeletionJournalDatabase()]));
}
