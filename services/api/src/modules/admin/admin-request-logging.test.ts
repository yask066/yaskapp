import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildAdminFailureLog,
  isAdminFailureRequest
} from './admin-request-logging.js';

test('admin failures produce a structured safe log entry', () => {
  assert.equal(isAdminFailureRequest('/admin/users', 403), true);
  assert.equal(isAdminFailureRequest('/polls', 403), false);
  assert.equal(isAdminFailureRequest('/admin/users', 200), false);

  assert.deepEqual(
    buildAdminFailureLog({
      requestId: 'request-1',
      method: 'DELETE',
      route: '/admin/users/:userId',
      statusCode: 429,
      actorUserId: 'actor-1'
    }),
    {
      event: 'admin_request_failed',
      requestId: 'request-1',
      method: 'DELETE',
      route: '/admin/users/:userId',
      statusCode: 429,
      actorUserId: 'actor-1'
    }
  );
});
