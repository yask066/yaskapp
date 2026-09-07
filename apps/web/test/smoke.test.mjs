import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
const nginxConfig = await readFile(new URL('../nginx.conf', import.meta.url), 'utf8');
const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

test('production image builds the web workspace and serves its compiled output', () => {
  assert.match(dockerfile, /FROM node:20-alpine AS build/);
  assert.match(dockerfile, /npm ci --workspace @yaskapp\/web/);
  assert.match(dockerfile, /npm run build -w @yaskapp\/web/);
  assert.match(dockerfile, /COPY --from=build \/app\/apps\/web\/dist \/usr\/share\/nginx\/html/);
});

test('nginx falls back to the SPA entry point for deep links', () => {
  assert.match(nginxConfig, /try_files \$uri \$uri\/ \/index\.html;/);
});

test('Vite proxies the browser API paths used by the client', () => {
  for (const path of ['/auth', '/polls', '/users', '/profiles', '/search', '/media']) {
    assert.match(viteConfig, new RegExp(`'${path}':\\s*apiProxy`));
  }
});
