import type { PoolClient } from 'pg';

import { db } from '../../config/database.js';
import {
  deleteObjectVersions,
  listObjectVersions,
  type StorageObjectVersion
} from '../../config/storage.js';

export type DeletionMediaObject = StorageObjectVersion;

type MediaRepository = {
  getOwner(operationId: string): Promise<string | null>;
  getReferencedKeys(userId: string): Promise<string[]>;
  addManifest(operationId: string, userId: string, objects: DeletionMediaObject[]): Promise<void>;
  claimManifest(operationId: string, limit: number): Promise<DeletionMediaObject[]>;
  markManifestCompleted(operationId: string, objects: DeletionMediaObject[]): Promise<void>;
  markManifestRetrying(operationId: string, objects: DeletionMediaObject[], code: string): Promise<void>;
  hasUncompletedManifest(operationId: string): Promise<boolean>;
  getManifestKeys(operationId: string): Promise<string[]>;
};

type MediaStorage = {
  listObjectVersions(
    prefix: string,
    markers?: { keyMarker?: string; versionIdMarker?: string }
  ): Promise<{
    objects: DeletionMediaObject[];
    isTruncated: boolean;
    nextKeyMarker?: string;
    nextVersionIdMarker?: string;
  }>;
  deleteObjects(objects: DeletionMediaObject[]): Promise<void>;
};

type AccountDeletionMediaDependencies = {
  repository: MediaRepository;
  storage: MediaStorage;
};

const MEDIA_BATCH_SIZE = 100;

function isWithinOwnedPrefix(key: string, prefix: string) {
  if (!key.startsWith(prefix)) return false;
  const relative = key.slice(prefix.length);
  return relative.length > 0 && !relative.split('/').some((part) => part === '.' || part === '..');
}

function ownedPrefixes(userId: string) {
  return [`avatars/${userId}/`, `poll-images/${userId}/`];
}

async function listExactKeyVersions(storage: MediaStorage, key: string) {
  const objects: DeletionMediaObject[] = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  do {
    const page = await storage.listObjectVersions(key, { keyMarker, versionIdMarker });
    objects.push(...page.objects.filter((object) => object.key === key));
    if (page.isTruncated
      && (!page.nextKeyMarker
        || (page.nextKeyMarker === keyMarker && page.nextVersionIdMarker === versionIdMarker))) {
      throw new Error('storage_version_listing_cursor_invalid');
    }
    keyMarker = page.nextKeyMarker;
    versionIdMarker = page.nextVersionIdMarker;
    if (!page.isTruncated) break;
  } while (true);
  return objects;
}

