import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client
} from '@aws-sdk/client-s3';

const JOURNAL_PREFIX = 'account-deletions/';

export type LegacyAccountDeletionJournalEntry = {
  version: 1;
  state: 'prepared' | 'accepted' | 'checkpoint';
  operationId: string;
  intentId: string;
  userId: string;
  acceptedAt: string;
  deadlineAt: string;
  hmac: string;
};

export type LegacyAccountDeletionJournalInventory = {
  entries: unknown[];
  checkpoints: unknown[];
};

export type LegacyAccountDeletionJournalSource = {
  readInventory(): Promise<LegacyAccountDeletionJournalInventory>;
  close?(): void;
};

type LegacyS3Store = Pick<S3Client, 'send'>;

export function verifyLegacyAccountDeletionJournalEntry(
  value: unknown,
  signingKey: string
): value is LegacyAccountDeletionJournalEntry {
  if (!value || typeof value !== 'object' || signingKey.length < 32) return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'acceptedAt,deadlineAt,hmac,intentId,operationId,state,userId,version') return false;
  const entry = value as Partial<LegacyAccountDeletionJournalEntry>;
  if (
    entry.version !== 1 ||
    (entry.state !== 'prepared' && entry.state !== 'accepted' && entry.state !== 'checkpoint') ||
    typeof entry.operationId !== 'string' || !entry.operationId ||
    typeof entry.intentId !== 'string' || !/^[a-f0-9]{64}$/.test(entry.intentId) ||
    typeof entry.userId !== 'string' || !entry.userId ||
    typeof entry.acceptedAt !== 'string' || !Number.isFinite(Date.parse(entry.acceptedAt)) ||
    typeof entry.deadlineAt !== 'string' || !Number.isFinite(Date.parse(entry.deadlineAt)) ||
    Date.parse(entry.deadlineAt) < Date.parse(entry.acceptedAt) ||
    typeof entry.hmac !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hmac)
  ) return false;
  if (entry.intentId !== createHash('sha256').update(`${entry.operationId}\n${entry.acceptedAt}`).digest('hex')) return false;

  const payload = JSON.stringify({
    version: entry.version,
    state: entry.state,
    operationId: entry.operationId,
    intentId: entry.intentId,
    userId: entry.userId,
    acceptedAt: entry.acceptedAt,
    deadlineAt: entry.deadlineAt
  });
  const expected = createHmac('sha256', signingKey).update(payload).digest();
  const actual = Buffer.from(entry.hmac, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('account_deletion_legacy_journal_invalid_json');
  }
}

async function readBody(client: LegacyS3Store, bucket: string, key: string): Promise<string | null> {
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw new Error('account_deletion_legacy_journal_empty_object');
    return await result.Body.transformToString();
  } catch (error) {
    if (typeof error === 'object' && error !== null && '$metadata' in error &&
      typeof error.$metadata === 'object' && error.$metadata !== null &&
      'httpStatusCode' in error.$metadata && error.$metadata.httpStatusCode === 404) return null;
    if (error instanceof Error && error.name === 'NoSuchKey') return null;
    throw error;
  }
}

async function assertLegacyReady(
  client: LegacyS3Store,
  bucket: string,
  journalId: string,
  signingKey: string
) {
  const readyKey = `${JOURNAL_PREFIX}meta/${journalId}.ready.json`;
  const raw = await readBody(client, bucket, readyKey);
  if (!raw) throw new Error('account_deletion_legacy_journal_not_initialized');
  const marker = parseJson(raw);
  if (!marker || typeof marker !== 'object') throw new Error('account_deletion_legacy_journal_identity_mismatch');
  if (Object.keys(marker).sort().join(',') !== 'hmac,journalId,version') {
    throw new Error('account_deletion_legacy_journal_identity_mismatch');
  }
  const value = marker as { version?: unknown; journalId?: unknown; hmac?: unknown };
  const payload = JSON.stringify({ version: 1, journalId });
  const expected = createHmac('sha256', signingKey).update(payload).digest();
  if (
    value.version !== 1 || value.journalId !== journalId || typeof value.hmac !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.hmac) ||
    !timingSafeEqual(Buffer.from(value.hmac, 'hex'), expected)
  ) throw new Error('account_deletion_legacy_journal_identity_mismatch');
}

function expectedKey(entry: LegacyAccountDeletionJournalEntry) {
  if (entry.state === 'prepared') {
    return `${JOURNAL_PREFIX}prepared/${entry.operationId}/${entry.intentId}.json`;
  }
  return `${JOURNAL_PREFIX}${entry.state}/${entry.operationId}.json`;
}

