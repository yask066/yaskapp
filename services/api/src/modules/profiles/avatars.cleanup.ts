import { db } from '../../config/database.js';
import {
  deleteObjects,
  listObjects,
  type StorageObject
} from '../../config/storage.js';

const avatarPrefix = 'avatars/';
const defaultGracePeriodHours = 24;

export function selectOrphanedAvatarKeys(
  objects: StorageObject[],
  referencedKeys: ReadonlySet<string>,
  now: Date,
  gracePeriodHours = defaultGracePeriodHours
) {
  const cutoff = now.getTime() - gracePeriodHours * 60 * 60 * 1_000;

  return objects
    .filter((object) =>
      object.key.startsWith(avatarPrefix) &&
      object.key.endsWith('.webp') &&
      !referencedKeys.has(object.key) &&
      object.lastModified !== undefined &&
      object.lastModified.getTime() <= cutoff
    )
    .map((object) => object.key);
}

export async function cleanupOrphanedAvatars(input?: {
  dryRun?: boolean;
  gracePeriodHours?: number;
}) {
  const dryRun = input?.dryRun ?? false;
  const gracePeriodHours = input?.gracePeriodHours ?? defaultGracePeriodHours;
  // List S3 BEFORE checking PostgreSQL so concurrently uploaded avatars are never deleted.
  const objects = await listObjects(avatarPrefix);
  const candidates = selectOrphanedAvatarKeys(objects, new Set(), new Date(), gracePeriodHours);
  const referencedKeys = new Set<string>();
  const orphanedKeys: string[] = [];

  for (let offset = 0; offset < candidates.length; offset += 500) {
    const batch = candidates.slice(offset, offset + 500);
    const referencedResult = await db.query<{ avatar_object_key: string }>(
      `
        SELECT avatar_object_key
        FROM profiles
        WHERE avatar_object_key = ANY($1::text[])
      `,
      [batch]
    );
    for (const row of referencedResult.rows) {
      referencedKeys.add(row.avatar_object_key);
    }
    const batchOrphans = batch.filter((key) => !referencedKeys.has(key));
    if (!dryRun && batchOrphans.length > 0) {
      await deleteObjects(batchOrphans);
    }
    orphanedKeys.push(...batchOrphans);
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
