import type { ReactNode } from 'react';
import type { ContentSkeletonKind } from './ContentSkeleton';
import { ContentSkeleton } from './ContentSkeleton';
import { useDelayedLoading } from './useDelayedLoading';

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
  const fallbackErrorMessage = `We could not load ${loadingLabels[kind]}.`;

  if (state === 'refreshing') return <p className="async-state async-state--refreshing" role="status" aria-busy="true">Refreshing {loadingLabels[kind]}…</p>;
  if (state === 'loading') return <div className={`async-state async-state--${state}${showSkeleton ? ' async-state--skeleton-visible' : ''}`} role="status" aria-busy="true">
    <ContentSkeleton kind={kind} rows={rows} />
    <span className="sr-only">Loading {loadingLabels[kind]}…</span>
  </div>;
  if (state === 'empty') return <p className={`async-state async-state--${state}`}>{emptyMessage}</p>;

  return (
    <section className={`async-state async-state--${state}`} role="alert">
      <p>{error?.message || fallbackErrorMessage}</p>
      {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
    </section>
  );
}
