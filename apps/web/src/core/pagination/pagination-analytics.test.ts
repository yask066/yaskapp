import { expect, test } from 'vitest';
import { createPaginationAnalytics, resolvePaginationPageRequest } from './pagination-analytics';

test('cached replay pages keep their page number and append requests use the next position', () => {
  const pageParams = [null, 'cursor-1', 'cursor-2'];
  expect(resolvePaginationPageRequest(pageParams, 'cursor-1', false)).toEqual({ pageNumber: 2, kind: 'refetch' });
  expect(resolvePaginationPageRequest(pageParams, 'cursor-2', false)).toEqual({ pageNumber: 3, kind: 'refetch' });
  expect(resolvePaginationPageRequest(pageParams, 'cursor-3', false)).toEqual({ pageNumber: 4, kind: 'append' });
  expect(resolvePaginationPageRequest(pageParams, 'cursor-1', true)).toEqual({ pageNumber: 4, kind: 'append' });
  expect(resolvePaginationPageRequest(pageParams, null, false, true, 8)).toEqual({ pageNumber: 1, kind: 'refetch' });
  expect(resolvePaginationPageRequest(pageParams, 'new-cursor-1', false, true, 2)).toEqual({ pageNumber: 2, kind: 'refetch' });
  expect(resolvePaginationPageRequest(pageParams, 'new-cursor-2', false, true, 3)).toEqual({ pageNumber: 3, kind: 'refetch' });
});

test('pagination events contain only safe metadata, never cursor, auth, or comment data', async () => {
  const events: unknown[] = [];
  const analytics = createPaginationAnalytics((event) => events.push(event));

  await analytics.trackPageRequest({
    surface: 'comments',
    sort: 'newest',
    pageNumber: 2,
    requestId: 'request-safe-1',
    chainId: 'poll-1',
    kind: 'append',
    cursor: 'CURSOR_CANARY',
    authorization: 'AUTH_CANARY',
    commentBody: 'COMMENT_CANARY',
  } as never, async () => ({
    items: [{ id: 'root-2', body: 'COMMENT_CANARY' }],
    nextCursor: null,
  }));

  const serialized = JSON.stringify(events);
  expect(serialized).not.toContain('CURSOR_CANARY');
  expect(serialized).not.toContain('AUTH_CANARY');
  expect(serialized).not.toContain('COMMENT_CANARY');
  expect(events).toEqual([
    {
      event: 'pagination.start', surface: 'comments', sort: 'newest', pageNumber: 2,
      durationMs: null, itemCount: null, errorCode: null, requestId: 'request-safe-1',
    },
    {
      event: 'pagination.success', surface: 'comments', sort: 'newest', pageNumber: 2,
      durationMs: expect.any(Number), itemCount: 1, errorCode: null, requestId: 'request-safe-1',
    },
  ]);
});

test('a failed page emits one failure and the next attempt is marked as a retry', async () => {
  const events: Array<{ event: string; requestId: string }> = [];
  const analytics = createPaginationAnalytics((event) => events.push(event));
  const context = {
    surface: 'feed' as const,
    sort: 'popular' as const,
    pageNumber: 3,
    chainId: 'feed:guest:popular',
    kind: 'append' as const,
    cursor: 'opaque-cursor',
  };

  await expect(analytics.trackPageRequest({ ...context, requestId: 'request-failed' }, async () => {
    throw Object.assign(new Error('COMMENT_CANARY'), { code: 'COMMENT_CANARY' });
  })).rejects.toMatchObject({ code: 'COMMENT_CANARY' });
  await analytics.trackPageRequest({ ...context, requestId: 'request-retry' }, async () => ({
    items: [{ id: 'poll-3' }],
    nextCursor: null,
  }));

  expect(events.map(({ event }) => event)).toEqual([
    'pagination.start',
    'pagination.failure',
    'pagination.retry',
    'pagination.start',
    'pagination.success',
  ]);
  expect(events[2].requestId).toBe('request-retry');
  expect(events[1]).toMatchObject({ errorCode: 'request_failed' });
  expect(JSON.stringify(events)).not.toContain('COMMENT_CANARY');
});

