import { db } from '../config/database.js';

export async function cleanupExpiredNotifications(retentionDays = 180) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('retentionDays must be an integer between 1 and 3650.');
  }
  const result = await db.query(
    `DELETE FROM notifications
     WHERE read_at IS NOT NULL AND read_at < now() - ($1::text || ' days')::interval`,
    [retentionDays]
  );
  return { deleted: result.rowCount ?? 0, retentionDays };
}

if (process.argv[1]?.endsWith('cleanup-notifications.ts') || process.argv[1]?.endsWith('cleanup-notifications.js')) {
  const retentionDays = Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 180);
  cleanupExpiredNotifications(retentionDays)
    .then((result) => console.log(`Deleted ${result.deleted} expired notifications.`))
    .finally(() => db.end());
}
