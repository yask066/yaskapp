import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';


export type AccountDeletionJournalAcceptance = {
  operationId: string;
  userId: string;
  acceptedAt: Date;
  deadlineAt: Date;
};

export type AccountDeletionJournalEntry = {
  version: 1;
  state: 'prepared' | 'accepted' | 'checkpoint';
  operationId: string;
  intentId: string;
  userId: string;
  acceptedAt: string;
  deadlineAt: string;
  hmac: string;
};

const JOURNAL_PREFIX = 'account-deletions/';
const JOURNAL_RETENTION_MS = 35 * 24 * 60 * 60_000;

function journalPayload(entry: Omit<AccountDeletionJournalEntry, 'hmac'>) {
  return JSON.stringify({
    version: entry.version,
    state: entry.state,
    operationId: entry.operationId,
    intentId: entry.intentId,
    userId: entry.userId,
    acceptedAt: entry.acceptedAt,
    deadlineAt: entry.deadlineAt
  });
}

export function createJournalEntry(
  acceptance: AccountDeletionJournalAcceptance,
  signingKey: string,
  state: AccountDeletionJournalEntry['state'] = 'accepted'
): AccountDeletionJournalEntry {
  if (signingKey.length < 32) throw new Error('account_deletion_journal_hmac_key_too_short');
  const entry = {
    version: 1 as const,
    state,
    operationId: acceptance.operationId,
    intentId: createHash('sha256').update(`${acceptance.operationId}\n${acceptance.acceptedAt.toISOString()}`).digest('hex'),
    userId: acceptance.userId,
    acceptedAt: acceptance.acceptedAt.toISOString(),
    deadlineAt: acceptance.deadlineAt.toISOString()
  };
  return { ...entry, hmac: createHmac('sha256', signingKey).update(journalPayload(entry)).digest('hex') };
}

export function verifyJournalEntry(value: unknown, signingKey: string): value is AccountDeletionJournalEntry {
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'acceptedAt,deadlineAt,hmac,intentId,operationId,state,userId,version') return false;
  if (signingKey.length < 32) return false;
  const entry = value as Partial<AccountDeletionJournalEntry>;
  if (
    entry.version !== 1 ||
    (entry.state !== 'prepared' && entry.state !== 'accepted' && entry.state !== 'checkpoint') ||
    typeof entry.operationId !== 'string' ||
    typeof entry.intentId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(entry.intentId) ||
    typeof entry.userId !== 'string' ||
    typeof entry.acceptedAt !== 'string' ||
    typeof entry.deadlineAt !== 'string' ||
    typeof entry.hmac !== 'string' ||
    !Number.isFinite(Date.parse(entry.acceptedAt)) ||
    !Number.isFinite(Date.parse(entry.deadlineAt)) ||
    Date.parse(entry.deadlineAt) < Date.parse(entry.acceptedAt)
  ) return false;
  if (entry.intentId !== createHash('sha256').update(`${entry.operationId}\n${entry.acceptedAt}`).digest('hex')) return false;

  const unsigned = {
    version: entry.version,
    state: entry.state,
    operationId: entry.operationId,
    intentId: entry.intentId,
    userId: entry.userId,
    acceptedAt: entry.acceptedAt,
    deadlineAt: entry.deadlineAt
  };
  const expected = createHmac('sha256', signingKey).update(journalPayload(unsigned)).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(entry.hmac, 'hex');
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type AccountDeletionJournal = {
  initialize(): Promise<void>;
  assertReady(): Promise<void>;
  writePrepared(acceptance: AccountDeletionJournalAcceptance): Promise<void>;
  writeAccepted(acceptance: AccountDeletionJournalAcceptance): Promise<void>;
  writeCheckpoint(acceptance: AccountDeletionJournalAcceptance): Promise<void>;
  deletePrepared(operationId: string): Promise<void>;
  deletePreparedIntent(operationId: string, intentId: string): Promise<void>;
  deleteAccepted(operationId: string): Promise<void>;
  cleanupStalePrepared(now: Date): Promise<number>;
  readAll(): Promise<AccountDeletionJournalEntry[]>;
  close(): void;
};

