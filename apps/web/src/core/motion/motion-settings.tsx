import { useMemo, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import { MotionSettingsContext, defaultMotionFlags, type MotionFlags } from './motion-settings-context';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function getReducedMotionSnapshot(): boolean {
  const prefersReducedMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(reducedMotionQuery).matches;
  const documentIsHidden = typeof document !== 'undefined' && document.hidden;
  return prefersReducedMotion || documentIsHidden;
}

function subscribeToMotionEnvironment(onChange: () => void): () => void {
  const mediaQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(reducedMotionQuery)
    : null;
  mediaQuery?.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', onChange);

  return () => {
    mediaQuery?.removeEventListener('change', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}

export function MotionSettingsProvider({
  children,
  flags = defaultMotionFlags,
}: {
  children: ReactNode;
  flags?: MotionFlags;
}): JSX.Element {
  const reduceMotion = useSyncExternalStore(
    subscribeToMotionEnvironment,
    getReducedMotionSnapshot,
    () => false,
  );
  const settings = useMemo(() => ({ ...flags, reduceMotion }), [flags, reduceMotion]);

  return <MotionSettingsContext.Provider value={settings}>{children}</MotionSettingsContext.Provider>;
}
