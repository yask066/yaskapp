import { db } from '../config/database.js';
import {
  deleteObjects,
  listObjects,
  type StorageObject
} from '../config/storage.js';

const pollImagePrefix = 'poll-images/';
const defaultGracePeriodHours = 24;

export function selectOrphanedPollImageKeys(
  objects: StorageObject[],
  referencedKeys: ReadonlySet<string>,
  now: Date,
  gracePeriodHours = defaultGracePeriodHours
) {
  const cutoff = now.getTime() - gracePeriodHours * 60 * 60 * 1_000;

  return objects
    .filter((object) =>
      object.key.startsWith(pollImagePrefix) &&
      object.key.endsWith('.webp') &&
      !referencedKeys.has(object.key) &&
      object.lastModified !== undefined &&
      object.lastModified.getTime() <= cutoff
    )
    .map((object) => object.key);
}

export async function cleanupOrphanedPollImages(input?: {
  dryRun?: boolean;
  gracePeriodHours?: number;
}) {
  const dryRun = input?.dryRun ?? false;
  const gracePeriodHours = input?.gracePeriodHours ?? defaultGracePeriodHours;
  const referencedResult = await db.query<{ image_object_key: string }>(
    `
      SELECT image_object_key
      FROM polls
      WHERE image_object_key IS NOT NULL
        AND deleted_at IS NULL
    `
  );
  const referencedKeys = new Set(
    referencedResult.rows.map((row) => row.image_object_key)
  );
  const objects = await listObjects(pollImagePrefix);
  const orphanedKeys = selectOrphanedPollImageKeys(
    objects,
    referencedKeys,
    new Date(),
    gracePeriodHours
  );

  if (!dryRun && orphanedKeys.length > 0) {
    await deleteObjects(orphanedKeys);
  }

  return {
    dryRun,
    gracePeriodHours,
    scanned: objects.length,
    referenced: referencedKeys.size,
    orphaned: orphanedKeys.length,
    deleted: dryRun ? 0 : orphanedKeys.length,
    keys: orphanedKeys
  };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  cleanupOrphanedPollImages()
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
