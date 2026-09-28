const counters = {
  created: 0,
  suppressed: 0,
  read: 0,
  pushSent: 0,
  pushFailed: 0,
  publishFailed: 0,
  activeSockets: 0,
  publishErrors: 0,
  subscribeErrors: 0,
  commitToClientSamples: 0,
  commitToClientTotalMs: 0,
  rateLimitResponses: 0
};

const disconnectsByReason: Record<string, number> = {};
const readResults: Record<string, number> = {};

export function incrementNotificationMetric(name: keyof typeof counters) {
  counters[name] += 1;
}

export function getNotificationMetrics() {
  return { ...counters, disconnectsByReason: { ...disconnectsByReason }, readResults: { ...readResults } };
}

export function recordSocketConnected() {
  counters.activeSockets += 1;
}

export function recordSocketDisconnected(reason: string) {
  counters.activeSockets = Math.max(counters.activeSockets - 1, 0);
  disconnectsByReason[reason] = (disconnectsByReason[reason] ?? 0) + 1;
}

export function recordRealtimePublishError() {
  counters.publishErrors += 1;
  counters.publishFailed += 1;
}

export function recordRealtimeSubscribeError() {
  counters.subscribeErrors += 1;
}

export function recordCommitToClient(latencyMs: number) {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  counters.commitToClientSamples += 1;
  counters.commitToClientTotalMs += latencyMs;
}

export function recordReadResult(operation: 'read' | 'read_all', result: 'updated' | 'unchanged' | 'failed') {
  const key = `${operation}.${result}`;
  readResults[key] = (readResults[key] ?? 0) + 1;
}

export function recordRateLimitResponse(statusCode: number) {
  if (statusCode === 429) counters.rateLimitResponses += 1;
}
