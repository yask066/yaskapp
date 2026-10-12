import assert from 'node:assert/strict';
import test from 'node:test';

import { db } from '../../config/database.js';
import { registerNotificationDevice } from './notification-devices.repository.js';

test('closed_account_cannot_register_a_push_device', async (context) => {
  const statements: string[] = [];
  context.mock.method(db, 'connect', async () => ({
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('SELECT status, deleted_at FROM users')) return { rows: [{ status: 'deleted', deleted_at: new Date() }] };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  } as never));

  await assert.rejects(registerNotificationDevice('closed-user', 'push-token', 'ios'), /account_not_active/);
  assert.ok(!statements.some((sql) => sql.includes('INSERT INTO notification_devices')));
  assert.ok(statements.includes('ROLLBACK'));
});
