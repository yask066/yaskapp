import { useEffect, useRef, type ReactNode } from 'react';
import type { ContentSkeletonKind } from './ContentSkeleton';
import { ContentSkeleton } from './ContentSkeleton';
import { useDelayedLoading } from './useDelayedLoading';

export const ASYNC_RETRY_FOCUS_EVENT = 'yaskapp:async-retry-focus';

interface AsyncStateProps {
  state: 'loading' | 'refreshing' | 'error' | 'empty';
  error?: Error | null;
  emptyMessage?: ReactNode;
  onRetry?: () => void;
  kind?: ContentSkeletonKind;
  rows?: number;
}

const loadingLabels: Record<ContentSkeletonKind, string> = {
  poll: 'polls',
  user: 'people',
  comment: 'comments',
  notification: 'notifications',
};

export function AsyncState({ state, error, emptyMessage = 'There are no polls yet.', onRetry, kind = 'poll', rows = 2 }: AsyncStateProps) {
  const showSkeleton = useDelayedLoading(state === 'loading');
  const loadingRegionRef = useRef<HTMLDivElement>(null);
  const retryRequestedRef = useRef(false);
  const retryFocusTargetRef = useRef<HTMLElement | null>(null);
  const fallbackErrorMessage = `We could not load ${loadingLabels[kind]}.`;

  useEffect(() => {
    if (state === 'loading' && retryRequestedRef.current) {
      retryRequestedRef.current = false;
      (retryFocusTargetRef.current ?? loadingRegionRef.current)?.focus({ preventScroll: true });
      retryFocusTargetRef.current = null;
    }
  }, [state]);

  if (state === 'refreshing') return <p className="async-state async-state--refreshing" role="status" aria-busy="true">Refreshing {loadingLabels[kind]}…</p>;
  if (state === 'loading') return <div ref={loadingRegionRef} tabIndex={-1} className={`async-state async-state--${state}${showSkeleton ? ' async-state--skeleton-visible' : ''}`} role="status" aria-busy="true">
    <ContentSkeleton kind={kind} rows={rows} />
    <span className="sr-only">Loading {loadingLabels[kind]}…</span>
  </div>;
  if (state === 'empty') return <p className={`async-state async-state--${state}`}>{emptyMessage}</p>;

  return (
    <section className={`async-state async-state--${state}`} role="alert">
      <p>{error?.message || fallbackErrorMessage}</p>
      {onRetry ? <button type="button" onClick={(event) => {
        retryRequestedRef.current = true;
        const scope = event.currentTarget.closest('main');
        if (scope) {
          scope.tabIndex = -1;
          document.dispatchEvent(new CustomEvent<HTMLElement>(ASYNC_RETRY_FOCUS_EVENT, { detail: scope }));
        }
        retryFocusTargetRef.current = scope;
        onRetry();
      }}>Retry</button> : null}
    </section>
  );
}