test('refetched pages are not classified as append deduplication and their chain can be disposed', async () => {
  const events: Array<Record<string, unknown>> = [];
  const analytics = createPaginationAnalytics((event) => events.push(event));
  let action: string | undefined;

  await analytics.trackPageRequest({
    surface: 'comments', sort: 'newest', pageNumber: 2, requestId: 'refetch',
    chainId: 'comments:session-1', kind: 'refetch', cursor: 'cursor-1', existingIds: ['root-1'],
    getId: (item: { id: string }) => item.id,
  }, async (metadata) => {
    action = metadata.action;
    return { items: [{ id: 'root-1' }], nextCursor: 'cursor-2' };
  });
  expect(action).toBe('refetch');
  expect(events.map(({ event }) => event)).toEqual(['pagination.start', 'pagination.success']);

  await analytics.trackPageRequest({
    surface: 'comments', sort: 'newest', pageNumber: 1, requestId: 'first',
    chainId: 'comments:cursor-history', kind: 'initial', cursor: null,
  }, async () => ({ items: [], nextCursor: 'cursor-a' }));
  await analytics.trackPageRequest({
    surface: 'comments', sort: 'newest', pageNumber: 2, requestId: 'second',
    chainId: 'comments:cursor-history', kind: 'append', cursor: 'cursor-a',
  }, async () => ({ items: [], nextCursor: 'cursor-b' }));
  analytics.disposeChain('comments:cursor-history');
  await analytics.trackPageRequest({
    surface: 'comments', sort: 'newest', pageNumber: 3, requestId: 'third',
    chainId: 'comments:cursor-history', kind: 'append', cursor: 'cursor-b',
  }, async () => ({ items: [], nextCursor: 'cursor-a' }));

  expect(events.filter(({ event }) => event === 'pagination.cursor_anomaly')).toHaveLength(0);

  const failedContext = {
    surface: 'comments' as const, sort: 'newest' as const, pageNumber: 2,
    chainId: 'comments:failed-request', kind: 'append' as const, cursor: 'cursor-failed',
  };
  await expect(analytics.trackPageRequest(failedContext, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  analytics.disposeChain(failedContext.chainId);
  let retryAction: string | undefined;
  await analytics.trackPageRequest(failedContext, async (metadata) => {
    retryAction = metadata.action;
    return { items: [], nextCursor: null };
  });
  expect(retryAction).toBe('append');
});

test('late completions are ignored and accepted append pages report dedup and cursor loops', async () => {
  const events: Array<Record<string, unknown>> = [];
  const analytics = createPaginationAnalytics((event) => events.push(event));
  await analytics.trackPageRequest({
    surface: 'feed', sort: 'newest', pageNumber: 1, requestId: 'first',
    chainId: 'feed:for-you', kind: 'initial', cursor: null,
  }, async () => ({ items: [{ id: 'poll-1' }], nextCursor: 'cursor-a' }));

  const controller = new AbortController();
  let finish!: (page: { items: Array<{ id: string }>; nextCursor: string | null }) => void;
  const late = analytics.trackPageRequest({
    surface: 'feed', sort: 'newest', pageNumber: 2, requestId: 'late',
    chainId: 'feed:late', kind: 'append', cursor: 'cursor-late', signal: controller.signal,
  }, () => new Promise<{ items: Array<{ id: string }>; nextCursor: string | null }>((resolve) => { finish = resolve; }));
  controller.abort();
  finish({ items: [{ id: 'poll-late' }], nextCursor: null });
  await late;

  await analytics.trackPageRequest({
    surface: 'feed', sort: 'newest', pageNumber: 2, requestId: 'append',
    chainId: 'feed:for-you', kind: 'append', cursor: 'cursor-a',
    existingIds: ['poll-1'], getId: (item: { id: string }) => item.id,
  }, async () => ({ items: [{ id: 'poll-1' }], nextCursor: 'cursor-a' }));

  expect(events.map(({ event }) => event)).toEqual([
    'pagination.start', 'pagination.success', 'pagination.start',
    'pagination.start', 'pagination.success', 'pagination.deduplication', 'pagination.cursor_anomaly',
  ]);
  expect(events.at(-2)).toMatchObject({ deduplicatedCount: 1, requestId: 'append' });
  expect(events.at(-1)).toMatchObject({ errorCode: 'repeated_cursor', requestId: 'append' });
});
