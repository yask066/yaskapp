import { closeDatabaseConnection } from '../config/database.js';
import { deleteExpiredFeedSnapshots } from '../modules/polls/poll-feed-snapshots.repository.js';

try {
  const deleted = await deleteExpiredFeedSnapshots();
  console.log(`Deleted ${deleted} expired poll feed snapshot(s).`);
} catch (error) {
  console.error('Poll feed snapshot cleanup failed.');
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabaseConnection();
}
