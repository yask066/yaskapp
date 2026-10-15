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

test('prepare_failure_never_commits_application_transaction', async () => {
  const events: string[] = [];
  await assert.rejects(commitJournaledAcceptance({
    async writePrepared() { events.push('prepared'); throw new Error('journal_unavailable'); },
    async commitDatabase() { events.push('database_commit'); },
    async writeAccepted() { events.push('accepted'); }
  }), /journal_unavailable/);
  assert.deepEqual(events, ['prepared']);
});

test('accepted_failure_never_confirms_request', async () => {
  const events: string[] = [];
  await assert.rejects(commitJournaledAcceptance({
    async writePrepared() { events.push('prepared'); },
    async commitDatabase() { events.push('database_commit'); },
    async writeAccepted() { events.push('accepted'); throw new Error('journal_unavailable'); }
  }), /journal_unavailable/);
  assert.deepEqual(events, ['prepared', 'database_commit', 'accepted']);
});
