import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('panel keeps the access token in memory and clears it on session errors', () => {
  assert.match(source, /let accessToken = null/);
  assert.match(source, /accessToken = null; capabilities\.clear\(\); showLogin/);
  assert.match(source, /error\.status === 401/);
});

test('panel navigation is capability gated', () => {
  assert.match(source, /data-permission/);
  assert.match(source, /tab\.hidden = !can\(tab\.dataset\.permission\)/);
  assert.match(html, /data-permission="moderation\.appeal\.read"/);
  assert.match(html, /data-permission="admin\.audit\.read"/);
  assert.match(html, /data-permission="moderation\.policy\.read"/);
});

test('destructive policy writes use an idempotency key', () => {
  assert.match(source, /PATCH', body: JSON\.stringify\(body\)/);
  assert.match(source, /'idempotency-key': idempotencyKey\(\)/);
});

test('moderation panel includes the reference workspace navigation and filters', () => {
  assert.match(html, /class="admin-shell"/);
  assert.match(html, /class="sidebar"/);
  assert.match(html, /class="sidebar-divider"/);
  assert.match(html, /class="user-chip"/);
  assert.match(html, /placeholder="Search cases by ID, user or content\.\.\."/);
  assert.match(html, /id="type-filter"/);
  assert.match(html, /id="assigned-filter"/);
  assert.doesNotMatch(html, /class="section-tabs"/);
});

test('moderation panel assets remain available at the IP admin mount', () => {
  assert.match(html, /href="\/src\/styles\.css"/);
  assert.match(html, /src="\/src\/main\.js"/);
});

test('moderation workspace follows the compact inspector layout', () => {
  assert.match(html, /id="filters-toggle"/);
  assert.match(html, /id="filters-popover"/);
  assert.match(html, /class="filter-dropdown"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(source, /id="more-actions-toggle"/);
  assert.match(source, /id="more-actions-menu"/);
  assert.match(source, /document\.addEventListener\('click'/);
  assert.match(source, /Reported content/);
  assert.match(source, /History/);
  assert.doesNotMatch(html, /class="section-tabs"/);
});
