import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  GetObjectCommand,
  ListObjectsV2Command,
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
  operationId: string;
  userId: string;
  acceptedAt: string;
  deadlineAt: string;
  hmac: string;
};

const JOURNAL_PREFIX = 'account-deletions/';

function journalPayload(entry: Omit<AccountDeletionJournalEntry, 'hmac'>) {
  return JSON.stringify({
    version: entry.version,
    operationId: entry.operationId,
    userId: entry.userId,
    acceptedAt: entry.acceptedAt,
    deadlineAt: entry.deadlineAt
  });
}

export function createJournalEntry(
  acceptance: AccountDeletionJournalAcceptance,
  signingKey: string
): AccountDeletionJournalEntry {
  if (signingKey.length < 32) throw new Error('account_deletion_journal_hmac_key_too_short');
  const entry = {
    version: 1 as const,
    operationId: acceptance.operationId,
    userId: acceptance.userId,
    acceptedAt: acceptance.acceptedAt.toISOString(),
    deadlineAt: acceptance.deadlineAt.toISOString()
  };
  return { ...entry, hmac: createHmac('sha256', signingKey).update(journalPayload(entry)).digest('hex') };
}

export function verifyJournalEntry(value: unknown, signingKey: string): value is AccountDeletionJournalEntry {
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'acceptedAt,deadlineAt,hmac,operationId,userId,version') return false;
  if (signingKey.length < 32) return false;
  const entry = value as Partial<AccountDeletionJournalEntry>;
  if (
    entry.version !== 1 ||
    typeof entry.operationId !== 'string' ||
    typeof entry.userId !== 'string' ||
    typeof entry.acceptedAt !== 'string' ||
    typeof entry.deadlineAt !== 'string' ||
    typeof entry.hmac !== 'string' ||
    !Number.isFinite(Date.parse(entry.acceptedAt)) ||
    !Number.isFinite(Date.parse(entry.deadlineAt)) ||
    Date.parse(entry.deadlineAt) < Date.parse(entry.acceptedAt)
  ) return false;

  const unsigned = {
    version: entry.version,
    operationId: entry.operationId,
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
  writeAcceptance(acceptance: AccountDeletionJournalAcceptance): Promise<void>;
  readAll(): Promise<AccountDeletionJournalEntry[]>;
  close(): void;
};

export function createAccountDeletionJournal(options: {
  client: S3Client;
  bucket: string;
  signingKey: string;
}): AccountDeletionJournal {
  return {
    async writeAcceptance(acceptance) {
      const entry = createJournalEntry(acceptance, options.signingKey);
      const key = `${JOURNAL_PREFIX}${entry.operationId}.json`;
      const body = JSON.stringify(entry);
      const existing = await options.client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key })).catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && '$metadata' in error &&
            typeof error.$metadata === 'object' && error.$metadata !== null &&
            'httpStatusCode' in error.$metadata && error.$metadata.httpStatusCode === 404) return null;
        if (error instanceof Error && error.name === 'NoSuchKey') return null;
        throw error;
      });
      if (existing?.Body) {
        const stored = await existing.Body.transformToString();
        if (stored === body) return;
        let previous: unknown;
        try {
          previous = JSON.parse(stored);
        } catch {
          throw new Error('account_deletion_journal_invalid_json');
        }
        if (!verifyJournalEntry(previous, options.signingKey) || previous.userId !== entry.userId) {
          throw new Error('account_deletion_journal_conflict');
        }
        // A prior attempt may have durably prepared this same operation before
        // its database commit outcome was known. Preserve that conservative record.
        return;
      }
      await options.client.send(new PutObjectCommand({
        Bucket: options.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/json'
      }));
    },

    async readAll() {
      const entries: AccountDeletionJournalEntry[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await options.client.send(new ListObjectsV2Command({
          Bucket: options.bucket,
          Prefix: JOURNAL_PREFIX,
          ContinuationToken: continuationToken
        }));
        if (page.IsTruncated && !page.NextContinuationToken) {
          throw new Error('account_deletion_journal_listing_incomplete');
        }
        for (const item of page.Contents ?? []) {
          if (!item.Key?.endsWith('.json')) throw new Error('account_deletion_journal_invalid_object');
          const object = await options.client.send(new GetObjectCommand({ Bucket: options.bucket, Key: item.Key }));
          if (!object.Body) throw new Error('account_deletion_journal_empty_object');
          let parsed: unknown;
          try {
            parsed = JSON.parse(await object.Body.transformToString());
          } catch {
            throw new Error('account_deletion_journal_invalid_json');
          }
          if (!verifyJournalEntry(parsed, options.signingKey)) throw new Error('account_deletion_journal_integrity_failed');
          if (item.Key !== `${JOURNAL_PREFIX}${parsed.operationId}.json`) {
            throw new Error('account_deletion_journal_key_mismatch');
          }
          entries.push(parsed);
        }
        continuationToken = page.NextContinuationToken;
      } while (continuationToken);
      return entries;
    },

    close() {
      options.client.destroy();
    }
  };
}

function configuredJournal(): AccountDeletionJournal {
  const endpoint = process.env.ACCOUNT_DELETION_JOURNAL_ENDPOINT;
  const bucket = process.env.ACCOUNT_DELETION_JOURNAL_BUCKET;
  const accessKeyId = process.env.ACCOUNT_DELETION_JOURNAL_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ACCOUNT_DELETION_JOURNAL_SECRET_ACCESS_KEY;
  const signingKey = process.env.ACCOUNT_DELETION_JOURNAL_HMAC_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !signingKey) {
    throw new Error('account_deletion_journal_unavailable');
  }
  return createAccountDeletionJournal({
    bucket,
    signingKey,
    client: new S3Client({
      endpoint,
      region: process.env.ACCOUNT_DELETION_JOURNAL_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey }
    })
  });
}

export async function writeAcceptedDeletionToJournal(acceptance: AccountDeletionJournalAcceptance) {
  if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return;
  const journal = configuredJournal();
  try {
    await journal.writeAcceptance(acceptance);
  } finally {
    journal.close();
  }
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
  const accepted = await executor.query<{
    id: string;
    user_id: string;
    accepted_at: Date;
    deadline_at: Date;
  }>(`SELECT id, user_id, accepted_at, deadline_at FROM account_deletion_operations
      WHERE accepted_at IS NOT NULL AND deadline_at IS NOT NULL ORDER BY accepted_at, id`);
  for (const row of accepted.rows) {
    await writeAcceptedDeletionToJournal({
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
  return { exported: accepted.rows.length, journalEntries: journalEntries.length };
}
