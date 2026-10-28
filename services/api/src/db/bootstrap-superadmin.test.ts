import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBootstrapArgs } from './bootstrap-superadmin.js';

test('bootstrap CLI accepts exactly one login argument', () => {
  assert.deepEqual(parseBootstrapArgs(['--login', 'admin@example.com']), {
    login: 'admin@example.com'
  });
  assert.deepEqual(parseBootstrapArgs(['--login=admin_user']), {
    login: 'admin_user'
  });
});

test('bootstrap CLI rejects missing, duplicated, or unknown arguments', () => {
  for (const args of [[], ['--login'], ['--login', 'one', '--login', 'two'], ['--email', 'admin@example.com']]) {
    assert.throws(() => parseBootstrapArgs(args), /Usage:/);
  }
});
