import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const evidenceDir = resolve(process.env.M17_OUTPUT_DIR ?? 'docs/motion-scroll-loading-evidence');
const summaryPath = join(evidenceDir, 'm17-chrome-physical-summary.json');
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * p)];
}

function completeSliceStats(events, name) {
  const durationsMs = events
    .filter((event) => event.name === name && event.ph === 'X' && Number.isFinite(event.dur))
    .map((event) => event.dur / 1000);
  return {
    count: durationsMs.length,
    p95Ms: percentile(durationsMs, 0.95),
    maxMs: durationsMs.length ? Math.max(...durationsMs) : null,
  };
}

for (const run of summary.runs) {
  const tracePath = join(evidenceDir, run.trace);
  const events = JSON.parse(gunzipSync(readFileSync(tracePath))).traceEvents;
  const sourceEvents = new Map();
  for (const event of events) {
    if (event.name !== 'DisplayScheduler::BeginFrame') continue;
    const args = event.args?.args;
    if (!args || args.sequence_number === undefined || args.frame_time_us === undefined) continue;
    const sourceId = String(args.source_id ?? 'unknown');
    const frames = sourceEvents.get(sourceId) ?? new Map();
    frames.set(args.sequence_number, {
      sequence: args.sequence_number,
      frameTimeUs: args.frame_time_us,
      intervalUs: args.interval_us,
      subtype: args.subtype,
    });
    sourceEvents.set(sourceId, frames);
  }

  const sources = [...sourceEvents.entries()].map(([sourceId, frames]) => ({
    sourceId,
    beginFrames: frames.size,
    missedBeginFrames: [...frames.values()].filter((frame) => frame.subtype === 'MISSED').length,
  })).sort((a, b) => b.beginFrames - a.beginFrames);
  const pageSource = sources[0];
  const begins = [...sourceEvents.get(pageSource.sourceId).values()]
    .sort((a, b) => a.frameTimeUs - b.frameTimeUs);
  const intervalsMs = begins.slice(1).map((frame, index) => (frame.frameTimeUs - begins[index].frameTimeUs) / 1000);
  const missed = begins.filter((frame) => frame.subtype === 'MISSED').length;
  run.beginFrameSourceId = pageSource.sourceId;
  run.beginFrames = begins.length;
  run.missedBeginFrames = missed;
  run.missedBeginFramePercent = Number((100 * missed / begins.length).toFixed(4));
  run.beginFrameIntervalP95Ms = percentile(intervalsMs, 0.95);
  run.beginFrameIntervalMaxMs = Math.max(...intervalsMs);
  run.beginFrameSources = sources;
  run.compositor = {
    directRendererDrawFrame: completeSliceStats(events, 'DirectRenderer::DrawFrame'),
    displaySchedulerDrawAndSwap: completeSliceStats(events, 'DisplayScheduler::DrawAndSwap'),
    gpuSwapBuffers: completeSliceStats(events, 'SkiaOutputSurfaceImplOnGpu::SwapBuffers'),
  };
}

const activeBeginFrames = summary.runs.reduce((total, run) => total + run.beginFrames, 0);
const activeMissedBeginFrames = summary.runs.reduce((total, run) => total + run.missedBeginFrames, 0);
summary.aggregate = {
  activePageBeginFrames: activeBeginFrames,
  missedBeginFrames: activeMissedBeginFrames,
  missedBeginFramePercent: Number((100 * activeMissedBeginFrames / activeBeginFrames).toFixed(4)),
  allRunsBelowOnePercent: summary.runs.every((run) => run.missedBeginFramePercent <= 1),
};

summary.analysis = {
  percentile: 'Flutter-style nearest rank index: round((n-1)*0.95).',
  lateFrameProxy: 'Unique DisplayScheduler::BeginFrame subtype MISSED per active page display source; source selected by highest unique BeginFrame count and matched to ~1801 DrawFrame / requestAnimationFrame callbacks each run.',
  renderDurations: 'Chrome trace complete slices: DirectRenderer::DrawFrame, DisplayScheduler::DrawAndSwap, and SkiaOutputSurfaceImplOnGpu::SwapBuffers. These are compositor/GPU-stage durations, not end-to-end photon presentation latency.',
  tracesContainAdditionalSources: 'All sources are preserved. The active page source is reported separately; a secondary low-count source has a different cadence and is excluded from the page late-frame denominator.',
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ output: summaryPath, runs: summary.runs.map(({ run, beginFrameSourceId, beginFrames, missedBeginFrames, missedBeginFramePercent, beginFrameIntervalP95Ms, beginFrameIntervalMaxMs, compositor }) => ({ run, beginFrameSourceId, beginFrames, missedBeginFrames, missedBeginFramePercent, beginFrameIntervalP95Ms, beginFrameIntervalMaxMs, compositor })) }, null, 2));
