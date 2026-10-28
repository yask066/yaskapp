import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { arch, cpus, platform, tmpdir, totalmem } from 'node:os';
import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const repo = process.cwd();
const dist = resolve(repo, 'apps/web/dist');
const evidence = resolve(repo, 'docs/pagination-evidence');
const tempRoot = process.env.T27_TEMP_DIR || join(tmpdir(), 'yaskapp-t27');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!existsSync(join(dist, 'index.html'))) throw new Error('Build the production web app before capture.');
if (!existsSync(chromePath)) throw new Error('Chrome not found: ' + chromePath);
mkdirSync(tempRoot, { recursive: true });
const profileDir = join(tempRoot, 't27-chrome-' + process.pid);
mkdirSync(profileDir, { recursive: true });

let datasetSize = 100;
let commentSize = 100;
let activeRequests = 0;
let pollRequests = 0;
const requestLog = [];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
};
const makePoll = (index) => {
  const suffix = String(index + 1).padStart(12, '0');
  const authorId = '20000000-0000-4000-8000-000000000001';
  return {
    id: '10000000-0000-4000-8000-' + suffix,
    author: { id: authorId, username: 'fixture-author', displayName: 'Performance Fixture', avatarObjectKey: null, avatarUrl: null },
    question: 'Synthetic T27 feed card ' + String(index + 1).padStart(4, '0') + ': which option should we choose?',
    imageUrl: null,
    options: [
      { id: '30000000-0000-4000-8000-' + suffix, text: 'Option A', position: 0, votesCount: 12 },
      { id: '40000000-0000-4000-8000-' + suffix, text: 'Option B', position: 1, votesCount: 8 },
    ],
    votesCount: 20,
    commentsCount: index % 17,
    likesCount: index % 31,
    viewerHasLiked: false,
    allowVoteCancellation: true,
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
    viewerVoteOptionId: null,
    endsAt: null,
  };
};
const makeComment = (index, pollId, parentCommentId = null) => {
  const suffix = String(index + 1).padStart(12, '0');
  const reply = parentCommentId !== null;
  return {
    id: (reply ? '60000000-0000-4000-8000-' : '50000000-0000-4000-8000-') + suffix,
    pollId,
    author: { id: '20000000-0000-4000-8000-000000000001', username: 'fixture-author', displayName: 'Performance Fixture', avatarObjectKey: null, avatarUrl: null },
    body: 'Synthetic ' + (reply ? 'reply ' : 'root comment ') + String(index + 1).padStart(4, '0') + ': a deterministic pagination profile item.',
    likesCount: index % 23,
    viewerHasLiked: false,
    parentCommentId,
    repliesCount: reply ? 0 : 65,
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - index * 60_000).toISOString(),
  };
};
const server = createServer(async (req, res) => {
  activeRequests += 1;
  let counted = false;
  const done = () => { if (!counted) { counted = true; activeRequests -= 1; } };
  res.once('finish', done);
  res.once('close', done);
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    requestLog.push(url.pathname + url.search);
    if (url.pathname === '/__control') {
      const count = Math.max(1, Math.min(1000, Number(url.searchParams.get('count')) || 100));
      if (url.searchParams.get('kind') === 'comments') commentSize = count;
      else datasetSize = count;
      json(res, 200, { datasetSize, commentSize });
      return;
    }
    if (req.headers.accept?.includes('text/html') && url.pathname !== '/auth/me') {
      const body = readFileSync(join(dist, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    if (url.pathname === '/auth/me') {
      json(res, 401, { error: 'unauthorized', message: 'No session in synthetic performance fixture.' });
      return;
    }
    if (url.pathname === '/polls') {
      pollRequests += 1;
      await delay(12);
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
      const cursor = url.searchParams.get('cursor');
      const start = cursor && cursor.startsWith('offset:') ? Number(cursor.slice(7)) || 0 : 0;
      const end = Math.min(datasetSize, start + limit);
      const items = Array.from({ length: Math.max(0, end - start) }, (_, offset) => makePoll(start + offset));
      json(res, 200, { items, nextCursor: end < datasetSize ? 'offset:' + end : null });
      return;
    }
    const repliesMatch = url.pathname.match(/^\/polls\/([^/]+)\/comments\/([^/]+)\/replies$/);
    if (repliesMatch) {
      await delay(12);
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
      const cursor = url.searchParams.get('cursor');
      const start = cursor && cursor.startsWith('replyoffset:') ? Number(cursor.slice(12)) || 0 : 0;
      const end = Math.min(65, start + limit);
      const items = Array.from({ length: Math.max(0, end - start) }, (_, offset) => makeComment(start + offset, repliesMatch[1], repliesMatch[2]));
      json(res, 200, { items, nextCursor: end < 65 ? 'replyoffset:' + end : null });
      return;
    }
    const commentsMatch = url.pathname.match(/^\/polls\/([^/]+)\/comments$/);
    if (commentsMatch) {
      await delay(12);
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
      const cursor = url.searchParams.get('cursor');
      const start = cursor && cursor.startsWith('commentoffset:') ? Number(cursor.slice(14)) || 0 : 0;
      const end = Math.min(commentSize, start + limit);
      const items = Array.from({ length: Math.max(0, end - start) }, (_, offset) => makeComment(start + offset, commentsMatch[1]));
      json(res, 200, { items, nextCursor: end < commentSize ? 'commentoffset:' + end : null });
      return;
    }
    const pollMatch = url.pathname.match(/^\/polls\/([^/]+)$/);
    if (pollMatch) {
      json(res, 200, { poll: makePoll(0) });
      return;
    }
    if (url.pathname === '/users') {
      json(res, 200, { items: [] });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 404, { error: 'not_found' });
      return;
    }
    let file = resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (file !== dist && !file.startsWith(dist + '\\') && !file.startsWith(dist + '/')) {
      json(res, 400, { error: 'invalid_path' });
      return;
    }
    if (!existsSync(file) || !extname(file)) file = join(dist, 'index.html');
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: 'fixture_error', message: String(error) });
    else res.destroy(error);
  }
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const sitePort = server.address().port;
const site = 'http://127.0.0.1:' + sitePort;
const findFreePort = async () => {
  const probe = createServer();
  await new Promise((resolveListen) => probe.listen(0, '127.0.0.1', resolveListen));
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
};
const cdpPort = await findFreePort();
const chromeFlags = [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + cdpPort, '--remote-allow-origins=*', '--user-data-dir=' + profileDir,
  '--window-size=1440,1000', '--force-device-scale-factor=1', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', 'about:blank',
];
const chrome = spawn(chromePath, chromeFlags, { stdio: 'ignore', windowsHide: true });
let chromeExit = null;
chrome.once('exit', (code, signal) => { chromeExit = { code, signal }; });

class Cdp {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
      } else if (message.method) {
        for (const handler of this.handlers.get(message.method) || []) handler(message.params || {});
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolveReply, rejectReply) => {
      const timer = setTimeout(() => { this.pending.delete(id); rejectReply(new Error('CDP timeout: ' + method)); }, 180_000);
      this.pending.set(id, { resolve: resolveReply, reject: rejectReply, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  waitFor(method) {
    return new Promise((resolveEvent) => {
      const handlers = this.handlers.get(method) || new Set();
      const handler = (params) => { handlers.delete(handler); resolveEvent(params); };
      handlers.add(handler);
      this.handlers.set(method, handlers);
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed.');
    return result.result?.value;
  }
  close() { try { this.socket.close(); } catch {} }
}

let session;
let targetId;
const summaries = [];
const cycles = [];
const round = (value) => Number(value.toFixed(2));
const startMetrics = "(() => { const state = { samples: [], last: null, active: true, longTasks: 0, observer: null }; window.__t27Metrics = state; if ('PerformanceObserver' in window) { try { state.observer = new PerformanceObserver((list) => { state.longTasks += list.getEntries().length; }); state.observer.observe({ type: 'longtask', buffered: true }); } catch {} } const tick = (time) => { if (state.last !== null) state.samples.push(time - state.last); state.last = time; if (state.active) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()";
const stopMetrics = "(() => { const state = window.__t27Metrics; if (!state) return null; state.active = false; state.observer?.disconnect(); const rawValues = state.samples.slice(); const values = rawValues.slice().sort((a, b) => a - b); const overBudget = rawValues.filter((value) => value > 16.7).length; const percentile = (p) => values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))] : 0; const heap = performance.memory ? performance.memory.usedJSHeapSize : null; return { frameSamples: values.length, framesOver16_7ms: overBudget, framesOverBudgetPercent: values.length ? overBudget * 100 / values.length : 0, frameIntervalsMs: rawValues, p95FrameMs: percentile(0.95), p99FrameMs: percentile(0.99), maxFrameMs: values.length ? values[values.length - 1] : 0, longTasks: state.longTasks, usedJsHeapBytes: heap }; })()";
const cardCount = "document.querySelectorAll('.poll-card').length";
const commentCount = "document.querySelectorAll('.comment-list > .content-entry-transition > ul > li.comment-card').length";
const waitForPolls = async (minimum, timeoutMs = 20_000) => {
  const started = Date.now();
  let count = 0;
  while (Date.now() - started < timeoutMs) {
    count = await session.evaluate(cardCount);
    if (count >= minimum) return count;
    await delay(40);
  }
  throw new Error('Timed out waiting for ' + minimum + ' cards; found ' + count + '.');
};
const waitForComments = async (minimum, timeoutMs = 20_000) => {
  const started = Date.now();
  let count = 0;
  while (Date.now() - started < timeoutMs) {
    count = await session.evaluate(commentCount);
    if (count >= minimum) return count;
    await delay(40);
  }
  const page = await session.evaluate("JSON.stringify({ href: location.href, title: document.title, body: document.body?.innerText?.slice(0, 1200), comments: document.querySelector('.comment-list')?.outerHTML?.slice(0, 1000) })").catch(() => '<page unavailable>');
  throw new Error('Timed out waiting for ' + minimum + ' root comments; found ' + count + '. page=' + page + ' requests=' + JSON.stringify(requestLog.slice(-20)));
};
const setDataset = async (count) => {
  await fetch(site + '/__control?count=' + count);
};
const navigateTo = async (url) => {
  await session.send('Page.navigate', { url });
  await waitForPolls(Math.min(datasetSize, 20));
  await delay(150);
};
const loadAndScroll = async (target) => {
  const startedAt = Date.now();
  let count = await session.evaluate(cardCount);
  while (count < target) {
    const state = await session.evaluate("(() => { const footer = document.querySelector('.pagination-footer'); const status = footer?.querySelector('[role=status]')?.textContent || ''; const button = [...(footer?.querySelectorAll('button') || [])].find((candidate) => candidate.textContent?.includes('Load more') || candidate.textContent?.includes('Retry loading more')); return { busy: status.includes('Loading more'), canLoadMore: Boolean(button && button.getAttribute('aria-disabled') !== 'true') }; })()");
    if (state.canLoadMore && !state.busy) {
      await session.evaluate("(() => { const footer = document.querySelector('.pagination-footer'); const button = [...(footer?.querySelectorAll('button') || [])].find((candidate) => candidate.textContent?.includes('Load more') || candidate.textContent?.includes('Retry loading more')); button?.click(); return true; })()");
    } else if (!state.busy && !state.canLoadMore) {
      throw new Error('No manual pagination control while waiting for ' + target + ' cards; found ' + count + '.');
    }
    count = await waitForPolls(Math.min(target, count + 20), 15_000);
  }
  const scroll = await session.evaluate("(async () => { const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight); for (let step = 1; step <= 8; step += 1) { window.scrollTo({ top: max * step / 8, behavior: 'smooth' }); await pause(350); } window.scrollTo({ top: max, behavior: 'smooth' }); await pause(600); return { scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, pollCards: document.querySelectorAll('.poll-card').length }; })()");
  return { ...scroll, count, loadMs: Date.now() - startedAt };
};
const tracePage = async (name, count) => {
  await setDataset(count);
  await navigateTo(site + '/?t27=' + name);
  await session.evaluate(startMetrics);
  const complete = session.waitFor('Tracing.tracingComplete');
  await session.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing,v8.execute,disabled-by-default-v8.gc', transferMode: 'ReturnAsStream' });
  const scroll = await loadAndScroll(count);
  const frameMetrics = await session.evaluate(stopMetrics);
  await session.send('Tracing.end');
  const trace = await complete;
  const parts = [];
  let eof = false;
  while (!eof) {
    const chunk = await session.send('IO.read', { handle: trace.stream, size: 1_048_576 });
    parts.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : Buffer.from(chunk.data || ''));
    eof = Boolean(chunk.eof);
  }
  await session.send('IO.close', { handle: trace.stream });
  const raw = Buffer.concat(parts);
  const parsed = JSON.parse(raw.toString('utf8'));
  const compressed = gzipSync(raw, { level: 6 });
  const file = join(evidence, 't27-web-' + count + '-trace.json.gz');
  writeFileSync(file, compressed);
  const summary = {
    dataset: count,
    cardsRendered: scroll.count,
    scrollIterations: scroll.iterations,
    scrollHeightCssPx: scroll.scrollHeight,
    frameMetrics: Object.fromEntries(Object.entries(frameMetrics).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value])),
    pollRequests: pollRequests,
    traceEventCount: Array.isArray(parsed.traceEvents) ? parsed.traceEvents.length : null,
    droppedFrameEvents: Array.isArray(parsed.traceEvents) ? parsed.traceEvents.filter((event) => event.name === 'DroppedFrame').length : null,
    beginFrameEvents: Array.isArray(parsed.traceEvents) ? parsed.traceEvents.filter((event) => event.name === 'BeginFrame').length : null,
    droppedFramePercent: Array.isArray(parsed.traceEvents) ? round(parsed.traceEvents.filter((event) => event.name === 'DroppedFrame').length * 100 / Math.max(1, parsed.traceEvents.filter((event) => event.name === 'BeginFrame').length)) : null,
    tracePath: 'docs/pagination-evidence/' + file.split(/[\\/]/).at(-1),
    traceBytesGzip: compressed.length,
    traceSha256: createHash('sha256').update(compressed).digest('hex'),
  };
  summaries.push(summary);
  await session.send('Page.navigate', { url: 'about:blank' });
  await delay(120);
  return summary;
};
const commentPollId = '10000000-0000-4000-8000-000000000001';
const navigateToComments = async (name, count) => {
  await fetch(site + '/__control?kind=comments&count=' + count);
  await session.send('Page.navigate', { url: site + '/polls/' + commentPollId + '?t27comments=' + name });
  await waitForComments(Math.min(count, 20));
  await delay(150);
};
const appendRootComments = async (target) => {
  let count = await session.evaluate(commentCount);
  while (count < target) {
    const state = await session.evaluate("(() => { const footer = document.querySelector('.pagination-footer'); const status = footer?.querySelector('[role=status]')?.textContent || ''; const button = [...(footer?.querySelectorAll('button') || [])].find((candidate) => candidate.textContent?.includes('Load more') || candidate.textContent?.includes('Retry loading more')); return { busy: status.includes('Loading more'), canLoadMore: Boolean(button && !button.disabled), footer: footer?.outerHTML || null }; })()");
    if (state.canLoadMore && !state.busy) {
      await session.evaluate("(() => { const footer = document.querySelector('.pagination-footer'); const button = [...(footer?.querySelectorAll('button') || [])].find((candidate) => candidate.textContent?.includes('Load more') || candidate.textContent?.includes('Retry loading more')); button?.click(); return true; })()");
    } else if (!state.busy && !state.canLoadMore) {
      throw new Error('No manual root-comment pagination control; found ' + count + ' of ' + target + '. footer=' + JSON.stringify(state.footer) + ' requests=' + JSON.stringify(requestLog.slice(-10)));
    }
    count = await waitForComments(Math.min(target, count + 20), 15_000);
  }
  return count;
};
const scrollDocument = async () => session.evaluate("(async () => { const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight); for (let step = 1; step <= 8; step += 1) { window.scrollTo({ top: max * step / 8, behavior: 'smooth' }); await pause(350); } window.scrollTo({ top: max, behavior: 'smooth' }); await pause(600); return { scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight }; })()");
const traceComments = async (name, count, withBranches = false) => {
  await navigateToComments(name, count);
  await session.evaluate(startMetrics);
  const complete = session.waitFor('Tracing.tracingComplete');
  await session.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing,v8.execute,disabled-by-default-v8.gc', transferMode: 'ReturnAsStream' });
  const roots = await appendRootComments(count);
  let repliesLoaded = 0;
  if (withBranches) {
    const expanded = await session.evaluate("(() => { const toggles = [...document.querySelectorAll('.comment-thread__toggle')].slice(0, 3); toggles.forEach((button) => { if (button.getAttribute('aria-expanded') !== 'true') button.click(); }); return toggles.length; })()");
    if (expanded !== 3) throw new Error('Expected three reply branches, found ' + expanded + '.');
    const waitForReplies = async () => {
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const current = await session.evaluate("[...document.querySelectorAll('.comment-thread')].slice(0, 3).map((thread) => thread.querySelectorAll('.comment-thread__reply').length)");
        if (current.every((value) => value >= 20)) return current;
        await delay(40);
      }
      throw new Error('Timed out waiting for first reply pages.');
    };
    await waitForReplies();
    for (let index = 0; index < 3; index += 1) {
      while (true) {
        const branchCount = await session.evaluate("document.querySelectorAll('.comment-thread')[" + index + "]?.querySelectorAll('.comment-thread__reply').length || 0");
        if (branchCount >= 65) break;
        const clicked = await session.evaluate("(() => { const thread = document.querySelectorAll('.comment-thread')[" + index + "]; const button = [...(thread?.querySelectorAll('button') || [])].find((candidate) => candidate.textContent?.includes('Load more replies') || candidate.textContent?.includes('Retry loading more replies')); if (!button || button.disabled) return false; button.click(); return true; })()");
        if (!clicked) throw new Error('No manual replies pagination control for branch ' + index + '.');
        const expected = Math.min(65, branchCount + 20);
        for (let attempt = 0; attempt < 500; attempt += 1) {
          const next = await session.evaluate("document.querySelectorAll('.comment-thread')[" + index + "]?.querySelectorAll('.comment-thread__reply').length || 0");
          if (next >= expected) break;
          await delay(40);
        }
      }
    }
    repliesLoaded = await session.evaluate("[...document.querySelectorAll('.comment-thread')].slice(0, 3).reduce((total, thread) => total + thread.querySelectorAll('.comment-thread__reply').length, 0)");
  }
  const scroll = await scrollDocument();
  const frameMetrics = await session.evaluate(stopMetrics);
  await session.send('Tracing.end');
  const trace = await complete;
  const parts = [];
  let eof = false;
  while (!eof) {
    const chunk = await session.send('IO.read', { handle: trace.stream, size: 1_048_576 });
    parts.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : Buffer.from(chunk.data || ''));
    eof = Boolean(chunk.eof);
  }
  await session.send('IO.close', { handle: trace.stream });
  const raw = Buffer.concat(parts);
  const parsed = JSON.parse(raw.toString('utf8'));
  const compressed = gzipSync(raw, { level: 6 });
  const file = join(evidence, 't27-web-' + name + '-trace.json.gz');
  writeFileSync(file, compressed);
  const dropped = parsed.traceEvents.filter((event) => event.name === 'DroppedFrame').length;
  const begins = parsed.traceEvents.filter((event) => event.name === 'BeginFrame').length;
  const summary = {
    scenario: name,
    rootCommentsRendered: roots,
    expandedBranches: withBranches ? 3 : 0,
    repliesRendered: repliesLoaded,
    scrollHeightCssPx: scroll.scrollHeight,
    frameMetrics: Object.fromEntries(Object.entries(frameMetrics).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value])),
    droppedFrameEvents: dropped,
    beginFrameEvents: begins,
    droppedFramePercent: round(dropped * 100 / Math.max(1, begins)),
    traceEventCount: parsed.traceEvents.length,
    tracePath: 'docs/pagination-evidence/' + file.split(/[\\/]/).at(-1),
    traceBytesGzip: compressed.length,
    traceSha256: createHash('sha256').update(compressed).digest('hex'),
  };
  summaries.push(summary);
  await session.send('Page.navigate', { url: 'about:blank' });
  await delay(120);
  return summary;
};
const collectGarbage = async () => { try { await session.send('HeapProfiler.collectGarbage'); } catch {} };
const heapUsage = async () => { try { const value = await session.send('Runtime.getHeapUsage'); return value.usedSize; } catch { return null; } };
const domCounters = async () => { try { return await session.send('Memory.getDOMCounters'); } catch { return null; } };

