import { expect, test } from 'vitest';
import { ListScrollStateStore, type ListContext } from './list-scroll-state';

const context: ListContext = {
  userId: 'user-1',
  route: '/search',
  list: 'poll-results',
  query: 'motion',
  filter: 'polls',
  sort: 'newest',
};

test('keeps anchors isolated by route, query, filter, sort, and user', () => {
  const store = new ListScrollStateStore();
  store.capture(context, { id: 'poll-1', top: 84 });

  expect(store.read(context)).toEqual({ id: 'poll-1', top: 84 });
  expect(store.read({ ...context, query: 'scroll' })).toBeNull();
  expect(store.read({ ...context, filter: 'users' })).toBeNull();
  expect(store.read({ ...context, sort: 'popular' })).toBeNull();
  expect(store.read({ ...context, route: '/profile' })).toBeNull();
  expect(store.read({ ...context, userId: 'user-2' })).toBeNull();
});

test('clears every saved list for the user on logout', () => {
  const store = new ListScrollStateStore();
  store.capture(context, { id: 'poll-1', top: 84 });
  store.capture({ ...context, list: 'people' }, { id: 'user-1', top: 22 });
  store.capture({ ...context, userId: 'user-2' }, { id: 'poll-2', top: 15 });

  store.clearForUser('user-1');

  expect(store.read(context)).toBeNull();
  expect(store.read({ ...context, list: 'people' })).toBeNull();
  expect(store.read({ ...context, userId: 'user-2' })).toEqual({ id: 'poll-2', top: 15 });
});

test('keeps the captured anchor through an append and falls forward to the nearest surviving item', () => {
  const store = new ListScrollStateStore();
  store.capture(context, { id: 'poll-2', top: 64 }, [
    { id: 'poll-2', top: 64 },
    { id: 'poll-3', top: 240 },
    { id: 'poll-4', top: 416 },
  ], ['poll-1', 'poll-2', 'poll-3', 'poll-4']);

  expect(store.read(context, ['poll-0', 'poll-1', 'poll-2', 'poll-3', 'poll-4'])).toEqual({ id: 'poll-2', top: 64 });
  expect(store.read(context, ['poll-1', 'poll-3', 'poll-4'])).toEqual({ id: 'poll-3', top: 240 });
});

test('keeps the same anchor and screen coordinate when multiple items above it are deleted', () => {
  const store = new ListScrollStateStore();
  store.capture(context, { id: 'poll-4', top: 72 }, [
    { id: 'poll-4', top: 72 },
    { id: 'poll-5', top: 248 },
  ], ['poll-1', 'poll-2', 'poll-3', 'poll-4', 'poll-5']);

  expect(store.read(context, ['poll-4', 'poll-5'])).toEqual({ id: 'poll-4', top: 72 });
});

test('falls back to the nearest previous surviving item when all following anchors were removed', () => {
  const store = new ListScrollStateStore();
  store.capture(context, { id: 'poll-3', top: 80 }, [
    { id: 'poll-3', top: 80 },
    { id: 'poll-4', top: 260 },
  ], ['poll-1', 'poll-2', 'poll-3', 'poll-4']);

  expect(store.read(context, ['poll-1', 'poll-2'])).toEqual({ id: 'poll-2', top: 80 });
});

test('returns no anchor for an empty list and does not apply state to another context', () => {
  const store = new ListScrollStateStore();
  store.capture(context, { id: 'poll-1', top: 40 });

  expect(store.read(context, [])).toBeNull();
  expect(store.read({ ...context, query: 'different' }, ['poll-1'])).toBeNull();
});
