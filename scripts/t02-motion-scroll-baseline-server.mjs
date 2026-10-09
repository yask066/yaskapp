import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const fixture = JSON.parse(readFileSync(join(root, 'test/fixtures/t02-motion-scroll-loading-polls.json'), 'utf8'));
const initial = new Map(fixture.cards.map((poll) => [poll.id, structuredClone(poll)]));
const current = new Map([...initial].map(([id, poll]) => [id, structuredClone(poll)]));
const scenario = process.env.T02_SCENARIO ?? 'normal';
const port = Number(process.env.T02_PORT ?? 3000);
const mediaDelayMs = Number(process.env.T02_MEDIA_DELAY_MS ?? 0);
const independentSnapshots = scenario === 'reorder' || scenario === 'reorder-reverse';
const seed = Number(process.env.T02_SEED ?? fixture.seed);
if (scenario === 'profiling') {
  current.clear();
  for (let index = 0; index < fixture.profiling.count; index += 1) {
    const poll = structuredClone(fixture.cards[(seed + index) % fixture.cards.length]);
    poll.id = `${fixture.profiling.idPrefix}-${seed}-${String(index + 1).padStart(3, '0')}`;
    poll.options = poll.options.map((option, optionIndex) => ({ ...option, id: `${poll.id}-option-${optionIndex}` }));
    current.set(poll.id, poll);
  }
}
let feedRequests = 0;

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function withHost(poll, origin) {
  const result = structuredClone(poll);
  if (result.imageUrl) {
    result.imageUrl = origin + new URL(result.imageUrl).pathname;
    if (mediaDelayMs > 0) result.imageUrl += '?t02=' + process.pid;
  }
  return result;
}
function snapshot(id, kind, value) {
  const poll = structuredClone(independentSnapshots ? initial.get(id) : current.get(id));
  if (!poll) return null;
  if (kind === 'like') {
    poll.viewerHasLiked = value;
    poll.likesCount = Math.max(0, poll.likesCount + (value ? 1 : -1));
  } else if (kind === 'vote' && value) {
    const option = poll.options.find((item) => item.id === value);
    if (option) { option.votesCount += 1; poll.votesCount += 1; poll.viewerVoteOptionId = option.id; }
  }
  if (!independentSnapshots) current.set(id, structuredClone(poll));
  return poll;
}
const authUser = {
  id: 't02-viewer', email: 'viewer@example.test', username: 'viewer', status: 'active',
  profile: { displayName: 'T02 Viewer', pollsCount: 0, followersCount: 0, followingCount: 0, countryCode: 'BY', bio: null, avatarObjectKey: null, avatarUrl: null },
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://' + (request.headers.host ?? 'localhost'));
  const origin = 'http://' + (request.headers.host ?? 'localhost');
  if (url.pathname === '/healthz') return json(response, 200, { ok: true, scenario });
  if (scenario === 'profiling' && url.pathname === '/auth/login' && request.method === 'POST') {
    return json(response, 200, {
      user: authUser,
      accessToken: 't02-profiling-token',
      tokenType: 'Bearer',
      expiresIn: '1h',
    });
  }
  if (url.pathname === '/auth/me' && request.method === 'GET') return json(response, 200, { user: authUser });
  if (url.pathname === '/users' && request.method === 'GET') return json(response, 200, { items: [] });

  if (url.pathname === '/search' && request.method === 'GET') {
    const cursor = url.searchParams.get('cursor');
    const pageIndex = fixture.cursorPages.findIndex((page) => page.cursor === cursor);
    if (pageIndex < 0) return json(response, 400, { error: 'invalid_cursor' });

    const page = fixture.cursorPages[pageIndex];
    const nextCursor = fixture.cursorPages[pageIndex + 1]?.cursor ?? null;
    const items = page.pollIds.map((id) => ({
      type: 'poll',
      score: 1,
      poll: withHost(current.get(id), origin),
    }));
    return json(response, 200, { items, nextCursor });
  }

  if (url.pathname === '/polls' && request.method === 'GET') {
    feedRequests += 1;
    if (scenario === 'error' && feedRequests === 1) return json(response, 503, { error: 'T02 first feed request fails by design' });
    if (scenario === 'timeout') {
      await wait(fixture.network.timeoutMs);
      return json(response, 504, { error: 'T02 feed fixture timeout' });
    }
    if (scenario === 'delay') await wait(fixture.network.delayMs);
    return json(response, 200, { items: [...current.values()].map((poll) => withHost(poll, origin)) });
  }

  const match = url.pathname.match(/^\/polls\/([^/]+)(?:\/(likes|votes))?$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const kind = match[2];
    if (!kind && request.method === 'GET') {
      const poll = current.get(id);
      return poll ? json(response, 200, { poll: withHost(poll, origin) }) : json(response, 404, { error: 'not_found' });
    }
    if (kind && (request.method === 'POST' || request.method === 'DELETE')) {
      const isLike = kind === 'likes';
      let optionId = null;
      if (!isLike && request.method === 'POST') {
        let body = '';
        for await (const chunk of request) body += chunk;
        try { optionId = JSON.parse(body).optionId; } catch {}
      }
      const poll = snapshot(id, isLike ? 'like' : 'vote', isLike ? request.method === 'POST' : optionId);
      if (!poll) return json(response, 404, { error: 'not_found' });
      if (independentSnapshots) {
        const shortResponse = scenario === 'reorder' ? isLike : !isLike;
        await wait(shortResponse ? fixture.network.reorderLikeMs : fixture.network.reorderVoteMs);
      }
      return json(response, 201, { poll: withHost(poll, origin) });
    }
  }

  if (url.pathname.startsWith('/media/') && mediaDelayMs > 0) await wait(mediaDelayMs);
  if (url.pathname === '/media/landscape-16x9.svg' || url.pathname === '/media/portrait-4x5.svg') {
    const name = url.pathname.endsWith('landscape-16x9.svg') ? 'landscape-16x9.svg' : 'portrait-4x5.svg';
    response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    return response.end(readFileSync(join(root, 'test/fixtures/media', name)));
  }
  if (url.pathname === '/media/missing.svg') return json(response, 404, { error: 'fixture image intentionally missing' });
  return json(response, 404, { error: 'not_found', path: url.pathname });
});

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url ?? '/', 'http://' + (request.headers.host ?? 'localhost'));
  const key = request.headers['sec-websocket-key'];
  if (url.pathname !== '/realtime' || typeof key !== 'string') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }

  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  let buffered = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      const first = buffered[0];
      const second = buffered[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        const longLength = buffered.readBigUInt64BE(2);
        if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) return socket.destroy();
        length = Number(longLength);
        offset = 10;
      }
      let mask = null;
      if (masked) {
        if (buffered.length < offset + 4) return;
        mask = Buffer.from(buffered.subarray(offset, offset + 4));
        offset += 4;
      }
      if (buffered.length < offset + length) return;
      const payload = Buffer.from(buffered.subarray(offset, offset + length));
      buffered = buffered.subarray(offset + length);
      if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      if (opcode === 8) return socket.end();
      if (opcode === 9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
      } else if (opcode === 1) {
        try {
          const message = JSON.parse(payload.toString('utf8'));
          if (message.type === 'ping') {
            const response = Buffer.from(JSON.stringify({ type: 'pong' }));
            socket.write(Buffer.concat([Buffer.from([0x81, response.length]), response]));
          }
        } catch {}
      }
    }
  });
});

server.listen(port, process.env.T02_HOST ?? '0.0.0.0', () => {
  console.log('T02 baseline fixture server listening on port ' + port + ' (scenario: ' + scenario + ', media delay: ' + mediaDelayMs + ' ms)');
  console.log('Scenarios: normal, delay, reorder, reorder-reverse, error, timeout, profiling (seed: ' + seed + ')');
});
