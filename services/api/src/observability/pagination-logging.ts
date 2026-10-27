import { randomUUID } from 'node:crypto';

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

export type PaginationSurface = 'feed' | 'subscriptions' | 'comments' | 'replies';
export type PaginationRequestAction = 'initial' | 'append' | 'refetch' | 'retry' | 'refresh';

export type PaginationLogEntry = Readonly<{
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
}>;

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateApiRequestId(request: {
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const candidate = request.headers?.['x-request-id'];
  return typeof candidate === 'string' && requestIdPattern.test(candidate)
    ? candidate
    : randomUUID();
}

export function safeRequestSerializer(request: {
  method: string;
  url: string;
  routeOptions?: { url?: string };
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}): { method: string; route: string } {
  const route = request.routeOptions?.url ?? request.url.split('?', 1)[0] ?? '/';
  return { method: request.method, route };
}

export function createPaginationLogEntry(input: PaginationLogEntry): PaginationLogEntry {
  const entry: PaginationLogEntry = {
    event: input.event,
    surface: input.surface,
    sort: input.sort,
    pageNumber: input.pageNumber,
    durationMs: input.durationMs,
    itemCount: input.itemCount,
    errorCode: input.errorCode,
    requestId: input.requestId,
  };

  if (input.deduplicatedCount !== undefined) {
    return { ...entry, deduplicatedCount: input.deduplicatedCount };
  }
  if (input.storedItemCount !== undefined) {
    return {
      ...entry,
      storedItemCount: input.storedItemCount,
      activeSnapshotCount: input.activeSnapshotCount,
      snapshotLifetimeSeconds: input.snapshotLifetimeSeconds,
    };
  }
  if (input.deletedSnapshotCount !== undefined) {
    return { ...entry, deletedSnapshotCount: input.deletedSnapshotCount };
  }
  return entry;
}

export function recordPaginationMetric(
  input: PaginationLogEntry,
  sink: (line: string) => void = (line) => console.info(line),
): void {
  sink(JSON.stringify(createPaginationLogEntry(input)));
}

function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error &&
      typeof error.code === 'string' && /^[a-z0-9_-]{1,64}$/.test(error.code)) {
    return error.code;
  }
  return 'request_failed';
}

export async function observePaginationRequest<T extends { items?: unknown[] }>(
  logger: {
    info: (entry: PaginationLogEntry, message?: string) => void;
    warn: (entry: PaginationLogEntry, message?: string) => void;
  },
  context: Readonly<{
    surface: PaginationSurface;
    sort: string | null;
    pageNumber: number | null;
    requestId: string;
    action: PaginationRequestAction;
  }>,
  load: () => Promise<T>,
): Promise<T> {
  const emit = (
    event: PaginationEventName,
    values: Partial<Pick<PaginationLogEntry, 'durationMs' | 'itemCount' | 'errorCode'>> = {},
    level: 'info' | 'warn' = 'info',
  ) => {
    logger[level](createPaginationLogEntry({
      event,
      surface: context.surface,
      sort: context.sort,
      pageNumber: context.pageNumber,
      durationMs: values.durationMs ?? null,
      itemCount: values.itemCount ?? null,
      errorCode: values.errorCode ?? null,
      requestId: context.requestId,
    }));
  };

  if (context.action === 'retry') emit('pagination.retry', { durationMs: 0, itemCount: 0 });
  if (context.action === 'refresh') emit('pagination.refresh', { durationMs: 0, itemCount: 0 });
  emit('pagination.start');
  const startedAt = process.hrtime.bigint();

  try {
    const page = await load();
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    emit('pagination.success', { durationMs, itemCount: page.items?.length ?? 0 });
    return page;
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const errorCode = safeErrorCode(error);
    emit('pagination.failure', { durationMs, itemCount: 0, errorCode }, 'warn');
    if (errorCode.startsWith('pagination_cursor_')) {
      emit('pagination.cursor_anomaly', { durationMs, itemCount: 0, errorCode }, 'warn');
    }
    throw error;
  }
}
