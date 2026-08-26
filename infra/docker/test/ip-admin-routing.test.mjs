import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const caddyfile = await readFile(new URL('../Caddyfile', import.meta.url), 'utf8');
const html = await readFile(new URL('../../../apps/moderation-web/index.html', import.meta.url), 'utf8');

test('development IP serves moderation panel under /admin', () => {
  assert.match(caddyfile, /http:\/\/5\.44\.44\.197\s*\{/);
  assert.match(caddyfile, /handle_path \/admin\/\*\s*\{[\s\S]*?reverse_proxy moderation-web:80/);
});

test('moderation panel uses relative asset paths for the /admin mount', () => {
  assert.match(html, /href="src\/styles\.css"/);
  assert.match(html, /src="src\/main\.js"/);
});
