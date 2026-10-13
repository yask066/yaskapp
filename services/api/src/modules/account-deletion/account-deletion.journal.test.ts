import assert from 'node:assert/strict';
import test from 'node:test';

import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createAccountDeletionJournal, createJournalEntry, verifyJournalEntry } from './account-deletion.journal.js';

const acceptance = {
  operationId: 'e15d4d2b-5358-45a7-b036-f3648d34b361',
  userId: '3ce3e770-fd0e-4e98-8472-0541d3e27cf1',
  acceptedAt: new Date('2026-10-12T12:00:00.000Z'),
  deadlineAt: new Date('2026-10-13T12:00:00.000Z')
};

test('journal entry contains only replay identifiers and timestamps and verifies integrity', () => {
  const entry = createJournalEntry(acceptance, 'test-key-at-least-32-characters-long');
  assert.deepEqual(Object.keys(entry).sort(), [
    'acceptedAt', 'deadlineAt', 'hmac', 'intentId', 'operationId', 'state', 'userId', 'version'
  ]);
  assert.equal(verifyJournalEntry(entry, 'test-key-at-least-32-characters-long'), true);
  assert.equal(verifyJournalEntry({ ...entry, userId: 'b4ae7aed-1111-4f8f-b37a-2111184c34d9' }, 'test-key-at-least-32-characters-long'), false);
});

test('journal persists acceptance before it can be replayed and rejects tampered objects', async () => {
  const objects = new Map<string, string>();
  const checkpoints = new Map<string, string>();
  const puts: Array<{ key: string; mode?: string; retainUntil?: Date }> = [];
  const client = {
    async send(command: unknown) {
      const bucket = (command as { input: { Bucket?: string } }).input.Bucket;
      const store = bucket === 'private-journal' ? objects : checkpoints;
      if (command instanceof GetObjectCommand) {
        const body = store.get(command.input.Key!);
        if (body === undefined) {
          const error = new Error('missing') as Error & { name: string };
          error.name = 'NoSuchKey';
          throw error;
        }
        return { Body: { async transformToString() { return body; } } };
      }
      if (command instanceof PutObjectCommand) {
        store.set(command.input.Key!, String(command.input.Body));
        puts.push({ key: command.input.Key!, mode: command.input.ObjectLockMode,
          retainUntil: command.input.ObjectLockRetainUntilDate });
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [...store.keys()].filter((Key) => !command.input.Prefix || Key.startsWith(command.input.Prefix)).map((Key) => ({ Key })), IsTruncated: false };
      }
      throw new Error('unexpected_s3_command');
    },
    destroy() {}
  } as unknown as S3Client;
  const journal = createAccountDeletionJournal({
    client,
    bucket: 'private-journal',
    checkpointClient: client,
    checkpointBucket: 'private-checkpoint',
    journalId: 'staging-account-deletion-journal',
    signingKey: 'test-key-at-least-32-characters-long'
  });

  await assert.rejects(journal.readAll(), /journal_not_initialized/);
  await journal.initialize();
  await journal.writePrepared(acceptance);
  await journal.writePrepared({
    ...acceptance,
    acceptedAt: new Date(acceptance.acceptedAt.getTime() + 1_000),
    deadlineAt: new Date(acceptance.deadlineAt.getTime() + 1_000)
  });
  assert.equal((await journal.readAll()).length, 0);
  await journal.writeAccepted(acceptance);
  await journal.writeCheckpoint(acceptance);
  await journal.writeAccepted(acceptance);
  assert.equal((await journal.readAll()).length, 1);
  const intentId = createJournalEntry(acceptance, 'test-key-at-least-32-characters-long', 'prepared').intentId;
  const preparedPut = puts.find((put) => put.key === `account-deletions/prepared/${acceptance.operationId}/${intentId}.json`);
  const acceptedPut = puts.find((put) => put.key === `account-deletions/accepted/${acceptance.operationId}.json`);
  const checkpointPut = puts.find((put) => put.key === `account-deletions/checkpoint/${acceptance.operationId}.json`);
  assert.equal(preparedPut?.mode, 'COMPLIANCE');
  assert.equal(preparedPut?.retainUntil?.getTime(), acceptance.acceptedAt.getTime() + 48 * 60 * 60_000);
  assert.equal(acceptedPut?.retainUntil?.getTime(), acceptance.acceptedAt.getTime() + 35 * 24 * 60 * 60_000);
  assert.equal(checkpointPut?.retainUntil?.getTime(), acceptance.acceptedAt.getTime() + 35 * 24 * 60 * 60_000);
  const key = `account-deletions/accepted/${acceptance.operationId}.json`;
  objects.set(key, objects.get(key)!.replace(acceptance.userId, 'b4ae7aed-1111-4f8f-b37a-2111184c34d9'));
  await assert.rejects(journal.readAll(), /integrity_failed/);
});

