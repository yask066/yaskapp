import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { closeDatabaseConnection, db } from '../config/database.js';

export async function cleanupExpiredNotifications(retentionDays = 180, batchSize = 1000) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('retentionDays must be an integer between 1 and 3650.');
  }
  let totalDeleted = 0;
  for (;;) {
    const result = await db.query(
      `WITH doomed AS (
         SELECT id
         FROM notifications
         WHERE read_at IS NOT NULL AND read_at < now() - ($1::text || ' days')::interval
         LIMIT $2
       )
       DELETE FROM notifications
       WHERE id IN (SELECT id FROM doomed)`,
      [retentionDays, batchSize]
    );
    const deleted = result.rowCount ?? 0;
    totalDeleted += deleted;
    if (deleted < batchSize) break;
  }
  return { deleted: totalDeleted, retentionDays };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const retentionDays = Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 180);
  cleanupExpiredNotifications(retentionDays)
    .then((result) => console.log(`Deleted ${result.deleted} expired notifications.`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Notification cleanup failed.');
      process.exitCode = 1;
    })
    .finally(closeDatabaseConnection);
}
