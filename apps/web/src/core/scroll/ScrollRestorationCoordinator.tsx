import { useLayoutEffect, useRef } from 'react';
import { useOptionalSession } from '../../app/session-provider';
import { listScrollState } from './list-scroll-state';

export function ScrollRestorationCoordinator() {
  const session = useOptionalSession();
  const userId = session?.user?.id ?? null;
  const sessionEpoch = session?.sessionEpoch ?? 0;
  const previousSession = useRef({ userId, sessionEpoch });

  useLayoutEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    const previous = previousSession.current;
    if (previous.userId !== userId || previous.sessionEpoch !== sessionEpoch) {
      if (previous.userId) listScrollState.clearForUser(previous.userId);
      if (userId && userId !== previous.userId) listScrollState.clearForUser(userId);
      previousSession.current = { userId, sessionEpoch };
    }
  }, [sessionEpoch, userId]);

  return null;
}