test('journal rejects accepted entries without their prepared record', async () => {
  const objects = new Map<string, string>();
  const checkpoints = new Map<string, string>();
  const client = {
    async send(command: unknown) {
      const bucket = (command as { input: { Bucket?: string } }).input.Bucket;
      const store = bucket === 'private-journal' ? objects : checkpoints;
      if (command instanceof GetObjectCommand) {
        const body = store.get(command.input.Key!);
        if (body === undefined) {
          const error = new Error('missing') as Error & { name: string };
          error.name = 'NoSuchKey';
          throw error;
        }
        return { Body: { async transformToString() { return body; } } };
      }
      if (command instanceof PutObjectCommand) {
        store.set(command.input.Key!, String(command.input.Body));
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [...store.keys()].filter((Key) => !command.input.Prefix || Key.startsWith(command.input.Prefix)).map((Key) => ({ Key })), IsTruncated: false };
      }
      throw new Error('unexpected_s3_command');
    },
    destroy() {}
  } as unknown as S3Client;
  const journal = createAccountDeletionJournal({
    client,
    bucket: 'private-journal',
    checkpointClient: client,
    checkpointBucket: 'private-checkpoint',
    journalId: 'staging-account-deletion-journal',
    signingKey: 'test-key-at-least-32-characters-long'
  });
  await journal.initialize();
  await journal.writeAccepted(acceptance);
  await assert.rejects(journal.readAll(), /incomplete/);
});

test('journal rejects an accepted entry missing its independent checkpoint record', async () => {
  const objects = new Map<string, string>();
  const checkpoints = new Map<string, string>();
  const client = {
    async send(command: unknown) {
      const bucket = (command as { input: { Bucket?: string } }).input.Bucket;
      const store = bucket === 'private-journal' ? objects : checkpoints;
      if (command instanceof GetObjectCommand) {
        const body = store.get(command.input.Key!);
        if (body === undefined) {
          const error = new Error('missing') as Error & { name: string };
          error.name = 'NoSuchKey';
          throw error;
        }
        return { Body: { async transformToString() { return body; } } };
      }
      if (command instanceof PutObjectCommand) {
        store.set(command.input.Key!, String(command.input.Body));
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [...store.keys()].filter((Key) => !command.input.Prefix || Key.startsWith(command.input.Prefix)).map((Key) => ({ Key })), IsTruncated: false };
      }
      throw new Error('unexpected_s3_command');
    },
    destroy() {}
  } as unknown as S3Client;
  const journal = createAccountDeletionJournal({
    client,
    bucket: 'private-journal',
    checkpointClient: client,
    checkpointBucket: 'private-checkpoint',
    journalId: 'staging-account-deletion-journal',
    signingKey: 'test-key-at-least-32-characters-long'
  });
  await journal.initialize();
  await journal.writePrepared(acceptance);
  await journal.writeAccepted(acceptance);
  await assert.rejects(journal.readAll(), /checkpoint_incomplete/);
});

