import { fireEvent, render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ListScrollStateStore, type ListContext } from './list-scroll-state';
import { useListScrollState } from './useListScrollState';

const context: ListContext = {
  userId: 'user-1',
  route: '/feed',
  list: 'polls',
  query: '',
  filter: 'for-you',
  sort: 'newest',
};

test('restores the saved item immediately without inheriting smooth page scrolling', () => {
  const store = new ListScrollStateStore();
  store.capture(context, { id: 'poll-2', top: 100 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 100 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 900 });
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

  function Harness() {
    const { listRef } = useListScrollState(context, { store, itemIds: ['poll-1', 'poll-2'] });
    return <section ref={listRef}><article data-list-item-id="poll-1" /><article data-list-item-id="poll-2" /></section>;
  }

  const itemRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.dataset.listItemId === 'poll-2' ? 850 : 20, bottom: 1000, left: 0, right: 300, width: 300, height: 150, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const view = render(<Harness />);

  expect(scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'instant' });

  view.unmount();
  itemRect.mockRestore();
  scrollTo.mockRestore();
});

test('does not restore over an explicit target or the new-items action', () => {
  const store = new ListScrollStateStore();
  store.capture(context, { id: 'poll-2', top: 100 });
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

  function Harness({ priority }: { priority: 'explicit-target' | 'new-items' }) {
    const { listRef } = useListScrollState(context, { store, itemIds: ['poll-2'], priority });
    return <section ref={listRef}><article data-list-item-id="poll-2" /></section>;
  }

  const view = render(<Harness priority="explicit-target" />);
  view.rerender(<Harness priority="new-items" />);
  expect(scrollTo).not.toHaveBeenCalled();
  view.unmount();
  scrollTo.mockRestore();
});

test('keeps keyboard focus on the manual append action when another page is added', () => {
  const store = new ListScrollStateStore();
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  const initialIds = ['poll-1', 'poll-2'];

  function Harness({ itemIds }: { itemIds: string[] }) {
    const { listRef } = useListScrollState(context, { store, itemIds, restoreFocusOnPop: true });
    return <><button type="button">Load more</button><section ref={listRef}>{itemIds.map((id) => <article key={id} data-list-item-id={id} tabIndex={-1}>{id}</article>)}</section></>;
  }

  const view = render(<Harness itemIds={initialIds} />);
  const loadMore = view.getByRole('button', { name: 'Load more' });
  store.capture(context, { id: 'poll-2', top: 100 }, [{ id: 'poll-2', top: 100 }], initialIds);
  loadMore.focus();

  view.rerender(<Harness itemIds={[...initialIds, 'poll-3']} />);

  expect(loadMore).toHaveFocus();
  view.unmount();
  scrollTo.mockRestore();
});

test('rechecks the saved anchor after a viewport resize', () => {
  const store = new ListScrollStateStore();
  store.capture(context, { id: 'poll-2', top: 80 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 100 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 });
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  let top = 120;
  const itemRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 100, left: 0, right: 300, width: 300, height: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect);

  function Harness() {
    const { listRef } = useListScrollState(context, { store, itemIds: ['poll-2'] });
    return <section ref={listRef}><article data-list-item-id="poll-2" /></section>;
  }

  const view = render(<Harness />);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 140, behavior: 'instant' });
  top = 140;
  fireEvent.resize(window);
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 160, behavior: 'instant' });

  view.unmount();
  itemRect.mockRestore();
  scrollTo.mockRestore();
});

test('captures the first visible content anchor and its fallback candidates on scroll', () => {
  const store = new ListScrollStateStore();
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  function Harness() {
    const { listRef } = useListScrollState(context, { store, itemIds: ['poll-1', 'poll-2', 'poll-3'] });
    return <section ref={listRef}><article data-list-item-id="poll-1" /><article data-list-item-id="poll-2" /><article data-list-item-id="poll-3" /></section>;
  }
  const itemRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.listItemId === 'poll-1' ? -40 : this.dataset.listItemId === 'poll-2' ? 35 : 220;
    return { top, bottom: top + 150, left: 0, right: 300, width: 300, height: 150, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  const view = render(<Harness />);

  fireEvent.scroll(window);
  expect(store.read(context)).toEqual({ id: 'poll-1', top: -40 });
  expect(store.read(context, ['poll-2', 'poll-3'])).toEqual({ id: 'poll-2', top: 35 });

  view.unmount();
  itemRect.mockRestore();
  scrollTo.mockRestore();
});
