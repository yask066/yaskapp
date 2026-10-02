import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

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
      'motion-count-10',
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

test('fixture covers zero, digit boundaries, equal results and overlapping pages', () => {
  const fixture = JSON.parse(readFileSync(resolve(root, 'test/fixtures/t02-motion-scroll-loading-polls.json'), 'utf8'));
  assert.deepEqual(fixture.cards.map((poll) => poll.votesCount), [9, 10, 99, 100, 0, 999, 1000, 10]);
  for (const poll of fixture.cards) {
    assert.equal(poll.options.reduce((sum, option) => sum + option.votesCount, 0), poll.votesCount);
  }
  const equal = fixture.cards.find((poll) => poll.id === 'motion-equal-results');
  assert.deepEqual(equal.options.map((option) => option.votesCount), [5, 5]);
  const ids = fixture.cursorPages.flatMap((page) => page.pollIds);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 4);
});

async function withServer(env, run) {
  const port = await getAvailablePort();
  const server = spawn(process.execPath, [serverScript], {
    cwd: root,
    env: { ...process.env, T02_HOST: '127.0.0.1', T02_PORT: String(port), T02_SCENARIO: 'normal', T02_MEDIA_DELAY_MS: '0', ...env },
    stdio: 'ignore',
  });
  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitUntilReady(server, origin);
    await run(origin);
  } finally {
    if (server.exitCode === null) {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  }
}

test('normal feed stays single-page; initial error can be retried', async () => {
  await withServer({ T02_SCENARIO: 'error' }, async (origin) => {
    assert.equal((await fetch(`${origin}/polls`)).status, 503);
    const response = await fetch(`${origin}/polls`);
    assert.equal(response.status, 200);
    const feed = await response.json();
    assert.equal(feed.items.length, 8);
    assert.equal('nextCursor' in feed, false);
    assert.equal((await fetch(`${origin}/search?cursor=unknown`)).status, 400);
  });
});

test('profiling feed creates 100 stable unique poll and option IDs', async () => {
  await withServer({ T02_SCENARIO: 'profiling' }, async (origin) => {
    const first = await (await fetch(`${origin}/polls`)).json();
    const second = await (await fetch(`${origin}/polls`)).json();
    assert.equal(first.items.length, 100);
    assert.deepEqual(first, second);
    assert.equal(first.items[0].id, 'motion-profile-20261002-001');
    assert.equal(first.items[99].id, 'motion-profile-20261002-100');
    assert.equal(new Set(first.items.map((poll) => poll.id)).size, 100);
    assert.equal(new Set(first.items.flatMap((poll) => poll.options.map((option) => option.id))).size, 200);
    assert.equal('nextCursor' in first, false);
  });
});

test('media error preserves a repeatable error; valid media loads after delay', async () => {
  await withServer({ T02_MEDIA_DELAY_MS: '40' }, async (origin) => {
    const start = performance.now();
    const image = await fetch(`${origin}/media/landscape-16x9.svg`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await image.text(), /<svg/);
    assert.ok(performance.now() - start >= 35);
    assert.equal((await fetch(`${origin}/media/missing.svg`)).status, 404);
    assert.equal((await fetch(`${origin}/media/missing.svg`)).status, 404);
  });
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

for (const scenario of ['reorder', 'reorder-reverse']) {
  test(`${scenario} returns independent snapshots in the configured HTTP order`, async () => {
    await withServer({ T02_SCENARIO: scenario }, async (origin) => {
      const order = [];
      const send = async (kind, body) => {
        const response = await fetch(`${origin}/polls/motion-long-text/${kind}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        assert.equal(response.status, 201);
        order.push(kind);
        return (await response.json()).poll;
      };
      const [vote, like] = await Promise.all([
        send('votes', { optionId: 'motion-long-text-option-a' }), send('likes', {}),
      ]);
      assert.deepEqual(order, scenario === 'reorder' ? ['likes', 'votes'] : ['votes', 'likes']);
      assert.equal(vote.votesCount, 10);
      assert.equal(vote.options[0].votesCount, 6);
      assert.equal(vote.viewerVoteOptionId, 'motion-long-text-option-a');
      assert.equal(vote.viewerHasLiked, false);
      assert.equal(like.likesCount, 10);
      assert.equal(like.viewerHasLiked, true);
      assert.equal(like.votesCount, 9);
    });
  });
}

test('normal mutations return accumulated vote and like state', async () => {
  await withServer({}, async (origin) => {
    await fetch(`${origin}/polls/motion-long-text/votes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId: 'motion-long-text-option-a' }),
    });
    const response = await fetch(`${origin}/polls/motion-long-text/likes`, { method: 'POST' });
    assert.equal(response.status, 201);
    const { poll } = await response.json();
    assert.equal(poll.votesCount, 10);
    assert.equal(poll.viewerVoteOptionId, 'motion-long-text-option-a');
    assert.equal(poll.likesCount, 10);
    assert.equal(poll.viewerHasLiked, true);
  });
});

for (const [scenario, status, minimumMs] of [['delay', 200, 1950], ['timeout', 504, 14950]]) {
  test(`${scenario} uses the fixture deadline and HTTP status`, async () => {
    await withServer({ T02_SCENARIO: scenario }, async (origin) => {
      const start = performance.now();
      const response = await fetch(`${origin}/polls`);
      assert.equal(response.status, status);
      assert.ok(performance.now() - start >= minimumMs);
    });
  });
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
