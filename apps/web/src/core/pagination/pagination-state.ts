export type PaginationSurface = 'feed' | 'subscriptions' | 'comments' | 'replies';
export type PaginationLoadKind = 'initial' | 'append' | 'refresh';
export type PaginationLoadTrigger = 'automatic' | 'manual';

export interface PaginationQueryScope {
  surface: PaginationSurface;
  sessionEpoch: number;
  userId: string | null;
  sort?: string;
  pollId?: string;
  rootId?: string;
  followingGeneration?: number;
}

export function paginationQueryKey(scope: PaginationQueryScope) {
  return [
    'pagination',
    scope.surface,
    scope.sessionEpoch,
    scope.userId,
    scope.sort ?? null,
    scope.pollId ?? null,
    scope.rootId ?? null,
    scope.surface === 'subscriptions' ? (scope.followingGeneration ?? 0) : null,
  ] as const;
}

export const paginationQueryOptions = { refetchOnWindowFocus: false } as const;

export interface PaginationPendingRequest {
  kind: PaginationLoadKind;
  cursor: string | null;
}

export interface PaginationState {
  generation: number;
  sessionEpoch: number;
  userId: string | null;
  followingGeneration: number;
  nextCursor: string | null;
  /** Cursors whose pages were accepted in this generation. */
  cursorHistory: readonly string[];
  paginationSupported: boolean;
  automaticLoadCount: number;
  pending: PaginationPendingRequest | null;
  appendError: boolean;
}

export interface PaginationRequestContext {
  generation: number;
  sessionEpoch: number;
  userId: string | null;
  followingGeneration: number;
  kind: PaginationLoadKind;
  cursor: string | null;
  trigger: PaginationLoadTrigger;
}

export interface PaginationPageResult {
  nextCursor: string | null;
  paginationSupported: boolean;
}

export function mergePageIds<T, Id>(pages: readonly { items: readonly T[] }[], getId: (item: T) => Id): Id[] {
  const ids: Id[] = [];
  const seen = new Set<Id>();
  for (const page of pages) {
    for (const item of page.items) {
      const id = getId(item);
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function canAppend(state: PaginationState, trigger: PaginationLoadTrigger = 'manual'): boolean {
  if (!state.paginationSupported || state.nextCursor === null || state.pending !== null) return false;
  if (state.cursorHistory.includes(state.nextCursor)) return false;
  if (trigger === 'automatic' && (state.appendError || state.automaticLoadCount >= 3)) return false;
  return true;
}

function sameIdentity(state: PaginationState, request: PaginationRequestContext): boolean {
  return state.generation === request.generation &&
    state.sessionEpoch === request.sessionEpoch &&
    state.userId === request.userId &&
    state.followingGeneration === request.followingGeneration;
}

export function acceptPage(
  state: PaginationState,
  requestContext: PaginationRequestContext,
  page: PaginationPageResult,
): PaginationState | null {
  if (!sameIdentity(state, requestContext)) return null;
  if (state.pending?.kind !== requestContext.kind || state.pending.cursor !== requestContext.cursor) return null;
  if (requestContext.kind === 'append') {
    if (!state.paginationSupported || requestContext.cursor === null || requestContext.cursor !== state.nextCursor) return null;
    if (state.cursorHistory.includes(requestContext.cursor)) return null;
  } else if (requestContext.cursor !== null) {
    return null;
  }

  const isAppend = requestContext.kind === 'append';
  return {
    ...state,
    nextCursor: page.paginationSupported ? page.nextCursor : null,
    cursorHistory: isAppend ? [...state.cursorHistory, requestContext.cursor!] : [],
    paginationSupported: page.paginationSupported,
    automaticLoadCount: isAppend && requestContext.trigger === 'automatic' ? state.automaticLoadCount + 1 : 0,
    pending: null,
    appendError: false,
  };
}
