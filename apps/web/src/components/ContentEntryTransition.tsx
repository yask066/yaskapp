import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motionTokens } from '../core/motion/motion-tokens';
import { useMotionSettings } from '../core/motion/use-motion-settings';
import { ASYNC_RETRY_FOCUS_EVENT } from './AsyncState';
import { ContentSkeleton, type ContentSkeletonKind } from './ContentSkeleton';
import { useDelayedLoading } from './useDelayedLoading';

interface ContentEntryTransitionProps {
  loading: boolean;
  kind: ContentSkeletonKind;
  rows: number;
  children: ReactNode;
}

const loadingLabels: Record<ContentSkeletonKind, string> = {
  poll: 'polls',
  user: 'people',
  comment: 'comments',
  notification: 'notifications',
};

export function ContentEntryTransition({ loading, kind, rows, children }: ContentEntryTransitionProps) {
  const { entryMotion, reduceMotion } = useMotionSettings();
  const skeletonVisible = useDelayedLoading(loading);
  const [skeletonExiting, setSkeletonExiting] = useState(false);
  const hadVisibleSkeleton = useRef(false);
  const transitionRef = useRef<HTMLDivElement>(null);
  const retryFocusRequested = useRef(false);
  const retryFocusTarget = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleRetryFocus = (event: Event) => {
      const scope = (event as CustomEvent<HTMLElement>).detail;
      if (scope.contains(transitionRef.current)) {
        retryFocusRequested.current = true;
        retryFocusTarget.current = scope;
      }
    };
    document.addEventListener(ASYNC_RETRY_FOCUS_EVENT, handleRetryFocus);
    return () => document.removeEventListener(ASYNC_RETRY_FOCUS_EVENT, handleRetryFocus);
  }, []);

  useEffect(() => {
    if (loading && retryFocusRequested.current) {
      retryFocusRequested.current = false;
      (retryFocusTarget.current ?? transitionRef.current)?.focus({ preventScroll: true });
      retryFocusTarget.current = null;
    }
  }, [loading]);

  useEffect(() => {
    if (loading) {
      if (skeletonVisible) {
        hadVisibleSkeleton.current = true;
        setSkeletonExiting(false);
      }
      if (!entryMotion || reduceMotion) setSkeletonExiting(false);
      return;
    }
    if (!entryMotion || reduceMotion) {
      setSkeletonExiting(false);
      hadVisibleSkeleton.current = false;
      return;
    }
    if (!hadVisibleSkeleton.current) return;

    hadVisibleSkeleton.current = false;
    setSkeletonExiting(true);
  }, [entryMotion, loading, reduceMotion, skeletonVisible]);

  useEffect(() => {
    if (!skeletonExiting) return;
    const timeout = window.setTimeout(() => setSkeletonExiting(false), motionTokens.skeletonCrossfadeMs);
    return () => window.clearTimeout(timeout);
  }, [skeletonExiting]);

  return <div ref={transitionRef} className="content-entry-transition">
    {children}
    {loading ? <div className={`async-state async-state--loading${skeletonVisible ? ' async-state--skeleton-visible' : ''}`} role="status" aria-busy="true"><div aria-hidden="true"><ContentSkeleton kind={kind} rows={rows} /></div><span className="sr-only">Loading {loadingLabels[kind]}…</span></div> : null}
    {skeletonExiting ? <div className="content-entry-transition__skeleton content-entry-transition__skeleton--exit" aria-hidden="true" style={{ animationDuration: `${motionTokens.skeletonCrossfadeMs}ms` }}><ContentSkeleton kind={kind} rows={rows} /></div> : null}
  </div>;
}
