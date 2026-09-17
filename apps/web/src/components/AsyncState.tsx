import type { ReactNode } from 'react';

interface AsyncStateProps {
  state: 'loading' | 'error' | 'empty';
  error?: Error | null;
  emptyMessage?: ReactNode;
  onRetry?: () => void;
}

export function AsyncState({ state, error, emptyMessage = 'There are no polls yet.', onRetry }: AsyncStateProps) {
  if (state === 'loading') return <p className={`async-state async-state--${state}`} role="status">Loading polls…</p>;
  if (state === 'empty') return <p className={`async-state async-state--${state}`}>{emptyMessage}</p>;

  return (
    <section className={`async-state async-state--${state}`} role="alert">
      <p>{error?.message || 'We could not load polls.'}</p>
      {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
    </section>
  );
}
