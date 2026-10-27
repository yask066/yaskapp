export type PaginationSurface = 'feed' | 'subscriptions' | 'comments' | 'replies';
export type PaginationEventName =
  | 'pagination.start'
  | 'pagination.success'
  | 'pagination.failure'
  | 'pagination.retry'
  | 'pagination.refresh'
  | 'pagination.cursor_anomaly'
  | 'pagination.deduplication'
  | 'pagination.snapshot_storage'
  | 'pagination.snapshot_expiry';

export interface PaginationAnalyticsEvent {
  event: PaginationEventName;
  surface: PaginationSurface;
  sort: string | null;
  pageNumber: number | null;
  durationMs: number | null;
  itemCount: number | null;
  errorCode: string | null;
  requestId: string;
  deduplicatedCount?: number;
  storedItemCount?: number;
  activeSnapshotCount?: number;
  deletedSnapshotCount?: number;
  snapshotLifetimeSeconds?: number;
}

export type PaginationAnalyticsSink = (event: Readonly<PaginationAnalyticsEvent>) => void;
export type PaginationLoadKind = 'initial' | 'append' | 'refetch' | 'refresh';
export type PaginationRequestAction = PaginationLoadKind | 'retry';

export interface PaginationPage<T> {
  items: readonly T[];
  nextCursor?: string | null;
}

export interface PaginationRequestContext<T> {
  surface: PaginationSurface;
  sort?: string | null;
  pageNumber: number;
  requestId?: string;
  chainId: string;
  kind: PaginationLoadKind;
  cursor: string | null;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  existingIds?: readonly unknown[];
  getId?: (item: T) => unknown;
}

export function resolvePaginationPageRequest(
  cachedPageParams: readonly unknown[] | undefined,
  requestedPageParam: unknown,
  isFetchingMore: boolean,
  isRefetching = false,
  nextRefetchPageNumber = 1,
): { pageNumber: number; kind: 'initial' | 'append' | 'refetch' } {
  const pageParams = cachedPageParams ?? [];
  if (isFetchingMore) return { pageNumber: pageParams.length + 1, kind: 'append' };

  if (isRefetching) {
    const isFirstPage = pageParams.length > 0 && Object.is(pageParams[0], requestedPageParam);
    return { pageNumber: isFirstPage ? 1 : nextRefetchPageNumber, kind: 'refetch' };
  }

  const cachedIndex = pageParams.findIndex((pageParam) => Object.is(pageParam, requestedPageParam));
  if (cachedIndex >= 0) {
    return { pageNumber: cachedIndex + 1, kind: cachedIndex === 0 ? 'initial' : 'refetch' };
  }

  return {
    pageNumber: pageParams.length + 1,
    kind: pageParams.length === 0 ? 'initial' : 'append',
  };
}

export function createPaginationRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error &&
      typeof error.code === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(error.code)) {
    return error.code;
  }
  return 'request_failed';
}

