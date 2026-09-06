import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repositoryRoot = join(import.meta.dirname, '..', '..', '..');
const lockfile = JSON.parse(
  readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8'),
);

test('API Linux builds resolve the esbuild binary matching the tsx host', () => {
  const esbuild = lockfile.packages['node_modules/esbuild'];
  const linuxBinary = lockfile.packages['node_modules/@esbuild/linux-x64'];

  assert.equal(esbuild.version, '0.28.1');
  assert.equal(
    linuxBinary.version,
    esbuild.optionalDependencies['@esbuild/linux-x64'],
  );
});
