import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { closeDatabaseConnection, db } from '../config/database.js';
import {
  closeStorageConnection,
  deleteObjects,
  listObjects,
  type StorageObject
} from '../config/storage.js';

const pollImagePrefix = 'poll-images/';
const defaultGracePeriodHours = 24;

export function isCleanupCliInvocation(moduleUrl: string, argvPath?: string) {
  return argvPath !== undefined &&
    moduleUrl === pathToFileURL(resolve(argvPath)).href;
}

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
  // List S3 BEFORE checking PostgreSQL so objects uploaded concurrently are never misclassified as orphans.
  const objects = await listObjects(pollImagePrefix);
  const now = new Date();
  const candidates = selectOrphanedPollImageKeys(objects, new Set(), now, gracePeriodHours);
  const referencedKeys = new Set<string>();
  const orphanedKeys: string[] = [];

  for (let offset = 0; offset < candidates.length; offset += 500) {
    const batch = candidates.slice(offset, offset + 500);
    const referencedResult = await db.query<{ image_object_key: string }>(
      `
        SELECT image_object_key
        FROM polls
        WHERE image_object_key = ANY($1::text[])
      `,
      [batch]
    );
    for (const row of referencedResult.rows) {
      referencedKeys.add(row.image_object_key);
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

if (isCleanupCliInvocation(import.meta.url, process.argv[1])) {
  const dryRun = process.argv.includes('--dry-run');
  const graceArg = process.argv.find((arg) => arg.startsWith('--grace-period-hours='));
  const gracePeriodHours = graceArg ? Number(graceArg.split('=')[1]) : undefined;
  cleanupOrphanedPollImages({
    dryRun,
    ...(gracePeriodHours !== undefined && Number.isFinite(gracePeriodHours) ? { gracePeriodHours } : {})
  })
    .then(({ keys: _keys, ...summary }) => {
      console.log(JSON.stringify(summary));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDatabaseConnection();
      closeStorageConnection();
    });
}
