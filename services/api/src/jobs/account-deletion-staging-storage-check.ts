import {
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { pathToFileURL } from 'node:url';

type BucketVersioning = { Status?: string };
type ObjectLockConfiguration = {
  ObjectLockEnabled?: string;
  Rule?: { DefaultRetention?: { Mode?: string; Days?: number; Years?: number } };
};
type LifecycleConfiguration = {
  Rules?: Array<{
    Status?: string;
    Filter?: { Prefix?: string; And?: { Prefix?: string } };
    Prefix?: string;
    Expiration?: { Days?: number };
    NoncurrentVersionExpiration?: { NoncurrentDays?: number };
  }>;
};

function checkError(name: string, reason: string): Error {
  return new Error(`account_deletion_storage_check:${name}:${reason}`);
}

export function assertObjectLockReady(
  name: string,
  config: { versioning?: BucketVersioning; objectLock?: ObjectLockConfiguration }
) {
  if (config.versioning?.Status !== 'Enabled') throw checkError(name, 'versioning_not_enabled');
  const retention = config.objectLock?.Rule?.DefaultRetention;
  const atLeast35Days = retention?.Days !== undefined
    ? retention.Days >= 35
    : (retention?.Years ?? 0) >= 1;
  if (config.objectLock?.ObjectLockEnabled !== 'Enabled' || retention?.Mode !== 'COMPLIANCE' || !atLeast35Days) {
    throw checkError(name, 'compliance_retention_below_35_days');
  }
}

function coversEntireBucket(rule: NonNullable<LifecycleConfiguration['Rules']>[number]) {
  if (rule.Filter?.And || (rule.Filter && Object.keys(rule.Filter).some((key) => key !== 'Prefix'))) return false;
  const prefix = rule.Filter?.And?.Prefix ?? rule.Filter?.Prefix ?? rule.Prefix ?? '';
  return prefix === '';
}

export function assertBackupLifecycle(name: string, config: LifecycleConfiguration) {
  const rules = (config.Rules ?? []).filter((rule) => rule.Status === 'Enabled' && coversEntireBucket(rule));
  const currentExpiryDays = rules
    .map((rule) => rule.Expiration?.Days)
    .filter((days): days is number => days !== undefined);
  const noncurrentExpiryDays = rules
    .map((rule) => rule.NoncurrentVersionExpiration?.NoncurrentDays)
    .filter((days): days is number => days !== undefined);
  if (currentExpiryDays.length === 0 || Math.max(...currentExpiryDays) > 30) {
    throw checkError(name, 'current_expiry_missing_or_after_30_days');
  }
  if (noncurrentExpiryDays.length === 0 || Math.max(...noncurrentExpiryDays) > 30) {
    throw checkError(name, 'noncurrent_expiry_missing_or_after_30_days');
  }
}

export function assertStorageSeparation(config: {
  journalEndpoint: string;
  checkpointEndpoint: string;
  backupEndpoint: string;
  journalBucket: string;
  checkpointBucket: string;
  backupBucket: string;
}) {
  if (config.journalEndpoint === config.checkpointEndpoint ||
      config.journalEndpoint === config.backupEndpoint ||
      config.journalBucket === config.checkpointBucket ||
      config.journalBucket === config.backupBucket ||
      config.checkpointBucket === config.backupBucket) {
    throw checkError('journal_checkpoint', 'stores_must_be_distinct');
  }
}

function required(name: string) {
  const value = process.env[name];
  if (!value || value.startsWith('replace-with-') || value.includes('<') || value.includes('>')) {
    throw new Error(`account_deletion_storage_check:missing_${name}`);
  }
  return value;
}

function makeClient(prefix: string) {
  const endpoint = required(`${prefix}_ENDPOINT`);
  const region = process.env[`${prefix}_REGION`] || 'us-east-1';
  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: required(`${prefix}_ACCESS_KEY_ID`),
      secretAccessKey: required(`${prefix}_SECRET_ACCESS_KEY`)
    }
  });
}

async function checkLockedBucket(name: string, client: S3Client, bucket: string) {
  const [versioning, objectLock] = await Promise.all([
    client.send(new GetBucketVersioningCommand({ Bucket: bucket })),
    client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }))
  ]);
  assertObjectLockReady(name, { versioning, objectLock: objectLock.ObjectLockConfiguration });
  console.log(`account_deletion_storage_check:${name}:ok`);
}

async function checkBackupBucket(client: S3Client, bucket: string) {
  const lifecycle = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
  assertBackupLifecycle('backups', lifecycle);
  console.log('account_deletion_storage_check:backups:ok');
}

export async function checkAccountDeletionStagingStorage() {
  const journalEndpoint = required('ACCOUNT_DELETION_JOURNAL_ENDPOINT');
  const checkpointEndpoint = required('ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ENDPOINT');
  const journalBucket = required('ACCOUNT_DELETION_JOURNAL_BUCKET');
  const checkpointBucket = required('ACCOUNT_DELETION_JOURNAL_CHECKPOINT_BUCKET');
  const backupEndpoint = required('STAGING_BACKUP_ENDPOINT');
  const backupBucket = required('STAGING_BACKUP_BUCKET');
  assertStorageSeparation({
    journalEndpoint, checkpointEndpoint, backupEndpoint,
    journalBucket, checkpointBucket, backupBucket
  });
  const journal = makeClient('ACCOUNT_DELETION_JOURNAL');
  const checkpoint = makeClient('ACCOUNT_DELETION_JOURNAL_CHECKPOINT');
  const backups = makeClient('STAGING_BACKUP');
  try {
    await checkLockedBucket('journal', journal, journalBucket);
    await checkLockedBucket('checkpoint', checkpoint, checkpointBucket);
    await checkBackupBucket(backups, backupBucket);
  } finally {
    journal.destroy();
    checkpoint.destroy();
    backups.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkAccountDeletionStagingStorage().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown_error';
    console.error(message);
    process.exitCode = 1;
  });
}
