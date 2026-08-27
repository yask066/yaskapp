import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
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

test('case filters send search and assignment criteria to the API', () => {
  assert.match(source, /search-filter/);
  assert.match(source, /assigneeId/);
  assert.match(source, /unassigned/);
  assert.match(source, /\/auth\/me/);
});

test('closing More actions after copying the case ID updates its accessibility state', () => {
  assert.match(source, /copy-case-id-menu/);
  assert.match(source, /menuToggle\?\.setAttribute\('aria-expanded', 'false'\)/);
});

test('dropdowns stay hidden until opened', () => {
  assert.match(styles, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
});

test('poll details load the protected admin poll record', () => {
  assert.match(source, /\/admin\/polls\//);
  assert.match(source, /\/admin\/capabilities/);
  assert.match(source, /adminCapabilities[\s\S]*catch/);
  assert.doesNotMatch(source, /if \(!can\('admin\.polls\.read'\)\) return null/);
  assert.match(source, /poll-details-content/);
  assert.match(source, /addEventListener\('toggle'/);
  assert.doesNotMatch(source, /const poll = item\.targetType === 'poll' \? await loadPollDetails/);
  assert.match(source, /moderationCapabilities/);
  assert.match(source, /votesCount/);
  assert.match(source, /Poll details/);
});