function createDatabaseRepository(executor: typeof db = db): MediaRepository {
  const withTransaction = async <T>(run: (client: PoolClient) => Promise<T>) => {
    const client = await executor.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    async getOwner(operationId) {
      const result = await executor.query<{ user_id: string }>(
        `SELECT user_id FROM account_deletion_operations
         WHERE id = $1 AND status <> 'not_started'`,
        [operationId]
      );
      return result.rows[0]?.user_id ?? null;
    },
    async getReferencedKeys(userId) {
      const result = await executor.query<{ object_key: string }>(
        `SELECT object_key FROM (
           SELECT avatar_object_key AS object_key FROM profiles WHERE user_id = $1
           UNION SELECT cover_object_key FROM profiles WHERE user_id = $1
           UNION SELECT image_object_key FROM polls WHERE author_id = $1
         ) media WHERE object_key IS NOT NULL`,
        [userId]
      );
      return result.rows.map((row) => row.object_key);
    },
    async addManifest(operationId, userId, objects) {
      if (!objects.length) return;
      await executor.query(
        `INSERT INTO account_deletion_media_manifest (operation_id, owner_user_id, object_key, version_id)
         SELECT $1, $2, item.object_key, item.version_id
         FROM unnest($3::text[], $4::text[]) AS item(object_key, version_id)
         ON CONFLICT (operation_id, object_key, version_id) DO NOTHING`,
        [operationId, userId, objects.map(({ key }) => key), objects.map(({ versionId }) => versionId ?? null)]
      );
    },
    async claimManifest(operationId, limit) {
      return withTransaction(async (client) => {
        const result = await client.query<{ object_key: string; version_id: string | null }>(
          `SELECT object_key, version_id FROM account_deletion_media_manifest
           WHERE operation_id = $1 AND status <> 'completed' AND available_at <= now()
           ORDER BY created_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
          [operationId, limit]
        );
        return result.rows.map((row) => ({ key: row.object_key, versionId: row.version_id ?? undefined }));
      });
    },
    async markManifestCompleted(operationId, objects) {
      if (!objects.length) return;
      await executor.query(
        `UPDATE account_deletion_media_manifest manifest
         SET status = 'completed', completed_at = now(), last_error_code = NULL, last_failed_at = NULL
         FROM unnest($2::text[], $3::text[]) AS item(object_key, version_id)
         WHERE manifest.operation_id = $1 AND manifest.object_key = item.object_key
           AND manifest.version_id IS NOT DISTINCT FROM item.version_id`,
        [operationId, objects.map(({ key }) => key), objects.map(({ versionId }) => versionId ?? null)]
      );
    },
    async markManifestRetrying(operationId, objects, code) {
      if (!objects.length) return;
      await executor.query(
        `UPDATE account_deletion_media_manifest manifest
         SET status = 'retrying', attempts = attempts + 1,
             available_at = now() + interval '5 seconds', last_error_code = $4,
             last_failed_at = COALESCE(last_failed_at, now())
         FROM unnest($2::text[], $3::text[]) AS item(object_key, version_id)
         WHERE manifest.operation_id = $1 AND manifest.object_key = item.object_key
           AND manifest.version_id IS NOT DISTINCT FROM item.version_id`,
        [operationId, objects.map(({ key }) => key), objects.map(({ versionId }) => versionId ?? null), code]
      );
    },
    async hasUncompletedManifest(operationId) {
      const result = await executor.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM account_deletion_media_manifest
         WHERE operation_id = $1 AND status <> 'completed') AS exists`,
        [operationId]
      );
      return result.rows[0]?.exists ?? false;
    },
    async getManifestKeys(operationId) {
      const result = await executor.query<{ object_key: string }>(
        'SELECT DISTINCT object_key FROM account_deletion_media_manifest WHERE operation_id = $1',
        [operationId]
      );
      return result.rows.map((row) => row.object_key);
    }
  };
}

export function createAccountDeletionMediaService(dependencies: AccountDeletionMediaDependencies) {
  return {
    async discoverAccountMedia(operationId: string): Promise<{ done: boolean }> {
      const userId = await dependencies.repository.getOwner(operationId);
      if (!userId) throw new Error('account_deletion_operation_not_found');

      const referencedKeys = await dependencies.repository.getReferencedKeys(userId);

      for (const prefix of ownedPrefixes(userId)) {
        let keyMarker: string | undefined;
        let versionIdMarker: string | undefined;
        do {
          const page = await dependencies.storage.listObjectVersions(prefix, { keyMarker, versionIdMarker });
          const owned = page.objects.filter((object) => isWithinOwnedPrefix(object.key, prefix));
          await dependencies.repository.addManifest(operationId, userId, owned);
          if (page.isTruncated
            && (!page.nextKeyMarker
              || (page.nextKeyMarker === keyMarker && page.nextVersionIdMarker === versionIdMarker))) {
            throw new Error('storage_version_listing_cursor_invalid');
          }
          keyMarker = page.nextKeyMarker;
          versionIdMarker = page.nextVersionIdMarker;
          if (!page.isTruncated) break;
        } while (true);
      }

      const prefixes = ownedPrefixes(userId);
      const knownKeys = new Set([
        ...referencedKeys,
        ...await dependencies.repository.getManifestKeys(operationId)
      ]);
      for (const key of knownKeys) {
        if (prefixes.some((prefix) => isWithinOwnedPrefix(key, prefix))) continue;
        const versions = await listExactKeyVersions(dependencies.storage, key);
        if (versions.length) await dependencies.repository.addManifest(operationId, userId, versions);
      }
      return { done: true };
    },
    async purgeAccountMedia(operationId: string): Promise<{ done: boolean }> {
      const objects = await dependencies.repository.claimManifest(operationId, MEDIA_BATCH_SIZE);
      if (objects.length) {
        try {
          await dependencies.storage.deleteObjects(objects);
          await dependencies.repository.markManifestCompleted(operationId, objects);
        } catch {
          await dependencies.repository.markManifestRetrying(operationId, objects, 'storage_delete_failed');
          return { done: false };
        }
        return { done: false };
      }
      return { done: !(await dependencies.repository.hasUncompletedManifest(operationId)) };
    },
    async verifyAccountMediaEmpty(operationId: string): Promise<boolean> {
      const userId = await dependencies.repository.getOwner(operationId);
      if (!userId || await dependencies.repository.hasUncompletedManifest(operationId)) return false;

      const prefixes = ownedPrefixes(userId);
      for (const prefix of prefixes) {
        let keyMarker: string | undefined;
        let versionIdMarker: string | undefined;
        do {
          const page = await dependencies.storage.listObjectVersions(prefix, { keyMarker, versionIdMarker });
          if (page.objects.some((object) => isWithinOwnedPrefix(object.key, prefix))) return false;
          if (page.isTruncated
            && (!page.nextKeyMarker
              || (page.nextKeyMarker === keyMarker && page.nextVersionIdMarker === versionIdMarker))) {
            throw new Error('storage_version_listing_cursor_invalid');
          }
          keyMarker = page.nextKeyMarker;
          versionIdMarker = page.nextVersionIdMarker;
          if (!page.isTruncated) break;
        } while (true);
      }

      const namespaced = new Set(prefixes);
      const keys = new Set([
        ...await dependencies.repository.getReferencedKeys(userId),
        ...await dependencies.repository.getManifestKeys(operationId)
      ]);
      for (const key of keys) {
        if ([...namespaced].some((prefix) => isWithinOwnedPrefix(key, prefix))) continue;
        if ((await listExactKeyVersions(dependencies.storage, key)).length > 0) return false;
      }
      return true;
    }
  };
}

const mediaService = createAccountDeletionMediaService({
  repository: createDatabaseRepository(),
  storage: {
    listObjectVersions,
    deleteObjects: deleteObjectVersions
  }
});

export const discoverAccountMedia = mediaService.discoverAccountMedia;
export const purgeAccountMedia = mediaService.purgeAccountMedia;
export const verifyAccountMediaEmpty = mediaService.verifyAccountMediaEmpty;
