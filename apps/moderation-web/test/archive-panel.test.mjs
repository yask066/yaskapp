import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createArchivePanel } from '../src/archive-panel.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('archive panel escapes evidence, submits explicit IP bans, and clears private data on logout', async () => {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const calls = [];
  const account = { userId: 'fixture-id', source: 'self_service',
    deletedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 100_000).toISOString(),
    profile: { username: '<img src=x onerror=alert(1)>', email: 'fixture@example.test' },
    ips: [{ ip: '192.0.2.10', lastSeenAt: new Date().toISOString() }],
    evidence: { cases: [{ content: { body: '<script>alert(1)</script>' } }] } };
  const panel = createArchivePanel({ document, can: () => true, handleError: (error) => { throw error; },
    confirm: () => true, requestReason: () => 'Serious violation',
    async request(path, options) {
      calls.push({ path, options });
      if (path.includes('/ip-bans') && options?.method === 'POST') return { ban: { id: 'ban-id' } };
      if (path === '/admin/deleted-accounts/fixture-id') return { account };
      return { items: [account], nextCursor: null };
    }
  });
  try {
    await panel.loadArchives();
    document.querySelector('#archive-list button').click();
    await tick();
    assert.match(document.getElementById('archive-detail').textContent, /<script>alert\(1\)<\/script>/);
    assert.equal(document.querySelector('#archive-detail img, #archive-detail script'), null);
    document.querySelector('#archive-detail [data-ban-ip]').click();
    await tick();
    const ban = calls.find((call) => call.options?.method === 'POST');
    assert.equal(ban.path, '/admin/deleted-accounts/fixture-id/ip-bans');
    assert.deepEqual(JSON.parse(ban.options.body), { ip: '192.0.2.10', reason: 'Serious violation' });
    panel.reset();
    assert.equal(document.getElementById('archive-detail').textContent, '');
    assert.equal(document.getElementById('archive-list').textContent, '');
  } finally { panel.reset(); dom.window.close(); }
});

test('an in-flight archive response cannot restore private data after logout', async () => {
  const dom = new JSDOM(html);
  let finish;
  const panel = createArchivePanel({ document: dom.window.document, can: () => true,
    handleError: (error) => { throw error; }, confirm: () => true, requestReason: () => 'Reason',
    request: () => new Promise((resolve) => { finish = resolve; }) });
  const loading = panel.loadArchives();
  panel.reset();
  finish({ items: [{ userId: 'private-id', profile: { username: 'Private user' } }], nextCursor: null });
  await loading;
  assert.equal(dom.window.document.getElementById('archive-list').textContent, '');
  dom.window.close();
});
