import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { uploadStagingBackupFile } from './upload-staging-backup.js';

test('backup upload writes a hashed object and verifies its size', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yaskapp-backup-test-'));
  const file = join(directory, 'backup.dump');
  await writeFile(file, 'verified staging dump');
  const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      calls.push({ operation: command.constructor.name, input: command.input });
      if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: Buffer.byteLength('verified staging dump'), Metadata: { sha256: calls[0].input.Metadata && (calls[0].input.Metadata as Record<string, string>).sha256 } };
      for await (const _chunk of command.input.Body as AsyncIterable<Uint8Array>) { /* consume the upload stream */ }
      return {};
    }
  };

  try {
    const result = await uploadStagingBackupFile(client as never, 'staging-backups', file, 'postgres/backup.dump');
    assert.equal(result.bytes, Buffer.byteLength('verified staging dump'));
    assert.deepEqual(calls.map((call) => call.operation), ['PutObjectCommand', 'HeadObjectCommand']);
    assert.equal(calls[0].input.Bucket, 'staging-backups');
    assert.equal(calls[0].input.Key, 'postgres/backup.dump');
    assert.equal(calls[0].input.Metadata && (calls[0].input.Metadata as Record<string, string>).sha256.length, 64);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
