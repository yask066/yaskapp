import { closeDatabaseConnection } from '../config/database.js';
import { readAcceptedDeletionsFromJournal } from '../modules/account-deletion/account-deletion.journal.js';
import { reapplyAcceptedDeletions } from '../modules/account-deletion/account-deletion.restore.js';

export async function reapplyAccountDeletions() {
  const entries = await readAcceptedDeletionsFromJournal();
  const result = await reapplyAcceptedDeletions(entries);
  if (result.reapplied !== entries.length) throw new Error('account_deletion_restore_incomplete');
  return result;
}

reapplyAccountDeletions()
  .then((result) => console.info(JSON.stringify({ event: 'account_deletion.journal_reapplied', ...result })))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Account deletion journal reapply failed.');
    process.exitCode = 1;
  })
  .finally(closeDatabaseConnection);
