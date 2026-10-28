import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { calculateMigrationChecksum, matchesMigrationChecksum } from './migration-checksum.js';

const sha256 = (sql: string) => createHash('sha256').update(sql).digest('hex');

test('migration checksums are stable across LF and CRLF checkouts', () => {
  const lfSql = 'CREATE TABLE example (id integer);\nCREATE INDEX example_id_idx ON example (id);\n';
  const crlfSql = lfSql.replace(/\n/g, '\r\n');

  assert.equal(calculateMigrationChecksum(lfSql), calculateMigrationChecksum(crlfSql));
});

test('migration verification accepts checksums recorded with either line ending', () => {
  const lfSql = 'CREATE TABLE example (id integer);\nCREATE INDEX example_id_idx ON example (id);\n';
  const crlfSql = lfSql.replace(/\n/g, '\r\n');

  assert.equal(matchesMigrationChecksum(lfSql, sha256(crlfSql)), true);
  assert.equal(matchesMigrationChecksum(crlfSql, sha256(lfSql)), true);
});

test('migration verification still rejects changed SQL content', () => {
  const originalSql = 'CREATE TABLE example (id integer);\n';

  assert.equal(matchesMigrationChecksum(`${originalSql}-- changed\n`, sha256(originalSql)), false);
});