try {
  const chromeReady = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch('http://127.0.0.1:' + cdpPort + '/json/version');
        if (response.ok) return response.json();
      } catch {}
      if (chromeExit) throw new Error('Chrome exited before CDP became available: ' + JSON.stringify(chromeExit));
      await delay(100);
    }
    throw new Error('Timed out waiting for Chrome DevTools.');
  };
  const browser = await chromeReady();
  const create = await fetch('http://127.0.0.1:' + cdpPort + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
  if (!create.ok) throw new Error('Could not create Chrome page: ' + create.status);
  const target = await create.json();
  targetId = target.id;
  session = new Cdp(target.webSocketDebuggerUrl);
  await session.ready;
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('HeapProfiler.enable');
  if (process.env.T27_SKIP_FEED !== '1') {
    await tracePage('100', 100);
    await tracePage('1000', 1000);
  }
  await traceComments('comments-100', 100);
  await traceComments('comments-1000', 1000);
  await traceComments('comments-100-3branches', 100, true);

  await session.send('Page.navigate', { url: 'about:blank' });
  await delay(120);
  await collectGarbage();
  const baseline = { heapUsedBytes: await heapUsage(), dom: await domCounters() };
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    await setDataset(200);
    await navigateTo(site + '/?t27-lifecycle=' + cycle);
    const load = await loadAndScroll(200);
    await collectGarbage();
    const heapAtExit = await heapUsage();
    await session.send('Page.navigate', { url: 'about:blank' });
    await delay(120);
    await collectGarbage();
    const after = { heapUsedBytes: await heapUsage(), dom: await domCounters() };
    cycles.push({ cycle, cardsLoaded: load.count, heapAtExitBytes: heapAtExit, afterExit: after, activeRequests: activeRequests });
  }
  const afterHeaps = cycles.map((cycle) => cycle.afterExit.heapUsedBytes).filter((value) => value !== null);
  const nonMonotonic = afterHeaps.length === 3 && !(afterHeaps[0] < afterHeaps[1] && afterHeaps[1] < afterHeaps[2]);
  const results = {
    capturedAt: new Date().toISOString(),
    browser: browser.Browser,
    userAgent: browser['User-Agent'],
    datasetDescription: 'Local deterministic synthetic public feed; 20 items per page; 12 ms response delay; production Vite build.',
    perfBudget: 'PRD web target: fewer than 5% of measured animation-frame intervals exceed 16.7 ms. This headless capture does not meet that threshold and does not establish physical-display performance.',
    metricNote: 'Chrome compositor DroppedFrame/BeginFrame counts are supplementary diagnostics, not the PRD frame-duration metric. Raw requestAnimationFrame intervals are included in each frameMetrics object.',
    traces: summaries,
    captureConditions: {
      viewport: '1440x1000 CSS px',
      deviceScaleFactor: 1,
      browser: browser.Browser,
      platform: `${platform()} ${arch()}`,
      cpuModel: cpus()[0]?.model || null,
      logicalCpuCount: cpus().length,
      physicalMemoryBytes: totalmem(),
      gpu: 'GPU acceleration disabled with --disable-gpu; host adapter was not recorded.',
      chromePath: chromePath.split(/[\\/]/).pop(),
      chromeFlags,
      pageSize: 20,
      responseDelayMs: 12,
      profile: 'production Vite build; synthetic local API; no authenticated personal data',
    },
    lifecycle: { baseline, cycles, afterExitHeapNonMonotonic: nonMonotonic, allRequestsSettledAtEnd: activeRequests === 0 },
  };
  const summaryPath = join(evidence, 't27-web-profile-results.json');
  writeFileSync(summaryPath, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  session?.close();
  if (chrome && chrome.exitCode === null) chrome.kill();
  await new Promise((resolveClose) => server.close(resolveClose));
}