function browserLogSink(event: Readonly<PaginationAnalyticsEvent>): void {
  const serialized = JSON.stringify(event);
  if (event.event === 'pagination.failure' || event.event === 'pagination.cursor_anomaly') {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}

function retryKey(context: PaginationRequestContext<unknown>): string {
  return `${context.chainId}:${context.pageNumber}:${context.cursor ?? '<first>'}`;
}

export function createPaginationAnalytics(sink: PaginationAnalyticsSink = browserLogSink) {
  const maximumTrackedChains = 128;
  const maximumCursorsPerChain = 128;
  const maximumFailedRequests = 256;
  const failedRequestLifetimeMs = 5 * 60 * 1000;
  const failedRequests = new Map<string, number>();
  const usedCursorsByChain = new Map<string, Set<string>>();

  const touchChain = (chainId: string, cursors: Set<string>) => {
    usedCursorsByChain.delete(chainId);
    usedCursorsByChain.set(chainId, cursors);
    while (usedCursorsByChain.size > maximumTrackedChains) {
      const oldestChain = usedCursorsByChain.keys().next().value;
      if (oldestChain === undefined) break;
      usedCursorsByChain.delete(oldestChain);
    }
  };

  const rememberFailedRequest = (key: string) => {
    const now = Date.now();
    for (const [failedKey, failedAt] of failedRequests) {
      if (now - failedAt > failedRequestLifetimeMs) failedRequests.delete(failedKey);
    }
    failedRequests.delete(key);
    failedRequests.set(key, now);
    while (failedRequests.size > maximumFailedRequests) {
      const oldestKey = failedRequests.keys().next().value;
      if (oldestKey === undefined) break;
      failedRequests.delete(oldestKey);
    }
  };

  const emit = (event: PaginationAnalyticsEvent) => {
    const safeEvent: PaginationAnalyticsEvent = {
      event: event.event,
      surface: event.surface,
      sort: event.sort === 'newest' || event.sort === 'oldest' || event.sort === 'popular' ? event.sort : null,
      pageNumber: Number.isSafeInteger(event.pageNumber) && event.pageNumber! > 0 ? event.pageNumber : null,
      durationMs: typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) ? Math.max(0, event.durationMs) : null,
      itemCount: Number.isSafeInteger(event.itemCount) && event.itemCount! >= 0 ? event.itemCount : null,
      errorCode: event.errorCode ?? null,
      requestId: event.requestId,
    };
    if (event.deduplicatedCount !== undefined) safeEvent.deduplicatedCount = Math.max(0, Math.floor(event.deduplicatedCount));
    if (event.storedItemCount !== undefined) {
      safeEvent.storedItemCount = Math.max(0, Math.floor(event.storedItemCount));
      safeEvent.activeSnapshotCount = event.activeSnapshotCount;
      safeEvent.snapshotLifetimeSeconds = event.snapshotLifetimeSeconds;
    }
    if (event.deletedSnapshotCount !== undefined) safeEvent.deletedSnapshotCount = Math.max(0, Math.floor(event.deletedSnapshotCount));
    sink(Object.freeze(safeEvent));
  };

  const emitBase = <Item>(
    context: PaginationRequestContext<Item>,
    event: PaginationEventName,
    requestId: string,
    values: Partial<Pick<PaginationAnalyticsEvent, 'durationMs' | 'itemCount' | 'errorCode' | 'deduplicatedCount'>> = {},
  ) => emit({
    event,
    surface: context.surface,
    sort: context.sort ?? null,
    pageNumber: context.pageNumber,
    durationMs: values.durationMs ?? null,
    itemCount: values.itemCount ?? null,
    errorCode: values.errorCode ?? null,
    requestId,
    ...(values.deduplicatedCount === undefined ? {} : { deduplicatedCount: values.deduplicatedCount }),
  });

  return {
    emit,
    disposeChain(chainId: string): void {
      usedCursorsByChain.delete(chainId);
      const failedPrefix = `${chainId}\u0000`;
      for (const key of failedRequests.keys()) {
        if (key.startsWith(failedPrefix)) failedRequests.delete(key);
      }
    },
    async trackPageRequest<Item, Page extends PaginationPage<Item>>(
      context: PaginationRequestContext<Item>,
      load: (metadata: { requestId: string; action: PaginationRequestAction }) => Promise<Page>,
    ): Promise<Page> {
      const requestId = context.requestId ?? createPaginationRequestId();
      const key = `${context.chainId}\u0000${retryKey(context as PaginationRequestContext<unknown>)}`;
      const failedAt = failedRequests.get(key);
      const isRetry = failedAt !== undefined && Date.now() - failedAt <= failedRequestLifetimeMs;
      const action: PaginationRequestAction = isRetry ? 'retry' : context.kind;
      if (isRetry) {
        failedRequests.delete(key);
        emitBase(context, 'pagination.retry', requestId, { itemCount: 0, durationMs: 0 });
      }
      if (context.kind === 'refresh') {
        emitBase(context, 'pagination.refresh', requestId, { itemCount: 0, durationMs: 0 });
      }

      emitBase(context, 'pagination.start', requestId);
      const startedAt = Date.now();
      try {
        const page = await load({ requestId, action });
        if (context.signal?.aborted || (context.isCurrent && !context.isCurrent())) return page;

        const history = context.kind === 'initial' || context.kind === 'refresh' ||
          (context.kind === 'refetch' && context.pageNumber === 1)
          ? new Set<string>()
          : new Set(usedCursorsByChain.get(context.chainId) ?? []);
        const nextCursor = page.nextCursor ?? null;
        emitBase(context, 'pagination.success', requestId, {
          durationMs: Date.now() - startedAt,
          itemCount: page.items.length,
        });

        if (context.kind === 'append' && context.existingIds && context.getId) {
          const seen = new Set(context.existingIds);
          let deduplicatedCount = 0;
          for (const item of page.items) {
            const id = context.getId(item);
            if (seen.has(id)) deduplicatedCount += 1;
            else seen.add(id);
          }
          if (deduplicatedCount > 0) {
            emitBase(context, 'pagination.deduplication', requestId, {
              itemCount: page.items.length,
              deduplicatedCount,
            });
          }
        }

        if (nextCursor !== null) {
          if (nextCursor === context.cursor || history.has(nextCursor)) {
            emitBase(context, 'pagination.cursor_anomaly', requestId, {
              itemCount: page.items.length,
              errorCode: 'repeated_cursor',
            });
          }
          history.add(nextCursor);
        }
        while (history.size > maximumCursorsPerChain) {
          const oldestCursor = history.values().next().value;
          if (oldestCursor === undefined) break;
          history.delete(oldestCursor);
        }
        touchChain(context.chainId, history);
        failedRequests.delete(key);
        return page;
      } catch (error) {
        if (!context.signal?.aborted && (!context.isCurrent || context.isCurrent())) {
          rememberFailedRequest(key);
          emitBase(context, 'pagination.failure', requestId, {
            durationMs: Date.now() - startedAt,
            errorCode: safeErrorCode(error),
          });
        }
        throw error;
      }
    },
  };
}

export const paginationAnalytics = createPaginationAnalytics();
