import assert from 'node:assert/strict';
import test from 'node:test';

import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
    'acceptedAt', 'deadlineAt', 'hmac', 'operationId', 'userId', 'version'
  ]);
  assert.equal(verifyJournalEntry(entry, 'test-key-at-least-32-characters-long'), true);
  assert.equal(verifyJournalEntry({ ...entry, userId: 'b4ae7aed-1111-4f8f-b37a-2111184c34d9' }, 'test-key-at-least-32-characters-long'), false);
});

test('journal persists acceptance before it can be replayed and rejects tampered objects', async () => {
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
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [...objects.keys()].map((Key) => ({ Key })), IsTruncated: false };
      }
      throw new Error('unexpected_s3_command');
    },
    destroy() {}
  } as unknown as S3Client;
  const journal = createAccountDeletionJournal({
    client,
    bucket: 'private-journal',
    signingKey: 'test-key-at-least-32-characters-long'
  });

  await journal.writeAcceptance(acceptance);
  await journal.writeAcceptance(acceptance);
  assert.equal((await journal.readAll()).length, 1);
  const key = [...objects.keys()][0]!;
  objects.set(key, objects.get(key)!.replace(acceptance.userId, 'b4ae7aed-1111-4f8f-b37a-2111184c34d9'));
  await assert.rejects(journal.readAll(), /integrity_failed/);
});

test('journal refuses an S3 listing marked truncated without a continuation token', async () => {
  const client = {
    async send(command: unknown) {
      if (command instanceof ListObjectsV2Command) return { Contents: [], IsTruncated: true };
      throw new Error('unexpected_s3_command');
    },
    destroy() {}
  } as unknown as S3Client;
  const journal = createAccountDeletionJournal({
    client,
    bucket: 'private-journal',
    signingKey: 'test-key-at-least-32-characters-long'
  });

  await assert.rejects(journal.readAll(), /listing_incomplete/);
});