async function readStateObjects(
  client: LegacyS3Store,
  bucket: string,
  states: LegacyAccountDeletionJournalEntry['state'][],
  readyKey: string
): Promise<unknown[]> {
  const result: unknown[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: JOURNAL_PREFIX,
      ContinuationToken: continuationToken
    }));
    if (page.IsTruncated && !page.NextContinuationToken) {
      throw new Error('account_deletion_legacy_journal_listing_incomplete');
    }
    for (const item of page.Contents ?? []) {
      if (!item.Key) throw new Error('account_deletion_legacy_journal_invalid_object');
      if (item.Key === readyKey) continue;
      const state = states.find((candidate) => item.Key?.startsWith(`${JOURNAL_PREFIX}${candidate}/`));
      if (!item.Key.endsWith('.json') || !state) throw new Error('account_deletion_legacy_journal_invalid_object');
      const raw = await readBody(client, bucket, item.Key);
      if (!raw) throw new Error('account_deletion_legacy_journal_empty_object');
      const parsed = parseJson(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('account_deletion_legacy_journal_invalid_object');
      const entry = parsed as LegacyAccountDeletionJournalEntry;
      if (entry.state !== state || item.Key !== expectedKey(entry)) {
        throw new Error('account_deletion_legacy_journal_key_mismatch');
      }
      result.push(parsed);
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return result;
}

export function createLegacyS3AccountDeletionJournalSource(options: {
  journalClient: LegacyS3Store;
  journalBucket: string;
  checkpointClient: LegacyS3Store;
  checkpointBucket: string;
  journalId: string;
  signingKey: string;
  close?: () => void;
}): LegacyAccountDeletionJournalSource {
  return {
    async readInventory() {
      await Promise.all([
        assertLegacyReady(options.journalClient, options.journalBucket, options.journalId, options.signingKey),
        assertLegacyReady(options.checkpointClient, options.checkpointBucket, options.journalId, options.signingKey)
      ]);
      const [entries, checkpoints] = await Promise.all([
        readStateObjects(
          options.journalClient,
          options.journalBucket,
          ['prepared', 'accepted'],
          `${JOURNAL_PREFIX}meta/${options.journalId}.ready.json`
        ),
        readStateObjects(
          options.checkpointClient,
          options.checkpointBucket,
          ['checkpoint'],
          `${JOURNAL_PREFIX}meta/${options.journalId}.ready.json`
        )
      ]);
      return { entries, checkpoints };
    },
    close: options.close
  };
}

export function createLegacyS3AccountDeletionJournalSourceFromEnvironment(): LegacyAccountDeletionJournalSource {
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error('account_deletion_legacy_journal_unavailable');
    return value;
  };
  const journalEndpoint = required('ACCOUNT_DELETION_JOURNAL_ENDPOINT');
  const journalBucket = required('ACCOUNT_DELETION_JOURNAL_BUCKET');
  const journalAccessKeyId = required('ACCOUNT_DELETION_JOURNAL_ACCESS_KEY_ID');
  const journalSecretAccessKey = required('ACCOUNT_DELETION_JOURNAL_SECRET_ACCESS_KEY');
  const checkpointEndpoint = required('ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ENDPOINT');
  const checkpointBucket = required('ACCOUNT_DELETION_JOURNAL_CHECKPOINT_BUCKET');
  const checkpointAccessKeyId = required('ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ACCESS_KEY_ID');
  const checkpointSecretAccessKey = required('ACCOUNT_DELETION_JOURNAL_CHECKPOINT_SECRET_ACCESS_KEY');
  const journalId = required('ACCOUNT_DELETION_JOURNAL_ID');
  const signingKey = required('ACCOUNT_DELETION_JOURNAL_HMAC_KEY');
  if (signingKey.length < 32) throw new Error('account_deletion_journal_hmac_key_too_short');
  const journalClient = new S3Client({
    endpoint: journalEndpoint,
    region: process.env.ACCOUNT_DELETION_JOURNAL_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: journalAccessKeyId, secretAccessKey: journalSecretAccessKey }
  });
  const checkpointClient = new S3Client({
    endpoint: checkpointEndpoint,
    region: process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: checkpointAccessKeyId, secretAccessKey: checkpointSecretAccessKey }
  });
  return createLegacyS3AccountDeletionJournalSource({
    journalClient, journalBucket, checkpointClient, checkpointBucket, journalId, signingKey,
    close: () => { journalClient.destroy(); checkpointClient.destroy(); }
  });
}
