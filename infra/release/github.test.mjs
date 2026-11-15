import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReleasePr, selectEvidence, verifyTree } from './github.mjs';

const sha = 'a'.repeat(40);
const pr = () => ({ base: { ref: 'main', repo: { full_name: 'yask066/yaskapp' } },
  head: { ref: 'staging', sha, repo: { full_name: 'yask066/yaskapp' } } });

test('only the repository staging branch can release to main', () => {
  assertReleasePr(pr());
  for (const mutated of [
    { ...pr(), head: { ...pr().head, ref: 'feature' } },
    { ...pr(), head: { ...pr().head, repo: { full_name: 'other/yaskapp' } } },
    { ...pr(), base: { ...pr().base, ref: 'develop' } },
  ]) assert.throws(() => assertReleasePr(mutated));
});

test('evidence must be a successful staging push for the exact SHA', () => {
  const run = { id: 7, head_sha: sha, head_branch: 'staging', event: 'push', status: 'completed', conclusion: 'success' };
  assert.equal(selectEvidence([run], sha).id, 7);
  for (const changed of [{ conclusion: 'failure' }, { status: 'in_progress' },
    { head_sha: 'b'.repeat(40) }, { head_branch: 'main' }, { event: 'pull_request' }]) {
    assert.throws(() => selectEvidence([{ ...run, ...changed }], sha));
  }
});

test('main merge must have the same tree as the tested source', () => {
  verifyTree('b'.repeat(40), 'b'.repeat(40));
  assert.throws(() => verifyTree('b'.repeat(40), 'c'.repeat(40)));
});
