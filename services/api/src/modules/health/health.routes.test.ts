import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';

process.env.NODE_ENV = 'test';

const [{ env }, { registerHealthRoutes }] = await Promise.all([
  import('../../config/env.js'),
  import('./health.routes.js')
]);

function makeApp(options: { failJournal?: boolean; journalCalls: number }) {
  const app = Fastify();
  registerHealthRoutes(app, {
    checkDatabaseConnection: async () => ({ connected: true, serverTime: '2026-10-15T00:00:00.000Z' }),
    checkRedisConnection: async () => ({ connected: true }),
    checkStorageConnection: async () => ({ connected: true, bucket: 'test' }),
    async assertJournalReady() {
      options.journalCalls += 1;
      if (options.failJournal) throw new Error('journal_unavailable');
    }
  });
  return app;
}

test('ready_requires_journal_only_when_deletion_enabled', async (context) => {
  const previous = env.ACCOUNT_DELETION_ENABLED;
  context.after(() => { env.ACCOUNT_DELETION_ENABLED = previous; });

  const disabledState = { failJournal: true, journalCalls: 0 };
  env.ACCOUNT_DELETION_ENABLED = false;
  const disabledApp = makeApp(disabledState);
  context.after(() => disabledApp.close());
  const disabledResponse = await disabledApp.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(disabledResponse.statusCode, 200);
  assert.equal(disabledState.journalCalls, 0);

  const enabledState = { failJournal: true, journalCalls: 0 };
  env.ACCOUNT_DELETION_ENABLED = true;
  const enabledApp = makeApp(enabledState);
  context.after(() => enabledApp.close());
  const enabledResponse = await enabledApp.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(enabledResponse.statusCode, 503);
  assert.deepEqual(enabledResponse.json(), { status: 'unavailable', service: 'api' });
  assert.equal(enabledState.journalCalls, 1);
});

