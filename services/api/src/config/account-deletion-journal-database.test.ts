import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app:secret@localhost/app',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'media',
  S3_ACCESS_KEY_ID: 'media-user',
  S3_SECRET_ACCESS_KEY: 'media-secret'
});

const {
  closeAccountDeletionJournalDatabase,
  getAccountDeletionJournalDatabase,
  getAccountDeletionJournalRetentionDatabase
} = await import('./account-deletion-journal-database.js');
const { env, parseEnv } = await import('./env.js');

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app:secret@localhost/app',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'media',
  S3_ACCESS_KEY_ID: 'media-user',
  S3_SECRET_ACCESS_KEY: 'media-secret'
};

test('valid_journal_urls_create_separate_pools', async (context) => {
  const originalJournalUrl = env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL;
  const originalRetentionUrl = env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL;
  context.after(async () => {
    await closeAccountDeletionJournalDatabase();
    env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL = originalJournalUrl;
    env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL = originalRetentionUrl;
  });

  env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL = 'postgresql://runtime:secret@journal.test/deletion?sslmode=verify-full';
  env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL = 'postgresql://retention:secret@journal.test/deletion?sslmode=verify-full';
  const runtimePool = getAccountDeletionJournalDatabase();
  const retentionPool = getAccountDeletionJournalRetentionDatabase();

  assert.notEqual(runtimePool, retentionPool);
  assert.equal(runtimePool.options.connectionString, env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL);
  assert.equal(retentionPool.options.connectionString, env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL);
});

test('deletion_enabled_requires_journal_settings', () => {
  assert.throws(
    () => parseEnv({ ...baseEnvironment, ACCOUNT_DELETION_ENABLED: 'true' }),
    (error: unknown) => error instanceof Error && error.name === 'ZodError'
  );
  assert.throws(
    () => parseEnv({
      ...baseEnvironment,
      NODE_ENV: 'production',
      ACCOUNT_DELETION_ENABLED: 'true',
      ACCOUNT_DELETION_JOURNAL_DATABASE_URL: 'postgresql://runtime:secret@journal.example/deletion',
      ACCOUNT_DELETION_JOURNAL_ID: 'journal-prod',
      ACCOUNT_DELETION_JOURNAL_HMAC_KEY: '12345678901234567890123456789012'
    }),
    /sslmode=verify-full/
  );
});

test('deletion_disabled_does_not_require_journal_settings', () => {
  const config = parseEnv(baseEnvironment);
  assert.equal(config.ACCOUNT_DELETION_ENABLED, false);
  assert.equal(config.ACCOUNT_DELETION_JOURNAL_DATABASE_URL, undefined);
  assert.equal(config.ACCOUNT_DELETION_JOURNAL_ID, undefined);
});

test('journal_database_settings_require_postgresql_urls', () => {
  assert.throws(
    () => parseEnv({ ...baseEnvironment, ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL: 'https://journal.example/db' }),
    /PostgreSQL/
  );
});

test('unconfigured_journal_accessors_fail_closed', async (context) => {
  const originalJournalUrl = env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL;
  const originalRetentionUrl = env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL;
  context.after(async () => {
    await closeAccountDeletionJournalDatabase();
    env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL = originalJournalUrl;
    env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL = originalRetentionUrl;
  });

  env.ACCOUNT_DELETION_JOURNAL_DATABASE_URL = undefined;
  env.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL = undefined;
  assert.throws(() => getAccountDeletionJournalDatabase(), { code: 'account_deletion_journal_unavailable' });
  assert.throws(() => getAccountDeletionJournalRetentionDatabase(), { code: 'account_deletion_journal_unavailable' });
});
