import assert from 'node:assert/strict';
import test from 'node:test';

import { commitJournaledAcceptance } from './account-deletion.acceptance-protocol.js';

test('acceptance confirmation waits for the database commit and both durable journal states', async () => {
  const events: string[] = [];
  await commitJournaledAcceptance({
    async writePrepared() { events.push('prepared'); },
    async commitDatabase() { events.push('database_commit'); },
    async writeAccepted() { events.push('accepted'); }
  });
  assert.deepEqual(events, ['prepared', 'database_commit', 'accepted']);
});

test('a failed database commit never creates a replayable accepted record', async () => {
  const events: string[] = [];
  await assert.rejects(commitJournaledAcceptance({
    async writePrepared() { events.push('prepared'); },
    async commitDatabase() { events.push('database_commit'); throw new Error('commit_failed'); },
    async writeAccepted() { events.push('accepted'); }
  }), /commit_failed/);
  assert.deepEqual(events, ['prepared', 'database_commit']);
});

test('a failed accepted journal write does not confirm acceptance', async () => {
  const events: string[] = [];
  await assert.rejects(commitJournaledAcceptance({
    async writePrepared() { events.push('prepared'); },
    async commitDatabase() { events.push('database_commit'); },
    async writeAccepted() { events.push('accepted'); throw new Error('journal_unavailable'); }
  }), /journal_unavailable/);
  assert.deepEqual(events, ['prepared', 'database_commit', 'accepted']);
});
