import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPaginationLogEntry,
  generateApiRequestId,
  observePaginationRequest,
  recordPaginationMetric,
  safeRequestSerializer,
} from './pagination-logging.js';

test('request serialization omits query, headers, and body while retaining the route template', () => {
  const entry = safeRequestSerializer({
    method: 'GET',
    url: '/polls/poll-1/comments?cursor=RAW_CURSOR_CANARY',
    routeOptions: { url: '/polls/:pollId/comments' },
    headers: { authorization: 'AUTH_HEADER_CANARY' },
    body: 'COMMENT_BODY_CANARY',
  });

  assert.deepEqual(entry, { method: 'GET', route: '/polls/:pollId/comments' });
  assert.equal(JSON.stringify(entry).includes('RAW_CURSOR_CANARY'), false);
  assert.equal(JSON.stringify(entry).includes('AUTH_HEADER_CANARY'), false);
  assert.equal(JSON.stringify(entry).includes('COMMENT_BODY_CANARY'), false);
});

test('request IDs accept only bounded opaque IDs from clients', () => {
  assert.equal(generateApiRequestId({
    headers: { 'x-request-id': 'e5b2e8b1-f4c8-44ba-a25f-a63d60058128' },
  }), 'e5b2e8b1-f4c8-44ba-a25f-a63d60058128');

  const generated = generateApiRequestId({
    headers: { 'x-request-id': 'AUTH_HEADER_CANARY' },
  });
  assert.match(generated, /^[0-9a-f-]{36}$/i);
  assert.notEqual(generated, 'AUTH_HEADER_CANARY');
});

test('pagination log entries project only diagnostic fields from the input', () => {
  const entry = createPaginationLogEntry({
    event: 'pagination.success',
    surface: 'comments',
    sort: 'newest',
    pageNumber: 2,
    durationMs: 18,
    itemCount: 20,
    errorCode: null,
    requestId: 'req-safe-2',
    cursor: 'RAW_CURSOR_CANARY',
    authorization: 'AUTH_HEADER_CANARY',
    commentBody: 'COMMENT_BODY_CANARY',
  } as never);

  assert.deepEqual(entry, {
    event: 'pagination.success',
    surface: 'comments',
    sort: 'newest',
    pageNumber: 2,
    durationMs: 18,
    itemCount: 20,
    errorCode: null,
    requestId: 'req-safe-2',
  });
  const serialized = JSON.stringify(entry);
  assert.equal(serialized.includes('RAW_CURSOR_CANARY'), false);
  assert.equal(serialized.includes('AUTH_HEADER_CANARY'), false);
  assert.equal(serialized.includes('COMMENT_BODY_CANARY'), false);
});

test('successful and failed page reads log only safe synthetic metadata once per request', async () => {
  const records: Array<Record<string, unknown>> = [];
  const logger = {
    info: (entry: Record<string, unknown>) => records.push(entry),
    warn: (entry: Record<string, unknown>) => records.push(entry),
  };
  const context = {
    surface: 'comments' as const,
    sort: 'newest',
    pageNumber: 2,
    requestId: 'e5b2e8b1-f4c8-44ba-a25f-a63d60058128',
    action: 'append' as const,
  };

  await observePaginationRequest(logger, context, async () => ({
    items: [{ body: 'COMMENT_BODY_CANARY' }],
    nextCursor: 'RAW_CURSOR_CANARY',
  }));
  await assert.rejects(observePaginationRequest(logger, {
    ...context,
    requestId: 'f7768983-03f0-4405-a8eb-ac7d0940a5b2',
  }, async () => {
    throw Object.assign(new Error('AUTH_HEADER_CANARY COMMENT_BODY_CANARY'), { code: 'network_error' });
  }));

  assert.deepEqual(records.map((record) => record.event), [
    'pagination.start', 'pagination.success', 'pagination.start', 'pagination.failure',
  ]);
  assert.equal(records[1].itemCount, 1);
  assert.equal(records[3].errorCode, 'network_error');
  const serialized = JSON.stringify(records);
  assert.equal(serialized.includes('RAW_CURSOR_CANARY'), false);
  assert.equal(serialized.includes('AUTH_HEADER_CANARY'), false);
  assert.equal(serialized.includes('COMMENT_BODY_CANARY'), false);
});

test('snapshot metrics retain aggregate counts and omit owner or snapshot identifiers', () => {
  const lines: string[] = [];
  recordPaginationMetric({
    event: 'pagination.snapshot_storage',
    surface: 'feed',
    sort: 'popular',
    pageNumber: 1,
    durationMs: 12,
    itemCount: 480,
    errorCode: null,
    requestId: 'e5b2e8b1-f4c8-44ba-a25f-a63d60058128',
    storedItemCount: 480,
    activeSnapshotCount: 2,
    snapshotLifetimeSeconds: 1800,
    snapshotId: 'SNAPSHOT_ID_CANARY',
    ownerKey: 'OWNER_KEY_CANARY',
  } as never, (line) => lines.push(line));

  const serialized = lines.join('\n');
  assert.equal(serialized.includes('SNAPSHOT_ID_CANARY'), false);
  assert.equal(serialized.includes('OWNER_KEY_CANARY'), false);
  assert.deepEqual(JSON.parse(lines[0]), {
    event: 'pagination.snapshot_storage',
    surface: 'feed',
    sort: 'popular',
    pageNumber: 1,
    durationMs: 12,
    itemCount: 480,
    errorCode: null,
    requestId: 'e5b2e8b1-f4c8-44ba-a25f-a63d60058128',
    storedItemCount: 480,
    activeSnapshotCount: 2,
    snapshotLifetimeSeconds: 1800,
  });
});
