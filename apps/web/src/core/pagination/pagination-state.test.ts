import { describe, expect, test } from 'vitest';
import {
  acceptPage,
  canAppend,
  mergePageIds,
  paginationQueryKey,
  paginationQueryOptions,
  type PaginationRequestContext,
  type PaginationState,
} from './pagination-state';

const state = (overrides: Partial<PaginationState> = {}): PaginationState => ({
  generation: 3,
  sessionEpoch: 5,
  userId: 'user-a',
  followingGeneration: 2,
  nextCursor: 'cursor-1',
  cursorHistory: [],
  paginationSupported: true,
  automaticLoadCount: 0,
  pending: null,
  appendError: false,
  ...overrides,
});

const context = (
  current: PaginationState,
  kind: PaginationRequestContext['kind'] = 'append',
  trigger: PaginationRequestContext['trigger'] = 'manual',
): PaginationRequestContext => ({
  generation: current.generation,
  sessionEpoch: current.sessionEpoch,
  userId: current.userId,
  followingGeneration: current.followingGeneration,
  kind,
  cursor: kind === 'append' ? current.nextCursor : null,
  trigger,
});

const page = (nextCursor: string | null) => ({ items: [], nextCursor, paginationSupported: true });

describe('pagination state helpers', () => {
  test('merges page IDs in order and keeps the first occurrence', () => {
    const pages = [
      { items: [{ id: 'a' }, { id: 'b' }] },
      { items: [{ id: 'b' }, { id: 'c' }] },
      { items: [{ id: 'a' }, { id: 'd' }] },
    ];

    expect(mergePageIds(pages, (item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('allows at most three automatic appends before requiring user action', () => {
    let current = state();

    for (let index = 0; index < 3; index += 1) {
      expect(canAppend(current, 'automatic')).toBe(true);
      const request = context(current, 'append', 'automatic');
      current = {
        ...current,
        pending: { kind: 'append', cursor: request.cursor },
      };
      current = acceptPage(current, request, page(`cursor-${index + 2}`))!;
    }

    expect(current.automaticLoadCount).toBe(3);
    expect(canAppend(current, 'automatic')).toBe(false);
    expect(canAppend(current, 'manual')).toBe(true);
  });

  test('stops when a server repeats a cursor already accepted', () => {
    const current = state({ pending: { kind: 'append', cursor: 'cursor-1' } });
    const accepted = acceptPage(current, context(current), page('cursor-1'));

    expect(accepted?.cursorHistory).toEqual(['cursor-1']);
    expect(canAppend(accepted!)).toBe(false);
  });

  test('blocks automatic retry after an append error but allows manual retry of the same cursor', () => {
    const failed = state({ appendError: true });
    expect(canAppend(failed, 'automatic')).toBe(false);
    expect(canAppend(failed, 'manual')).toBe(true);

    const retrying = { ...failed, pending: { kind: 'append' as const, cursor: failed.nextCursor } };
    const accepted = acceptPage(retrying, context(retrying), page('cursor-2'));
    expect(accepted?.appendError).toBe(false);
    expect(accepted?.cursorHistory).toEqual(['cursor-1']);
  });

  test('rejects append while a page or refresh is pending, at end, or on a legacy response', () => {
    expect(canAppend(state({ pending: { kind: 'append', cursor: 'cursor-1' } }))).toBe(false);
    expect(canAppend(state({ pending: { kind: 'refresh', cursor: null } }))).toBe(false);
    expect(canAppend(state({ nextCursor: null }))).toBe(false);
    expect(canAppend(state({ paginationSupported: false }))).toBe(false);
  });

  test('rejects stale append after refresh starts and keeps the old cursor usable after refresh failure', () => {
    const beforeRefresh = state({ nextCursor: 'cursor-old', cursorHistory: ['cursor-used'] });
    const oldAppend = context(beforeRefresh);
    const refreshing = {
      ...beforeRefresh,
      generation: beforeRefresh.generation + 1,
      pending: { kind: 'refresh' as const, cursor: null },
    };

    expect(acceptPage(refreshing, oldAppend, page('cursor-late'))).toBeNull();

    const refreshFailed = { ...refreshing, pending: null };
    expect(refreshFailed.nextCursor).toBe('cursor-old');
    expect(canAppend(refreshFailed, 'manual')).toBe(true);
    const retryContext = context(refreshFailed);
    const retried = {
      ...refreshFailed,
      pending: { kind: 'append' as const, cursor: retryContext.cursor },
    };
    expect(acceptPage(retried, retryContext, page('cursor-next'))?.nextCursor).toBe('cursor-next');
  });

  test('accepts refresh as a new chain and resets cursor history and automatic-load budget', () => {
    const refreshing = state({
      generation: 4,
      cursorHistory: ['cursor-1', 'cursor-2'],
      automaticLoadCount: 2,
      pending: { kind: 'refresh', cursor: null },
    });

    const accepted = acceptPage(refreshing, context(refreshing, 'refresh'), page('cursor-fresh'));

    expect(accepted).toMatchObject({
      generation: 4,
      cursorHistory: [],
      automaticLoadCount: 0,
      nextCursor: 'cursor-fresh',
      pending: null,
      appendError: false,
    });
  });

  test('rejects pages from a different generation, session, user, Following generation, or cursor', () => {
    const current = state({ pending: { kind: 'append', cursor: 'cursor-1' } });
    const request = context(current);
    const mismatches = [
      { ...request, generation: request.generation - 1 },
      { ...request, sessionEpoch: request.sessionEpoch - 1 },
      { ...request, userId: 'user-b' },
      { ...request, followingGeneration: request.followingGeneration + 1 },
      { ...request, cursor: 'cursor-other' },
    ];

    for (const stale of mismatches) expect(acceptPage(current, stale, page('cursor-2'))).toBeNull();
  });

  test('scopes query keys to session, user, sort, poll, root, and Following generation', () => {
    const key = paginationQueryKey({
      surface: 'replies', sessionEpoch: 5, userId: 'user-a', pollId: 'poll-1', rootId: 'root-1',
    });
    expect(key).toEqual(['pagination', 'replies', 5, 'user-a', null, 'poll-1', 'root-1', null]);
    expect(paginationQueryKey({ surface: 'replies', sessionEpoch: 6, userId: 'user-a', pollId: 'poll-1', rootId: 'root-1' })).not.toEqual(key);
    expect(paginationQueryKey({ surface: 'replies', sessionEpoch: 5, userId: 'user-b', pollId: 'poll-1', rootId: 'root-1' })).not.toEqual(key);
    expect(paginationQueryKey({ surface: 'feed', sessionEpoch: 5, userId: 'user-a', sort: 'popular' })).toContain('popular');
    expect(paginationQueryKey({ surface: 'comments', sessionEpoch: 5, userId: 'user-a', pollId: 'poll-2' })).not.toEqual(key);
    expect(paginationQueryKey({ surface: 'replies', sessionEpoch: 5, userId: 'user-a', pollId: 'poll-1', rootId: 'root-2' })).not.toEqual(key);
    expect(paginationQueryKey({ surface: 'subscriptions', sessionEpoch: 5, userId: 'user-a', followingGeneration: 3 }))
      .not.toEqual(paginationQueryKey({ surface: 'subscriptions', sessionEpoch: 5, userId: 'user-a', followingGeneration: 2 }));
  });

  test('does not refetch accumulated pages on window focus', () => {
    expect(paginationQueryOptions.refetchOnWindowFocus).toBe(false);
  });
});