export function createAccountDeletionJournal(options: {
  client: S3Client;
  bucket: string;
  checkpointClient: S3Client;
  checkpointBucket: string;
  journalId: string;
  signingKey: string;
}): AccountDeletionJournal {
  const readyKey = `${JOURNAL_PREFIX}meta/${options.journalId}.ready.json`;
  const markerPayload = JSON.stringify({ version: 1, journalId: options.journalId });
  const marker = JSON.stringify({ version: 1, journalId: options.journalId,
    hmac: createHmac('sha256', options.signingKey).update(markerPayload).digest('hex') });

  async function getObject(client: S3Client, bucket: string, key: string) {
    return client.send(new GetObjectCommand({ Bucket: bucket, Key: key })).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && '$metadata' in error &&
          typeof error.$metadata === 'object' && error.$metadata !== null &&
          'httpStatusCode' in error.$metadata && error.$metadata.httpStatusCode === 404) return null;
      if (error instanceof Error && error.name === 'NoSuchKey') return null;
      throw error;
    });
  }

  async function putImmutable(
    client: S3Client,
    bucket: string,
    key: string,
    body: string,
    conflictCode: string,
    retainUntil: Date
  ) {
    const existing = await getObject(client, bucket, key);
    if (existing?.Body) {
      if (await existing.Body.transformToString() === body) return;
      throw new Error(conflictCode);
    }
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body, ContentType: 'application/json',
      ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: retainUntil
    }));
    const saved = await getObject(client, bucket, key);
    if (!saved?.Body || await saved.Body.transformToString() !== body) {
      throw new Error('account_deletion_journal_write_unconfirmed');
    }
  }

  async function deleteAllVersions(client: S3Client, bucket: string, key: string) {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    const versionsToDelete: string[] = [];
    do {
      const page = await client.send(new ListObjectVersionsCommand({
        Bucket: bucket, Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker
      }));
      const versions = [ ...(page.Versions ?? []), ...(page.DeleteMarkers ?? []) ]
        .filter((version) => version.Key === key);
      for (const version of versions) {
        if (!version.VersionId) throw new Error('account_deletion_journal_versioning_unavailable');
        versionsToDelete.push(version.VersionId);
      }
      if (page.IsTruncated && (!page.NextKeyMarker || !page.NextVersionIdMarker)) {
        throw new Error('account_deletion_journal_version_listing_incomplete');
      }
      keyMarker = page.NextKeyMarker;
      versionIdMarker = page.NextVersionIdMarker;
    } while (keyMarker && versionIdMarker);
    for (const versionId of versionsToDelete) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
    }
  }

  function operationKey(state: AccountDeletionJournalEntry['state'], operationId: string, intentId?: string) {
    if (state === 'prepared') {
      if (!intentId) throw new Error('account_deletion_journal_intent_id_missing');
      return `${JOURNAL_PREFIX}prepared/${operationId}/${intentId}.json`;
    }
    return `${JOURNAL_PREFIX}${state}/${operationId}.json`;
  }

  return {
    async initialize() {
      if (options.signingKey.length < 32 || !options.journalId) throw new Error('account_deletion_journal_configuration_invalid');
      const markerRetention = new Date(Date.now() + 50 * 365 * 24 * 60 * 60_000);
      await putImmutable(options.client, options.bucket, readyKey, marker, 'account_deletion_journal_identity_conflict', markerRetention);
      await putImmutable(options.checkpointClient, options.checkpointBucket, readyKey, marker, 'account_deletion_checkpoint_identity_conflict', markerRetention);
    },

    async assertReady() {
      const ready = await getObject(options.client, options.bucket, readyKey);
      const checkpointReady = await getObject(options.checkpointClient, options.checkpointBucket, readyKey);
      if (!ready?.Body || await ready.Body.transformToString() !== marker ||
          !checkpointReady?.Body || await checkpointReady.Body.transformToString() !== marker) {
        throw new Error('account_deletion_journal_not_initialized');
      }
    },

    async writePrepared(acceptance) {
      const entry = createJournalEntry(acceptance, options.signingKey, 'prepared');
      await putImmutable(options.client, options.bucket, operationKey('prepared', entry.operationId, entry.intentId), JSON.stringify(entry), 'account_deletion_journal_conflict',
        new Date(acceptance.acceptedAt.getTime() + JOURNAL_RETENTION_MS));
    },

    async writeAccepted(acceptance) {
      const entry = createJournalEntry(acceptance, options.signingKey, 'accepted');
      await putImmutable(options.client, options.bucket, operationKey('accepted', entry.operationId), JSON.stringify(entry), 'account_deletion_journal_conflict',
        new Date(acceptance.acceptedAt.getTime() + JOURNAL_RETENTION_MS));
    },

    async writeCheckpoint(acceptance) {
      const entry = createJournalEntry(acceptance, options.signingKey, 'checkpoint');
      await putImmutable(options.checkpointClient, options.checkpointBucket, operationKey('checkpoint', entry.operationId), JSON.stringify(entry), 'account_deletion_journal_checkpoint_conflict',
        new Date(acceptance.acceptedAt.getTime() + JOURNAL_RETENTION_MS));
    },

    async deletePrepared(operationId) {
      let continuationToken: string | undefined;
      const keys: string[] = [];
      do {
        const page = await options.client.send(new ListObjectsV2Command({
          Bucket: options.bucket, Prefix: `${JOURNAL_PREFIX}prepared/${operationId}/`, ContinuationToken: continuationToken
        }));
        if (page.IsTruncated && !page.NextContinuationToken) throw new Error('account_deletion_journal_listing_incomplete');
        for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
        continuationToken = page.NextContinuationToken;
      } while (continuationToken);
      for (const key of keys) await deleteAllVersions(options.client, options.bucket, key);
    },

    async deletePreparedIntent(operationId, intentId) {
      await deleteAllVersions(options.client, options.bucket, operationKey('prepared', operationId, intentId));
    },

    async deleteAccepted(operationId) {
      await this.deletePrepared(operationId);
      await deleteAllVersions(options.client, options.bucket, operationKey('accepted', operationId));
      await deleteAllVersions(options.checkpointClient, options.checkpointBucket, operationKey('checkpoint', operationId));
    },

    async cleanupStalePrepared(now) {
      await this.assertReady();
      const staleIntents: Array<{ operationId: string; intentId: string }> = [];
      let continuationToken: string | undefined;
      do {
        const page = await options.client.send(new ListObjectsV2Command({
          Bucket: options.bucket, Prefix: `${JOURNAL_PREFIX}prepared/`, ContinuationToken: continuationToken
        }));
        if (page.IsTruncated && !page.NextContinuationToken) throw new Error('account_deletion_journal_listing_incomplete');
        for (const item of page.Contents ?? []) {
          if (!item.Key) throw new Error('account_deletion_journal_invalid_object');
          const object = await getObject(options.client, options.bucket, item.Key);
          if (!object?.Body) throw new Error('account_deletion_journal_empty_object');
          let parsed: unknown;
          try { parsed = JSON.parse(await object.Body.transformToString()); }
          catch { throw new Error('account_deletion_journal_invalid_json'); }
          if (!verifyJournalEntry(parsed, options.signingKey)) throw new Error('account_deletion_journal_integrity_failed');
          const entry = parsed as AccountDeletionJournalEntry;
          if (entry.state !== 'prepared' || item.Key !== operationKey('prepared', entry.operationId, entry.intentId)) {
            throw new Error('account_deletion_journal_key_mismatch');
          }
          if (Date.parse(entry.acceptedAt) > now.getTime() - JOURNAL_RETENTION_MS) continue;
          const accepted = await getObject(options.client, options.bucket, operationKey('accepted', entry.operationId));
          const checkpoint = await getObject(options.checkpointClient, options.checkpointBucket, operationKey('checkpoint', entry.operationId));
          let acceptedIntentId: string | null = null;
          if (accepted?.Body) {
            let parsedAccepted: unknown;
            try { parsedAccepted = JSON.parse(await accepted.Body.transformToString()); }
            catch { throw new Error('account_deletion_journal_invalid_json'); }
            if (!verifyJournalEntry(parsedAccepted, options.signingKey) || parsedAccepted.state !== 'accepted') {
              throw new Error('account_deletion_journal_integrity_failed');
            }
            acceptedIntentId = parsedAccepted.intentId;
          }
          if (acceptedIntentId !== entry.intentId && (acceptedIntentId !== null || !checkpoint)) {
            staleIntents.push({ operationId: entry.operationId, intentId: entry.intentId });
          }
        }
        continuationToken = page.NextContinuationToken;
      } while (continuationToken);
      for (const intent of staleIntents) await this.deletePreparedIntent(intent.operationId, intent.intentId);
      return staleIntents.length;
    },

    async readAll() {
      await this.assertReady();
      async function readEntries(client: S3Client, bucket: string, expectedStates: AccountDeletionJournalEntry['state'][]) {
        const entries: AccountDeletionJournalEntry[] = [];
        let continuationToken: string | undefined;
        do {
          const page = await client.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: JOURNAL_PREFIX,
            ContinuationToken: continuationToken
          }));
          if (page.IsTruncated && !page.NextContinuationToken) {
            throw new Error('account_deletion_journal_listing_incomplete');
          }
          for (const item of page.Contents ?? []) {
            if (!item.Key) throw new Error('account_deletion_journal_invalid_object');
            if (item.Key === readyKey) continue;
            const keyState = (['prepared', 'accepted', 'checkpoint'] as const)
              .find((state) => item.Key?.startsWith(`${JOURNAL_PREFIX}${state}/`));
            if (!item.Key.endsWith('.json') || !keyState) throw new Error('account_deletion_journal_invalid_object');
            if (!expectedStates.includes(keyState)) throw new Error('account_deletion_journal_key_mismatch');
            const object = await getObject(client, bucket, item.Key);
            if (!object?.Body) throw new Error('account_deletion_journal_empty_object');
            let parsed: unknown;
            try {
              parsed = JSON.parse(await object.Body.transformToString());
            } catch {
              throw new Error('account_deletion_journal_invalid_json');
            }
            if (!verifyJournalEntry(parsed, options.signingKey)) throw new Error('account_deletion_journal_integrity_failed');
            const entry = parsed as AccountDeletionJournalEntry;
            if (!expectedStates.includes(entry.state) || item.Key !== operationKey(entry.state, entry.operationId, entry.intentId)) {
              throw new Error('account_deletion_journal_key_mismatch');
            }
            entries.push(entry);
          }
          continuationToken = page.NextContinuationToken;
        } while (continuationToken);
        return entries;
      }
      const entries = [
        ...await readEntries(options.client, options.bucket, ['prepared', 'accepted']),
        ...await readEntries(options.checkpointClient, options.checkpointBucket, ['checkpoint'])
      ];
      const prepared = new Map(entries.filter((entry) => entry.state === 'prepared').map((entry) => [`${entry.operationId}:${entry.intentId}`, entry]));
      const accepted = entries.filter((entry) => entry.state === 'accepted');
      const checkpoints = new Map(entries.filter((entry) => entry.state === 'checkpoint').map((entry) => [entry.operationId, entry]));
      for (const entry of accepted) {
        const intent = prepared.get(`${entry.operationId}:${entry.intentId}`);
        if (!intent || intent.userId !== entry.userId || intent.acceptedAt !== entry.acceptedAt || intent.deadlineAt !== entry.deadlineAt) {
          throw new Error('account_deletion_journal_incomplete');
        }
        const checkpoint = checkpoints.get(entry.operationId);
        if (!checkpoint || checkpoint.userId !== entry.userId || checkpoint.acceptedAt !== entry.acceptedAt || checkpoint.deadlineAt !== entry.deadlineAt) {
          throw new Error('account_deletion_journal_checkpoint_incomplete');
        }
        checkpoints.delete(entry.operationId);
      }
      const acceptedOperationIds = new Set(accepted.map((entry) => entry.operationId));
      if ([...prepared.values()].some((entry) => !acceptedOperationIds.has(entry.operationId))) {
        throw new Error('account_deletion_journal_incomplete');
      }
      if (checkpoints.size) throw new Error('account_deletion_journal_checkpoint_incomplete');
      return accepted;
    },

    close() {
      options.client.destroy();
      options.checkpointClient.destroy();
    }
  };
}

