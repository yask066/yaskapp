import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ADMIN_PERMISSIONS,
  hasPermission,
  permissionsForRole
} from './permissions.js';

test('user role has no administrative permissions', () => {
  assert.deepEqual(permissionsForRole('user'), []);
  assert.equal(hasPermission('user', 'admin.users.read'), false);
});

test('moderator role can manage users and content but not roles or audit', () => {
  assert.equal(hasPermission('moderator', 'admin.users.read'), true);
  assert.equal(hasPermission('moderator', 'admin.users.block'), true);
  assert.equal(hasPermission('moderator', 'admin.users.unblock'), true);
  assert.equal(hasPermission('moderator', 'admin.polls.read'), true);
  assert.equal(hasPermission('moderator', 'admin.polls.delete'), true);
  assert.equal(hasPermission('moderator', 'admin.comments.delete'), true);
  assert.equal(hasPermission('moderator', 'admin.users.roles.update'), false);
  assert.equal(hasPermission('moderator', 'admin.audit.read'), false);
});

test('superadmin role has every administrative permission', () => {
  for (const permission of ADMIN_PERMISSIONS) {
    assert.equal(hasPermission('superadmin', permission), true);
  }
});

test('unknown permission is denied', () => {
  assert.equal(
    hasPermission('superadmin', 'admin.unknown.action' as never),
    false
  );
});

test('unknown role has no permissions', () => {
  assert.deepEqual(permissionsForRole('unknown'), []);
  assert.equal(hasPermission('unknown', 'admin.audit.read'), false);
});