test('an older journal snapshot cannot pass when the independent checkpoint has newer operations', async () => {
  const journalObjects = new Map<string, string>();
  const checkpointObjects = new Map<string, string>();
  const client = {
    async send(command: unknown) {
      const bucket = (command as { input: { Bucket?: string } }).input.Bucket;
      const store = bucket === 'private-journal' ? journalObjects : checkpointObjects;
      if (command instanceof GetObjectCommand) {
        const body = store.get(command.input.Key!);
        if (body === undefined) {
          const error = new Error('missing') as Error & { name: string };
          error.name = 'NoSuchKey';
          throw error;
        }
        return { Body: { async transformToString() { return body; } } };
      }
      if (command instanceof PutObjectCommand) {
        store.set(command.input.Key!, String(command.input.Body));
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [...store.keys()].filter((Key) => !command.input.Prefix || Key.startsWith(command.input.Prefix)).map((Key) => ({ Key })), IsTruncated: false };
      }
      throw new Error('unexpected_s3_command');
    },
    destroy() {}
  } as unknown as S3Client;
  const journal = createAccountDeletionJournal({
    client,
    bucket: 'private-journal',
    checkpointClient: client,
    checkpointBucket: 'private-checkpoint',
    journalId: 'staging-account-deletion-journal',
    signingKey: 'test-key-at-least-32-characters-long'
  });
  await journal.initialize();
  const checkpoint = createJournalEntry(acceptance, 'test-key-at-least-32-characters-long', 'checkpoint');
  checkpointObjects.set(`account-deletions/checkpoint/${acceptance.operationId}.json`, JSON.stringify(checkpoint));
  await assert.rejects(journal.readAll(), /checkpoint_incomplete/);
});

test('retention removes every current journal and checkpoint object version', async () => {
  const journalObjects = new Map<string, string>();
  const checkpointObjects = new Map<string, string>();
  const client = {
    async send(command: unknown) {
      const input = (command as { input: { Bucket: string; Key?: string; Prefix?: string; Body?: unknown; VersionId?: string } }).input;
      const store = input.Bucket === 'private-journal' ? journalObjects : checkpointObjects;
      if (command instanceof GetObjectCommand) {
        const body = store.get(input.Key!);
        if (body === undefined) {
          const error = new Error('missing') as Error & { name: string };
          error.name = 'NoSuchKey';
          throw error;
        }
        return { Body: { async transformToString() { return body; } } };
      }
      if (command instanceof PutObjectCommand) {
        store.set(input.Key!, String(input.Body));
        return {};
      }
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [...store.keys()].map((Key) => ({ Key })), IsTruncated: false };
      }
      if (command instanceof ListObjectVersionsCommand) {
        return { Versions: [...store.keys()].filter((Key) => Key === input.Prefix).map((Key) => ({ Key, VersionId: 'v1' })), IsTruncated: false };
      }
      if (command instanceof DeleteObjectCommand) {
        store.delete(input.Key!);
        return {};
      }
      throw new Error('unexpected_s3_command');
    },
    destroy() {}
  } as unknown as S3Client;
  const journal = createAccountDeletionJournal({
    client,
    bucket: 'private-journal',
    checkpointClient: client,
    checkpointBucket: 'private-checkpoint',
    journalId: 'staging-account-deletion-journal',
    signingKey: 'test-key-at-least-32-characters-long'
  });
  await journal.initialize();
  await journal.writePrepared(acceptance);
  await journal.writeAccepted(acceptance);
  await journal.writeCheckpoint(acceptance);
  await journal.deleteAccepted(acceptance.operationId);
  assert.equal([...journalObjects.keys()].some((key) => key.startsWith(`account-deletions/prepared/${acceptance.operationId}/`)), false);
  assert.equal(journalObjects.has(`account-deletions/accepted/${acceptance.operationId}.json`), false);
  assert.equal(checkpointObjects.has(`account-deletions/checkpoint/${acceptance.operationId}.json`), false);
});

test('journal refuses an S3 listing marked truncated without a continuation token', async () => {
  const objects = new Map<string, string>();
  const client = {
    async send(command: unknown) {
      if (command instanceof GetObjectCommand) {
        const body = objects.get(command.input.Key!);
        if (body === undefined) {
          const error = new Error('missing') as Error & { name: string };
          error.name = 'NoSuchKey';
          throw error;
        }
        return { Body: { async transformToString() { return body; } } };
      }
      if (command instanceof PutObjectCommand) {
        objects.set(command.input.Key!, String(command.input.Body));
        return {};
      }
      if (command instanceof ListObjectsV2Command) return { Contents: [], IsTruncated: true };
      throw new Error('unexpected_s3_command');
    },
    destroy() {}
  } as unknown as S3Client;
  const journal = createAccountDeletionJournal({
    client,
    bucket: 'private-journal',
    checkpointClient: client,
    checkpointBucket: 'private-checkpoint',
    journalId: 'staging-account-deletion-journal',
    signingKey: 'test-key-at-least-32-characters-long'
  });

  await journal.initialize();
  await assert.rejects(journal.readAll(), /listing_incomplete/);
});