function configuredJournal(options: { retention?: boolean } = {}): AccountDeletionJournal {
  const endpoint = process.env.ACCOUNT_DELETION_JOURNAL_ENDPOINT;
  const bucket = process.env.ACCOUNT_DELETION_JOURNAL_BUCKET;
  const checkpointEndpoint = process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ENDPOINT;
  const checkpointBucket = process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_BUCKET;
  const checkpointAccessKeyId = process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ACCESS_KEY_ID;
  const checkpointSecretAccessKey = process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_SECRET_ACCESS_KEY;
  const accessKeyId = process.env.ACCOUNT_DELETION_JOURNAL_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ACCOUNT_DELETION_JOURNAL_SECRET_ACCESS_KEY;
  const retentionAccessKeyId = process.env.ACCOUNT_DELETION_JOURNAL_RETENTION_ACCESS_KEY_ID;
  const retentionSecretAccessKey = process.env.ACCOUNT_DELETION_JOURNAL_RETENTION_SECRET_ACCESS_KEY;
  const checkpointRetentionAccessKeyId = process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_RETENTION_ACCESS_KEY_ID;
  const checkpointRetentionSecretAccessKey = process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_RETENTION_SECRET_ACCESS_KEY;
  const signingKey = process.env.ACCOUNT_DELETION_JOURNAL_HMAC_KEY;
  const journalId = process.env.ACCOUNT_DELETION_JOURNAL_ID;
  const selectedAccessKeyId = options.retention ? retentionAccessKeyId : accessKeyId;
  const selectedSecretAccessKey = options.retention ? retentionSecretAccessKey : secretAccessKey;
  const selectedCheckpointAccessKeyId = options.retention ? checkpointRetentionAccessKeyId : checkpointAccessKeyId;
  const selectedCheckpointSecretAccessKey = options.retention ? checkpointRetentionSecretAccessKey : checkpointSecretAccessKey;
  if (!endpoint || !bucket || !checkpointEndpoint || !checkpointBucket || !selectedCheckpointAccessKeyId ||
      !selectedCheckpointSecretAccessKey || !selectedAccessKeyId || !selectedSecretAccessKey || !signingKey || !journalId) {
    throw new Error('account_deletion_journal_unavailable');
  }
  return createAccountDeletionJournal({
    bucket,
    journalId,
    signingKey,
    client: new S3Client({
      endpoint,
      region: process.env.ACCOUNT_DELETION_JOURNAL_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: selectedAccessKeyId, secretAccessKey: selectedSecretAccessKey }
    }),
    checkpointBucket,
    checkpointClient: new S3Client({
      endpoint: checkpointEndpoint,
      region: process.env.ACCOUNT_DELETION_JOURNAL_CHECKPOINT_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: selectedCheckpointAccessKeyId, secretAccessKey: selectedCheckpointSecretAccessKey }
    })
  });
}

