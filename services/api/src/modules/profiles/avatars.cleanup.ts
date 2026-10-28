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
  const referencedResult = await db.query<{ avatar_object_key: string }>(
    `
      SELECT avatar_object_key
      FROM profiles
      WHERE avatar_object_key IS NOT NULL
    `
  );
  const referencedKeys = new Set(
    referencedResult.rows.map((row) => row.avatar_object_key)
  );
  const objects = await listObjects(avatarPrefix);
  const orphanedKeys = selectOrphanedAvatarKeys(
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
