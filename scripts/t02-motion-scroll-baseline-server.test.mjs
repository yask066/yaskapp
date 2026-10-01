import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = resolve(root, 'scripts/t02-motion-scroll-baseline-server.mjs');

test('serves the two T02 search pages through the existing cursor contract', async () => {
  const port = await getAvailablePort();
  const server = spawn(process.execPath, [serverScript], {
    cwd: root,
    env: {
      ...process.env,
      T02_HOST: '127.0.0.1',
      T02_PORT: String(port),
      T02_SCENARIO: 'normal',
    },
    stdio: 'ignore',
  });

  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitUntilReady(server, origin);

    const firstResponse = await fetch(`${origin}/search?q=motion&type=polls&sort=relevance&limit=20`);
    assert.equal(firstResponse.status, 200);
    const firstPage = await firstResponse.json();
    assert.deepEqual(firstPage.items.map((item) => item.poll.id), [
      'motion-long-text',
      'motion-count-10',
    ]);
    assert.equal(firstPage.nextCursor, 't02-page-2');

    const secondResponse = await fetch(`${origin}/search?q=motion&type=polls&sort=relevance&limit=20&cursor=t02-page-2`);
    assert.equal(secondResponse.status, 200);
    const secondPage = await secondResponse.json();
    assert.deepEqual(secondPage.items.map((item) => item.poll.id), [
      'motion-count-99',
      'motion-count-100-image-error',
    ]);
    assert.equal(secondPage.nextCursor, null);
  } finally {
    if (server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  }
});

async function getAvailablePort() {
  const probe = createTcpServer();
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not allocate a local test port.');
  }
  await new Promise((resolveClose, reject) => {
    probe.close((error) => error ? reject(error) : resolveClose());
  });
  return address.port;
}

async function waitUntilReady(server, origin) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Fixture server exited early with code ${server.exitCode}.`);
    }
    try {
      const response = await fetch(`${origin}/healthz`);
      if (response.ok) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }
  throw new Error('Fixture server did not become ready.');
}
