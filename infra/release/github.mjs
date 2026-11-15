import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const repo = 'yask066/yaskapp';
export function assertReleasePr(pr) {
  if (pr.base?.ref !== 'main' || pr.head?.ref !== 'staging' ||
      pr.base?.repo?.full_name !== repo || pr.head?.repo?.full_name !== repo ||
      !/^[a-f0-9]{40}$/.test(pr.head?.sha ?? '')) throw new Error('Only staging → main can release');
}
export function selectEvidence(runs, sha) {
  const run = runs.find(r => r.head_sha === sha && r.head_branch === 'staging' &&
    r.event === 'push' && r.status === 'completed' && r.conclusion === 'success');
  if (!run) throw new Error('No successful staging deployment for this SHA');
  return run;
}
export function verifyTree(source, merged) {
  if (!/^[a-f0-9]{40}$/.test(source ?? '') || source !== merged) throw new Error('Merge changes the tested source tree');
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method, headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function evidence(sha) {
  const { workflow_runs: runs } = await api(`/actions/workflows/staging.yml/runs?head_sha=${sha}&per_page=100`);
  const run = selectEvidence(runs, sha);
  const { artifacts } = await api(`/actions/runs/${run.id}/artifacts?per_page=100`);
  if (!artifacts.some(a => a.name === `release-${sha}` && !a.expired)) throw new Error('Release manifest unavailable');
  return run;
}
async function output(key, value) {
  await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
async function checkPr(pr) {
  let state = 'failure', description = 'Release is not ready';
  try {
    assertReleasePr(pr);
    const source = await api(`/git/commits/${pr.head.sha}`);
    if (!pr.merge_commit_sha) throw new Error('Merge preview unavailable');
    const merged = await api(`/git/commits/${pr.merge_commit_sha}`);
    verifyTree(source.tree.sha, merged.tree.sha);
    await evidence(pr.head.sha);
    state = 'success';
    description = 'Exact SHA deployed to staging; manual acceptance required before Merge';
  } catch (error) { description = error.message.slice(0, 140); }
  await api(`/statuses/${pr.head.sha}`, 'POST', { state, context: 'release-ready', description });
}
async function main() {
  const mode = process.argv[2];
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (mode === 'pr') {
    const sha = process.env.GITHUB_SHA;
    const staging = await api('/git/ref/heads/staging');
    if (staging.object.sha !== sha) return; // a newer push owns the release PR
    const comparison = await api('/compare/main...staging');
    if (!comparison.files?.length) return;
    const prs = await api('/pulls?state=open&base=main&head=yask066:staging');
    const body = `Проверяемая версия: \`${sha}\`.\n\nТестовый сайт: https://test.yaskapp.org\n\n` +
      `Проверки: https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}\n\n` +
      'Проверьте сценарии docs/staging-smoke-test.md. Merge означает ручную приёмку текущего SHA. ' +
      'Если staging обновился, повторите приёмку. После Merge следите за Production: слияние кода ещё не означает успешный deploy.';
    const data = { title: 'Release: staging → main', body };
    if (prs.length) await api(`/pulls/${prs[0].number}`, 'PATCH', data);
    else await api('/pulls', 'POST', { ...data, head: 'staging', base: 'main' });
  } else if (mode === 'check') {
    const prs = event.pull_request ? [await api(`/pulls/${event.pull_request.number}`)] :
      await api('/pulls?state=open&base=main&head=yask066:staging');
    for (const pr of prs) await checkPr(pr);
  } else if (mode === 'promote') {
    const pr = event.pull_request;
    assertReleasePr(pr);
    if (!pr.merged) throw new Error('PR was not merged');
    const main = await api('/git/ref/heads/main');
    if (main.object.sha !== pr.merge_commit_sha) throw new Error('Main advanced; refusing stale deployment');
    const source = await api(`/git/commits/${pr.head.sha}`);
    const merged = await api(`/git/commits/${pr.merge_commit_sha}`);
    verifyTree(source.tree.sha, merged.tree.sha);
    const run = await evidence(pr.head.sha);
    await output('source_sha', pr.head.sha);
    await output('source_tree', source.tree.sha);
    await output('run_id', run.id);
  } else if (mode === 'sync') {
    const pr = event.pull_request;
    assertReleasePr(pr);
    await api('/merges', 'POST', { base: 'staging', head: pr.merge_commit_sha,
      commit_message: 'chore: synchronize released main into staging' });
  } else throw new Error('Unknown command');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
