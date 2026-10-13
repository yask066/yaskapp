import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

import { env } from './env.js';

export const storage = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY
  }
});

export const mediaBucket = env.S3_BUCKET;

export async function putObject(input: {
  key: string;
  body: Uint8Array;
  contentType?: string;
}) {
  await storage.send(
    new PutObjectCommand({
      Bucket: mediaBucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType
    })
  );
}

export async function deleteObject(key: string) {
  await storage.send(
    new DeleteObjectCommand({
      Bucket: mediaBucket,
      Key: key
    })
  );
}

export type StorageObject = {
  key: string;
  lastModified: Date | undefined;
};

export async function listObjects(prefix: string): Promise<StorageObject[]> {
  const objects: StorageObject[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await storage.send(
      new ListObjectsV2Command({
        Bucket: mediaBucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );

    for (const object of response.Contents ?? []) {
      if (object.Key) {
        objects.push({
          key: object.Key,
          lastModified: object.LastModified
        });
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

export async function deleteObjects(keys: string[]) {
  for (let offset = 0; offset < keys.length; offset += 1_000) {
    const response = await storage.send(
      new DeleteObjectsCommand({
        Bucket: mediaBucket,
        Delete: {
          Objects: keys.slice(offset, offset + 1_000).map((key) => ({ Key: key })),
          Quiet: true
        }
      })
    );
    if (response.Errors?.length) {
      throw new Error(`storage_batch_delete_failed:${response.Errors.length}`);
    }
  }
}

export type StorageObjectVersion = {
  key: string;
  versionId: string | undefined;
};

export type StorageObjectVersionPage = {
  objects: StorageObjectVersion[];
  isTruncated: boolean;
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
};

export async function listObjectVersions(
  prefix: string,
  markers: { keyMarker?: string; versionIdMarker?: string } = {}
): Promise<StorageObjectVersionPage> {
  const response = await storage.send(new ListObjectVersionsCommand({
    Bucket: mediaBucket,
    Prefix: prefix,
    KeyMarker: markers.keyMarker,
    VersionIdMarker: markers.versionIdMarker
  }));
  const objects: StorageObjectVersion[] = [];
  for (const entry of [...(response.Versions ?? []), ...(response.DeleteMarkers ?? [])]) {
    if (entry.Key) objects.push({ key: entry.Key, versionId: entry.VersionId });
  }
  return {
    objects,
    isTruncated: response.IsTruncated ?? false,
    nextKeyMarker: response.NextKeyMarker,
    nextVersionIdMarker: response.NextVersionIdMarker
  };
}

export async function deleteObjectVersions(objects: StorageObjectVersion[]) {
  for (let offset = 0; offset < objects.length; offset += 1_000) {
    const response = await storage.send(new DeleteObjectsCommand({
      Bucket: mediaBucket,
      Delete: {
        Objects: objects.slice(offset, offset + 1_000).map(({ key, versionId }) => ({
          Key: key,
          VersionId: versionId
        })),
        Quiet: true
      }
    }));
    if (response.Errors?.length) {
      throw new Error(`storage_batch_delete_failed:${response.Errors.length}`);
    }
  }
}

export async function getObject(key: string) {
  return storage.send(
    new GetObjectCommand({
      Bucket: mediaBucket,
      Key: key
    })
  );
}

export async function checkStorageConnection() {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 2_000);
  timeout.unref();

  try {
    await storage.send(
      new HeadBucketCommand({ Bucket: mediaBucket }),
      { abortSignal: abortController.signal }
    );
  } finally {
    clearTimeout(timeout);
  }

  return {
    connected: true,
    bucket: mediaBucket
  };
}

export function closeStorageConnection() {
  storage.destroy();
}
