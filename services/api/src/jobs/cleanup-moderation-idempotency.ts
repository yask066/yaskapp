import { closeDatabaseConnection, db } from '../config/database.js';

const batchSize = 5_000;
const maxBatches = 100;

export async function cleanupExpiredModerationIdempotencyKeys() {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await db.query(
      `
        DELETE FROM moderation_idempotency_keys
        WHERE ctid IN (
          SELECT ctid
          FROM moderation_idempotency_keys
          WHERE expires_at < now()
          LIMIT $1
        )
      `,
      [batchSize]
    );
    const count = result.rowCount ?? 0;
    deleted += count;
    if (count < batchSize) break;
  }
  return deleted;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cleanup-moderation-idempotency.ts') || process.argv[1]?.endsWith('cleanup-moderation-idempotency.js')) {
  cleanupExpiredModerationIdempotencyKeys()
    .then((deleted) => console.log(`Deleted ${deleted} expired moderation idempotency keys.`))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown moderation idempotency cleanup error.';
      console.error(`Moderation idempotency cleanup failed: ${message}`);
      process.exitCode = 1;
    })
    .finally(() => closeDatabaseConnection());
}
