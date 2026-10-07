import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.env.M17_WEB_ROOT ?? 'apps/web/dist');
const port = Number(process.env.M17_WEB_PORT ?? 4173);
const apiPort = Number(process.env.M17_API_PORT ?? 3128);
const apiPrefixes = ['/api', '/auth', '/polls', '/users', '/profiles', '/search', '/media'];
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function isApiPath(pathname) {
  return apiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

const server = createServer((incoming, outgoing) => {
  const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
  if (url.pathname === '/__profile_health') {
    outgoing.writeHead(200, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ ok: true, root, apiPort }));
    return;
  }
  if (isApiPath(url.pathname)) {
    const proxy = httpRequest({
      hostname: '127.0.0.1',
      port: apiPort,
      path: `${url.pathname}${url.search}`,
      method: incoming.method,
      headers: { ...incoming.headers, host: `127.0.0.1:${apiPort}` },
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    proxy.on('error', (error) => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'text/plain' });
      outgoing.end(`Fixture proxy error: ${error.message}`);
    });
    incoming.pipe(proxy);
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    outgoing.writeHead(400).end('Bad path');
    return;
  }
  const relative = normalize(pathname).replace(/^([/\\]|\.\.(?:[/\\]|$))+/g, '');
  let file = resolve(join(root, relative));
  if (file !== root && !file.startsWith(`${root}\\`)) {
    outgoing.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if (!statSync(file).isFile()) file = join(root, 'index.html');
  } catch {
    file = join(root, 'index.html');
  }
  outgoing.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': mimeTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(outgoing);
});

server.on('upgrade', (incoming, socket, head) => {
  const proxy = httpRequest({
    hostname: '127.0.0.1',
    port: apiPort,
    path: incoming.url,
    method: incoming.method,
    headers: { ...incoming.headers, host: `127.0.0.1:${apiPort}` },
  });
  proxy.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) for (const item of value) socket.write(`${name}: ${item}\r\n`);
      else if (value !== undefined) socket.write(`${name}: ${value}\r\n`);
    }
    socket.write('\r\n');
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket);
    upstreamSocket.pipe(socket);
  });
  proxy.on('error', () => socket.destroy());
  proxy.end();
});

server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'listening', port, root, apiPort }));
});
