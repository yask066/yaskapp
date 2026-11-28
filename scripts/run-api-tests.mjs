import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTestFiles(dir, rootDir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(fullPath, rootDir, acc);
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      acc.push(relative(rootDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return acc;
}

const cwd = process.cwd();
const extraArgs = process.argv.slice(2);
const testFiles = extraArgs.length > 0
  ? extraArgs
  : collectTestFiles(join(cwd, 'src'), cwd).sort((a, b) => a.localeCompare(b));

if (testFiles.length === 0) {
  console.error('No API test files found.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-reporter', 'spec', ...testFiles],
  { cwd, stdio: 'inherit', env: process.env }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