async function withConfiguredJournal<T>(run: (journal: AccountDeletionJournal) => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return undefined as T;
  const journal = configuredJournal();
  try {
    return await run(journal);
  } finally {
    journal.close();
  }
}

export async function initializeAccountDeletionJournal() {
  return withConfiguredJournal((journal) => journal.initialize());
}

export async function prepareDeletionInJournal(acceptance: AccountDeletionJournalAcceptance) {
  return withConfiguredJournal(async (journal) => {
    await journal.assertReady();
    await journal.writePrepared(acceptance);
  });
}

export async function acceptDeletionInJournal(acceptance: AccountDeletionJournalAcceptance) {
  return withConfiguredJournal(async (journal) => {
    await journal.assertReady();
    await journal.writePrepared(acceptance);
    await journal.writeAccepted(acceptance);
    await journal.writeCheckpoint(acceptance);
  });
}

export async function writeAcceptedDeletionToJournal(acceptance: AccountDeletionJournalAcceptance) {
  return acceptDeletionInJournal(acceptance);
}

export async function readAcceptedDeletionsFromJournal() {
  const journal = configuredJournal();
  try {
    return await journal.readAll();
  } finally {
    journal.close();
  }
}

export async function exportAcceptedDeletionsToJournal(executor: {
  query<T>(sql: string): Promise<{ rows: T[] }>;
}) {
  const cleanup = await cleanupExpiredCompletedDeletionJournal(executor);
  const accepted = await executor.query<{
    id: string;
    user_id: string;
    accepted_at: Date;
    deadline_at: Date;
  }>(`SELECT id, user_id, accepted_at, deadline_at FROM account_deletion_operations
      WHERE accepted_at IS NOT NULL AND deadline_at IS NOT NULL
        AND (status <> 'completed' OR accepted_at > now() - interval '35 days')
      ORDER BY accepted_at, id`);
  for (const row of accepted.rows) {
    await acceptDeletionInJournal({
      operationId: row.id,
      userId: row.user_id,
      acceptedAt: new Date(row.accepted_at),
      deadlineAt: new Date(row.deadline_at)
    });
  }
  const journalEntries = await readAcceptedDeletionsFromJournal();
  const journalById = new Map(journalEntries.map((entry) => [entry.operationId, entry]));
  for (const row of accepted.rows) {
    const entry = journalById.get(row.id);
    if (
      !entry || entry.userId !== row.user_id ||
      Date.parse(entry.acceptedAt) > new Date(row.accepted_at).getTime() ||
      Date.parse(entry.deadlineAt) > new Date(row.deadline_at).getTime()
    ) {
      throw new Error('account_deletion_journal_export_incomplete');
    }
  }
  return { exported: accepted.rows.length, journalEntries: journalEntries.length, cleaned: cleanup.deleted };
}

export async function cleanupExpiredCompletedDeletionJournal(
  executor: { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> },
  now = new Date()
) {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return { deleted: 0 };
  const completed = await executor.query<{ id: string }>(
    `SELECT id FROM account_deletion_operations
     WHERE status = 'completed' AND accepted_at <= $1::timestamptz - interval '35 days'`, [now]
  );
  const prepared = await executor.query<{ id: string }>(
    `SELECT operation.id FROM account_deletion_operations operation
     WHERE operation.status = 'not_started' AND NOT EXISTS (
       SELECT 1 FROM account_deletion_permissions permission
       WHERE permission.operation_id = operation.id AND permission.expires_at > $1
     )`, [now]
  );
  const journalConfigured = !!process.env.ACCOUNT_DELETION_JOURNAL_ENDPOINT;
  if (!completed.rows.length && !prepared.rows.length && !journalConfigured) return { deleted: 0 };

  const journal = configuredJournal({ retention: true });
  try {
    const stalePrepared = await journal.cleanupStalePrepared(now);
    for (const operation of completed.rows) await journal.deleteAccepted(operation.id);
    return { deleted: completed.rows.length + stalePrepared };
  } finally {
    journal.close();
  }
}
