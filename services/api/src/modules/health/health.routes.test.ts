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
  const previousJournal = env.ACCOUNT_DELETION_JOURNAL_ENABLED;
  env.ACCOUNT_DELETION_JOURNAL_ENABLED = true;
  context.after(() => {
    env.ACCOUNT_DELETION_ENABLED = previous;
    env.ACCOUNT_DELETION_JOURNAL_ENABLED = previousJournal;
  });

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

test('database_only_deletion_does_not_depend_on_journal_readiness', async (context) => {
  const previous = env.ACCOUNT_DELETION_ENABLED;
  const previousJournal = env.ACCOUNT_DELETION_JOURNAL_ENABLED;
  env.ACCOUNT_DELETION_ENABLED = true;
  env.ACCOUNT_DELETION_JOURNAL_ENABLED = false;
  context.after(() => {
    env.ACCOUNT_DELETION_ENABLED = previous;
    env.ACCOUNT_DELETION_JOURNAL_ENABLED = previousJournal;
  });
  const state = { failJournal: true, journalCalls: 0 };
  const app = makeApp(state);
  context.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode, 200);
  assert.equal(state.journalCalls, 0);
});

test('health_ready_omits_bucket_and_serverTime_and_health_db_restricts_external_access', async (context) => {
  const previousEnv = env.NODE_ENV;
  const app = Fastify({ trustProxy: true });
  registerHealthRoutes(app, {
    checkDatabaseConnection: async () => {
      throw new Error('pg_down');
    },
    checkRedisConnection: async () => ({ connected: true }),
    checkStorageConnection: async () => ({ connected: true, bucket: 'secret-bucket-name' }),
    assertJournalReady: async () => {}
  });
  context.after(async () => {
    env.NODE_ENV = previousEnv;
    await app.close();
  });

  const healthyApp = makeApp({ journalCalls: 0 });
  context.after(() => healthyApp.close());
  const ready = await healthyApp.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json(), {
    status: 'ready',
    service: 'api',
    database: { connected: true },
    redis: { connected: true },
    storage: { connected: true }
  });

  const dbDown = await app.inject({ method: 'GET', url: '/health/db' });
  assert.equal(dbDown.statusCode, 503);
  assert.deepEqual(dbDown.json(), { status: 'unavailable', service: 'api' });

  env.NODE_ENV = 'production';
  const externalMetrics = await app.inject({
    method: 'GET',
    url: '/health/metrics',
    headers: { 'x-forwarded-for': '203.0.113.42' }
  });
  assert.equal(externalMetrics.statusCode, 403);
  const internalMetrics = await app.inject({
    method: 'GET',
    url: '/health/metrics',
    headers: { 'x-forwarded-for': '127.0.0.1' }
  });
  assert.equal(internalMetrics.statusCode, 200);
});

