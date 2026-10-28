import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';

const [{ db }, { updateNotificationPreferences }] = await Promise.all([
  import('../../config/database.js'),
  import('./notification-preferences.repository.js')
]);

test('closed_account_cannot_update_notification_preferences', async (context) => {
  const statements: string[] = [];
  context.mock.method(db, 'query', async (sql: string) => {
    statements.push(sql);
    return { rows: [] } as never;
  });
  context.mock.method(db, 'connect', async () => ({
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('SELECT status, deleted_at FROM users')) {
        return { rows: [{ status: 'deleted', deleted_at: new Date() }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {}
  } as never));

  await assert.rejects(updateNotificationPreferences('closed-user', { comment: { inApp: false } }), /account_not_active/);
  assert.ok(!statements.some((sql) => sql.includes('INSERT INTO notification_preferences')));
  assert.ok(statements.includes('ROLLBACK'));
});
