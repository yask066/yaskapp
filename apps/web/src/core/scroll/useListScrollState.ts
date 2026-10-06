import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { listScrollState, type ListAnchor, type ListContext, type ListScrollStateStore } from './list-scroll-state';

export type ListScrollPriority = 'explicit-target' | 'new-items' | null;

export interface UseListScrollStateOptions {
  itemIds: string[];
  priority?: ListScrollPriority;
  restoreFocusOnPop?: boolean;
  store?: ListScrollStateStore;
}

function keyFor(context: ListContext): string {
  return JSON.stringify([context.userId, context.route, context.list, context.query, context.filter, context.sort]);
}

function clampToDocument(top: number): number {
  const viewportHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  return Math.min(Math.max(0, top), Math.max(0, documentHeight - viewportHeight));
}

export function useListScrollState(context: ListContext, options: UseListScrollStateOptions) {
  const { itemIds, priority = null, restoreFocusOnPop = false, store = listScrollState } = options;
  const { filter, list, query, route, sort, userId } = context;
  const stableContext = useMemo(() => ({ filter, list, query, route, sort, userId }), [filter, list, query, route, sort, userId]);
  const listElement = useRef<HTMLElement | null>(null);
  const listRef = useCallback((element: HTMLElement | null) => { listElement.current = element; }, []);
  const itemIdsRef = useRef(itemIds);
  itemIdsRef.current = itemIds;
  const contextKey = keyFor(stableContext);
  const itemIdsKey = useMemo(() => JSON.stringify(itemIds), [itemIds]);
  const restoredFocus = useRef(false);

  const capture = useCallback(() => {
    const root = listElement.current;
    if (!root) return;
    const visibleAnchors: ListAnchor[] = [...root.querySelectorAll<HTMLElement>('[data-list-item-id]')]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight)
      .map(({ element, rect }) => ({ id: element.dataset.listItemId ?? '', top: rect.top }))
      .filter(({ id }) => id.length > 0);
    const anchor = visibleAnchors[0];
    if (anchor) store.capture(stableContext, anchor, visibleAnchors, itemIdsRef.current);
  }, [stableContext, store]);

  const restore = useCallback((ids: string[] = itemIdsRef.current, restorePriority: ListScrollPriority = priority): boolean => {
    if (restorePriority) return false;
    const anchor = store.read(stableContext, ids);
    if (!anchor) return false;
    const root = listElement.current;
    if (!root) return false;
    const element = [...root.querySelectorAll<HTMLElement>('[data-list-item-id]')]
      .find((item) => item.dataset.listItemId === anchor.id);
    if (!element) return false;

    const currentScrollTop = window.scrollY || document.documentElement.scrollTop;
    const requestedTop = currentScrollTop + element.getBoundingClientRect().top - anchor.top;
    window.scrollTo({ top: clampToDocument(requestedTop), behavior: 'auto' });
    if (restoreFocusOnPop && !restoredFocus.current) {
      element.focus({ preventScroll: true });
      restoredFocus.current = true;
    }
    return true;
  }, [stableContext, priority, store, restoreFocusOnPop]);

  useLayoutEffect(() => {
    const ids = itemIdsRef.current;
    if (ids.length === 0 || priority) return;
    if (!restore(ids, priority) && (window.scrollY || document.documentElement.scrollTop) > 0) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [contextKey, itemIdsKey, priority, restore]);

  useLayoutEffect(() => {
    const saveOnScroll = () => capture();
    const restoreOnResize = () => { restore(itemIdsRef.current, priority); };
    window.addEventListener('scroll', saveOnScroll, { passive: true });
    window.addEventListener('resize', restoreOnResize);
    window.visualViewport?.addEventListener('resize', restoreOnResize);
    return () => {
      capture();
      window.removeEventListener('scroll', saveOnScroll);
      window.removeEventListener('resize', restoreOnResize);
      window.visualViewport?.removeEventListener('resize', restoreOnResize);
    };
  }, [contextKey, capture, priority, restore]);

  return { listRef, capture, restore };
}
