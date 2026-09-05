import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const caddyfile = await readFile(new URL('../Caddyfile', import.meta.url), 'utf8');
const html = await readFile(new URL('../../../apps/moderation-web/index.html', import.meta.url), 'utf8');

test('development IP serves moderation panel under /admin', () => {
  assert.match(caddyfile, /http:\/\/\{\$STAGING_PUBLIC_IP:127\.0\.0\.1\}\s*\{/);
  assert.match(caddyfile, /handle \/src\/\*\s*\{[\s\S]*?reverse_proxy moderation-web:80/);
  assert.match(caddyfile, /handle_path \/admin\/\*\s*\{[\s\S]*?reverse_proxy moderation-web:80/);
});

test('development IP serves the moderation panel at the root path', () => {
  const developmentIpSite = caddyfile.split('{$STAGING_API_DOMAIN')[0];

  assert.match(
    developmentIpSite,
    /handle\s*\{\s*reverse_proxy moderation-web:80\s*\}/,
  );
});

test('moderation panel uses stable asset paths for the /admin mount', () => {
  assert.match(html, /href="\/src\/styles\.css"/);
  assert.match(html, /src="\/src\/main\.js"/);
});
