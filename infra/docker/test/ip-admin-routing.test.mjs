import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const caddyfile = await readFile(new URL('../Caddyfile', import.meta.url), 'utf8');
const stagingCompose = await readFile(new URL('../docker-compose.staging.yml', import.meta.url), 'utf8');
const html = await readFile(new URL('../../../apps/moderation-web/index.html', import.meta.url), 'utf8');

test('development IP serves moderation panel under /admin', () => {
  assert.match(caddyfile, /http:\/\/\{\$STAGING_PUBLIC_IP:127\.0\.0\.1\}\s*\{/);
  assert.match(caddyfile, /handle \/src\/\*\s*\{[\s\S]*?reverse_proxy moderation-web:80/);
  assert.match(caddyfile, /handle_path \/admin\/\*\s*\{[\s\S]*?reverse_proxy moderation-web:80/);
});

test('development IP serves the public web client at the root path', () => {
  const developmentIpSite = caddyfile.split('{$STAGING_API_DOMAIN')[0];

  assert.match(
    developmentIpSite,
    /handle\s*\{\s*reverse_proxy web:80\s*\}/,
  );
});

test('development IP proxies public web API paths before the SPA', () => {
  const developmentIpSite = caddyfile.split('{$STAGING_API_DOMAIN')[0];

  for (const path of ['/auth/*', '/polls*', '/users*', '/profiles*', '/search*', '/media/*']) {
    const handler = new RegExp(`handle ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[\\s\\S]*?reverse_proxy api:3000`);
    assert.match(developmentIpSite, handler);
  }
});

test('moderation panel uses stable asset paths for the /admin mount', () => {
  assert.match(html, /href="\/src\/styles\.css"/);
  assert.match(html, /src="\/src\/main\.js"/);
});

test('public web host proxies API paths before serving the SPA', () => {
  assert.match(caddyfile, /\{\$WEB_HOST:web-staging\.example\.com\}\s*\{/);

  for (const path of ['/auth/*', '/polls*', '/users*', '/profiles*', '/search*', '/media/*']) {
    const handler = new RegExp(`handle ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[\\s\\S]*?reverse_proxy api:3000`);
    assert.match(caddyfile, handler);
  }

  const publicWebHost = caddyfile.split('{$WEB_HOST:web-staging.example.com}')[1];
  assert.match(publicWebHost, /handle\s*\{\s*reverse_proxy web:80\s*\}/);
});

test('staging Compose builds and exposes the public web service', () => {
  assert.match(stagingCompose, /web:\s*[\s\S]*?image: yaskapp-web:staging/);
  assert.match(stagingCompose, /web:\s*[\s\S]*?dockerfile: apps\/web\/Dockerfile/);
  assert.match(stagingCompose, /web:\s*[\s\S]*?expose:\s*- "80"/);
});
