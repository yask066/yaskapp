import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const cdpBase = process.env.M17_CDP_BASE ?? 'http://127.0.0.1:9335';
const appUrl = process.env.M17_APP_URL ?? 'http://127.0.0.1:4173/';
const outputDir = resolve(process.env.M17_OUTPUT_DIR ?? 'docs/motion-scroll-loading-evidence');
const runDurationMs = Number(process.env.M17_RUN_DURATION_MS ?? 30_000);
const categories = ['disabled-by-default-devtools.timeline.frame', 'viz'].join(',');
mkdirSync(outputDir, { recursive: true });

class CdpConnection {
  nextId = 1;
  pending = new Map();
  listeners = new Map();
  socket;

  static async open(url) {
    const connection = new CdpConnection();
    connection.socket = new WebSocket(url);
    await new Promise((resolveOpen, reject) => {
      connection.socket.addEventListener('open', resolveOpen, { once: true });
      connection.socket.addEventListener('error', reject, { once: true });
    });
    connection.socket.addEventListener('message', (event) => connection.#onMessage(event.data));
    return connection;
  }

  #onMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params, message.sessionId);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolveCommand, reject) => {
      this.pending.set(id, { resolve: resolveCommand, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  off(method, listener) {
    this.listeners.set(method, (this.listeners.get(method) ?? []).filter((entry) => entry !== listener));
  }

  waitFor(method, sessionId, timeoutMs = 15_000) {
    return new Promise((resolveEvent, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const listener = (params, eventSessionId) => {
        if (sessionId && eventSessionId !== sessionId) return;
        clearTimeout(timer);
        this.listeners.set(method, (this.listeners.get(method) ?? []).filter((entry) => entry !== listener));
        resolveEvent(params);
      };
      this.on(method, listener);
    });
  }

  close() {
    this.socket.close();
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * p)];
}

const version = await fetch(`${cdpBase}/json/version`).then((response) => response.json());
const browser = await CdpConnection.open(version.webSocketDebuggerUrl);
let page;
try {
  const target = await browser.send('Target.createTarget', { url: 'about:blank' });
  const attached = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  page = { sessionId, targetId: target.targetId };

  const windowInfo = await browser.send('Browser.getWindowForTarget', { targetId: page.targetId });
  await browser.send('Browser.setWindowBounds', {
    windowId: windowInfo.windowId,
    bounds: { windowState: 'maximized' },
  });

  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.navigate', { url: appUrl }, sessionId);

  let pageState;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    const evaluated = await browser.send('Runtime.evaluate', {
      expression: `JSON.stringify({ready:document.readyState,title:document.title,url:location.href,cards:document.querySelectorAll('.feed-list > *').length,innerWidth,innerHeight,screenWidth:screen.width,screenHeight:screen.height,devicePixelRatio,scrollHeight:document.scrollingElement?.scrollHeight,clientHeight:document.scrollingElement?.clientHeight})`,
      returnByValue: true,
    }, sessionId);
    pageState = JSON.parse(evaluated.result.value);
    if (pageState.ready === 'complete' && pageState.cards === 100) break;
  }
  if (!pageState || pageState.cards !== 100) {
    throw new Error(`Expected 100 fixture cards before profiling; observed ${JSON.stringify(pageState)}`);
  }
  const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  writeFileSync(join(outputDir, 'm17-chrome-physical-desktop.png'), Buffer.from(screenshot.data, 'base64'));

  let gpuInfo = null;
  try { gpuInfo = await browser.send('SystemInfo.getInfo'); } catch (error) { gpuInfo = { error: String(error) }; }
  writeFileSync(join(outputDir, 'm17-chrome-physical-gpu.json'), JSON.stringify(gpuInfo, null, 2));

  const runs = [];
  for (let run = 1; run <= 3; run += 1) {
    await browser.send('Runtime.evaluate', {
      expression: 'window.scrollTo({top:0,behavior:"instant"}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);

    const traceEvents = [];
    const collectTraceData = (params, eventSessionId) => {
      if (eventSessionId === sessionId) traceEvents.push(...params.value);
    };
    browser.on('Tracing.dataCollected', collectTraceData);
    const tracingComplete = browser.waitFor('Tracing.tracingComplete', sessionId, runDurationMs + 60_000);
    await browser.send('Tracing.start', {
      categories,
      transferMode: 'ReportEvents',
    }, sessionId);

    const workload = await browser.send('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const start = performance.now();
        const durationMs = ${runDurationMs};
        let frameCallbacks = 0;
        let initialScroll = window.scrollY;
        function step() {
          frameCallbacks += 1;
          window.scrollTo({top: window.scrollY + 32, behavior: 'instant'});
          if (performance.now() - start >= durationMs) {
            resolve({durationMs: performance.now() - start, frameCallbacks, initialScroll, finalScroll: window.scrollY, scrollHeight: document.scrollingElement.scrollHeight, viewportHeight: window.innerHeight});
          } else requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      })`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    await browser.send('Tracing.end', {}, sessionId);
    await tracingComplete;
    browser.off('Tracing.dataCollected', collectTraceData);

    const beginFramesBySource = new Map();
    for (const event of traceEvents) {
      if (event.name !== 'DisplayScheduler::BeginFrame') continue;
      const args = event.args?.args;
      if (args?.sequence_number === undefined || args?.frame_time_us === undefined) continue;
      const sourceId = String(args.source_id ?? 'unknown');
      const sourceFrames = beginFramesBySource.get(sourceId) ?? new Map();
      sourceFrames.set(args.sequence_number, {
        sequence: args.sequence_number,
        frameTimeUs: args.frame_time_us,
        subtype: args.subtype,
        intervalUs: args.interval_us,
      });
      beginFramesBySource.set(sourceId, sourceFrames);
    }
    const sourceSummaries = [...beginFramesBySource.entries()].map(([sourceId, events]) => ({
      sourceId,
      beginFrames: events.size,
      missedBeginFrames: [...events.values()].filter((event) => event.subtype === 'MISSED').length,
    })).sort((a, b) => b.beginFrames - a.beginFrames);
    const profiledSourceId = sourceSummaries[0]?.sourceId;
    const begins = [...(beginFramesBySource.get(profiledSourceId)?.values() ?? [])]
      .sort((a, b) => a.frameTimeUs - b.frameTimeUs);
    const intervalsMs = begins.slice(1).map((event, index) => (event.frameTimeUs - begins[index].frameTimeUs) / 1000);
    const missedSequences = new Set(begins.filter((event) => event.subtype === 'MISSED').map((event) => event.sequence));
    const result = {
      run,
      durationMs: workload.result.value.durationMs,
      animationFrameCallbacks: workload.result.value.frameCallbacks,
      scrollStartCssPx: workload.result.value.initialScroll,
      scrollEndCssPx: workload.result.value.finalScroll,
      totalScrollableHeightCssPx: workload.result.value.scrollHeight,
      viewportHeightCssPx: workload.result.value.viewportHeight,
      traceEvents: traceEvents.length,
      drawFrames: traceEvents.filter((event) => event.name === 'DrawFrame').length,
      beginFrameSourceId: profiledSourceId,
      beginFrames: begins.length,
      missedBeginFrames: missedSequences.size,
      beginFrameSources: sourceSummaries,
      refreshCadenceHz: Math.round(1_000_000 / (percentile(begins.map((event) => event.intervalUs ?? 0), 0.5) || 1)),
      beginFrameIntervalP95Ms: percentile(intervalsMs, 0.95),
      beginFrameIntervalMaxMs: intervalsMs.length ? Math.max(...intervalsMs) : null,
      trace: `m17-chrome-physical-desktop-${run}.trace.json.gz`,
    };
    writeFileSync(join(outputDir, result.trace), gzipSync(JSON.stringify({ traceEvents })));
    runs.push(result);
    console.log(JSON.stringify(result));
  }

  const finalGeometry = await browser.send('Runtime.evaluate', {
    expression: `JSON.stringify({innerWidth,innerHeight,outerWidth,outerHeight,screenWidth:screen.width,screenHeight:screen.height,devicePixelRatio,visualViewport:{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale},userAgent:navigator.userAgent})`,
    returnByValue: true,
  }, sessionId);
  const summary = {
    capturedAt: new Date().toISOString(),
    build: '@yaskapp/web production build',
    sourceCommit: '9f57952de060cbd33897c2c31cfde4885eb4296f',
    fixture: { source: 'test/fixtures/t02-motion-scroll-loading-polls.json', seed: 20261002, uniquePolls: pageState.cards },
    browser: { version: version.Browser, userAgent: version['User-Agent'], headless: false, gpu: gpuInfo },
    display: { windowsDisplay: 'DISPLAY1', physicalMode: '1680x1050 @ 60 Hz', chromeScreenBoundsFromStartupLog: '1403x877 CSS px, scale 1.19792', page: JSON.parse(finalGeometry.result.value) },
    workload: { durationMs: runDurationMs, scrollStepCssPxPerAnimationFrame: 32, scrollBehavior: 'instant', traceCategories: categories.split(',') },
    runs,
  };
  writeFileSync(join(outputDir, 'm17-chrome-physical-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ event: 'summary', output: join(outputDir, 'm17-chrome-physical-summary.json'), browser: summary.browser.version, display: summary.display.page, runs: runs.length }));
} finally {
  // Leave the profiled page visible in the physical Chrome window for review.
  browser.close();
}
