import { useEffect, useRef } from 'react';
import type { PaginationLoadTrigger } from '../core/pagination/pagination-state';

interface PaginationFooterProps {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isRefreshing?: boolean;
  isFetchNextPageError: boolean;
  paginationSupported: boolean;
  automaticLoadEnabled: boolean;
  repeatedCursor?: boolean;
  error?: Error | null;
  endMessage?: string;
  itemName?: string;
  refreshLabel?: string;
  onLoadMore: (trigger: PaginationLoadTrigger) => void;
}

export function PaginationFooter({
  hasNextPage,
  isFetchingNextPage,
  isRefreshing = false,
  isFetchNextPageError,
  paginationSupported,
  automaticLoadEnabled,
  repeatedCursor = false,
  error,
  endMessage = "You've seen everything.",
  itemName = 'polls',
  refreshLabel = 'the feed',
  onLoadMore,
}: PaginationFooterProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || repeatedCursor || !automaticLoadEnabled || !hasNextPage || isFetchingNextPage || isRefreshing || isFetchNextPageError || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current('automatic');
    }, { rootMargin: '100% 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [automaticLoadEnabled, hasNextPage, isFetchingNextPage, isRefreshing, isFetchNextPageError, repeatedCursor]);

  if (!paginationSupported) return null;

  return <div className="pagination-footer" aria-live="polite">
    {hasNextPage && !repeatedCursor ? <div ref={sentinelRef} className="pagination-footer__sentinel" aria-hidden="true" /> : null}
    {isFetchingNextPage ? <p role="status">Loading more {itemName}…</p> : null}
    {repeatedCursor ? <p role="alert">The server returned a repeated cursor. Refresh {refreshLabel} to continue.</p> : null}
    {isFetchNextPageError ? <p role="alert">{error?.message || `Could not load more ${itemName}.`}</p> : null}
    {hasNextPage && !repeatedCursor ? <button type="button" disabled={isFetchingNextPage || isRefreshing} onClick={() => loadMoreRef.current('manual')}>
      {isFetchNextPageError ? 'Retry loading more' : 'Load more'}
    </button> : hasNextPage ? null : <p role="status">{endMessage}</p>}
  </div>;
}
