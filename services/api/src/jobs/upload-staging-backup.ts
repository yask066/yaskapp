import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function required(name: string) {
  const value = process.env[name];
  if (!value || value.startsWith('replace-with-') || value.includes('<') || value.includes('>')) {
    throw new Error(`missing_${name}`);
  }
  return value;
}

export async function uploadStagingBackupFile(
  client: Pick<S3Client, 'send'>,
  bucket: string,
  filePath: string,
  objectKey: string
) {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw new Error('backup_source_not_a_file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  const sha256 = hash.digest('hex');

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: createReadStream(filePath),
    ContentLength: fileStats.size,
    ContentType: 'application/octet-stream',
    Metadata: { sha256 }
  }));

  const uploaded = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (uploaded.ContentLength !== fileStats.size || uploaded.Metadata?.sha256 !== sha256) {
    throw new Error('backup_upload_verification_failed');
  }
  return { bytes: fileStats.size, sha256 };
}

async function main() {
  const filename = process.argv[2] ?? '';
  if (filename !== basename(filename) || !/^yaskapp-staging-\d{8}T\d{6}Z\.dump$/.test(filename)) {
    throw new Error('invalid_backup_filename');
  }
  const endpoint = required('STAGING_BACKUP_ENDPOINT');
  const bucket = required('STAGING_BACKUP_BUCKET');
  const client = new S3Client({
    endpoint,
    region: process.env.STAGING_BACKUP_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: required('STAGING_BACKUP_ACCESS_KEY_ID'),
      secretAccessKey: required('STAGING_BACKUP_SECRET_ACCESS_KEY')
    }
  });
  try {
    const result = await uploadStagingBackupFile(
      client,
      bucket,
      resolve('/backups', filename),
      `postgres/${filename}`
    );
    console.log(`staging_backup_upload:ok:${result.bytes}:${result.sha256}`);
  } finally {
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('staging_backup_upload:failed');
    process.exitCode = 1;
  });
}
