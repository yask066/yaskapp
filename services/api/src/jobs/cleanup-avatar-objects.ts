import { closeDatabaseConnection } from '../config/database.js';
import { closeStorageConnection } from '../config/storage.js';
import { cleanupOrphanedAvatars } from '../modules/profiles/avatars.cleanup.js';

const dryRun = process.argv.includes('--dry-run');
const gracePeriodArgument = process.argv.find((argument) =>
  argument.startsWith('--grace-period-hours=')
);
const gracePeriodHours = gracePeriodArgument
  ? Number(gracePeriodArgument.split('=')[1])
  : undefined;

if (gracePeriodHours !== undefined &&
    (!Number.isFinite(gracePeriodHours) || gracePeriodHours < 0)) {
  throw new Error('--grace-period-hours must be a non-negative number.');
}

try {
  const result = await cleanupOrphanedAvatars({ dryRun, gracePeriodHours });
  console.log(JSON.stringify(result));
} finally {
  await closeDatabaseConnection();
  closeStorageConnection();
}
