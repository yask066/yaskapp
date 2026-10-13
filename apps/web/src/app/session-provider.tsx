import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { focusManager, onlineManager, useQueryClient } from '@tanstack/react-query';
import { getMe, login, logout, register } from '../api/auth';
import { ApiError, apiClient } from '../api/client';
import type { AuthUser } from '../api/models';
import { reconcileCachedPolls, resetPollSession } from '../features/polls/poll-state';
import { clearEntryMotionRegistry } from '../core/motion/entry-motion-registry';
import { clearPrivateBrowserStorage, loadAccountDeletionReceipt } from '../features/account-deletion/account-deletion-receipt';
import { replaceCurrentPageWithDeletionStatus, subscribeToAccountDeletion } from '../features/account-deletion/account-deletion-tabs';

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  sessionEpoch: number;
  accountDeletionPending: boolean;
  signIn(input: { login: string; password: string }): Promise<void>;
  register(input: { email: string; username: string; password: string; countryCode: string; displayName?: string }): Promise<void>;
  signOut(): void;
  completeAccountDeletion(): Promise<void>;
  setAccountDeletionPending(pending: boolean): Promise<void>;
  updateUser(user: AuthUser): void;
  reconcilePolls(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [accountDeletionPending, setAccountDeletionPendingState] = useState(() => Boolean(loadAccountDeletionReceipt()));
  const requestEpoch = useRef(0);

  const clearSession = useCallback(() => {
    clearEntryMotionRegistry();
    requestEpoch.current += 1;
    apiClient.cancelSessionRequests();
    setSessionEpoch((epoch) => epoch + 1);
    resetPollSession(queryClient);
    queryClient.clear();
    setUser(null);
    setStatus('anonymous');
  }, [queryClient]);

  const completeAccountDeletion = useCallback(async () => {
    setAccountDeletionPendingState(true);
    requestEpoch.current += 1;
    apiClient.cancelSessionRequests();
    await queryClient.cancelQueries();
    clearEntryMotionRegistry();
    setSessionEpoch((epoch) => epoch + 1);
    resetPollSession(queryClient);
    queryClient.clear();
    setUser(null);
    setStatus('anonymous');
    clearPrivateBrowserStorage();
  }, [queryClient]);

  const setAccountDeletionPending = useCallback(async (pending: boolean) => {
    setAccountDeletionPendingState(pending);
    if (pending) {
      requestEpoch.current += 1;
      apiClient.cancelSessionRequests();
      await queryClient.cancelQueries();
      clearEntryMotionRegistry();
      setSessionEpoch((epoch) => epoch + 1);
      resetPollSession(queryClient);
      queryClient.clear();
    }
  }, [queryClient]);

  useEffect(() => {
    const epoch = ++requestEpoch.current;
    const controller = new AbortController();
    apiClient.setOnUnauthorized(clearSession);
    void getMe(controller.signal).then((currentUser) => {
      if (requestEpoch.current !== epoch) return;
      setUser(currentUser);
      setStatus('authenticated');
    }).catch((error: unknown) => {
      if (requestEpoch.current !== epoch) return;
      if (error instanceof ApiError && error.status === 401) {
        clearSession();
        return;
      }
      setStatus('anonymous');
    });
    return () => {
      requestEpoch.current += 1;
      controller.abort();
      apiClient.cancelSessionRequests();
      apiClient.setOnUnauthorized(null);
    };
  }, [clearSession]);

  const establishSession = useCallback((nextUser: AuthUser) => {
    clearEntryMotionRegistry();
    requestEpoch.current += 1;
    apiClient.cancelSessionRequests();
    setSessionEpoch((epoch) => epoch + 1);
    resetPollSession(queryClient);
    queryClient.clear();
    setUser(nextUser);
    setStatus('authenticated');
  }, [queryClient]);

  const authenticate = useCallback(async (run: () => Promise<AuthUser>) => {
    const epoch = ++requestEpoch.current;
    apiClient.cancelSessionRequests();
    try {
      const nextUser = await run();
      if (requestEpoch.current === epoch) establishSession(nextUser);
    } catch (error) {
      if (requestEpoch.current === epoch) setStatus((current) => current === 'loading' ? 'anonymous' : current);
      throw error;
    }
  }, [establishSession]);

  const reconcilePolls = useCallback(() => status === 'loading' || accountDeletionPending ? Promise.resolve() : reconcileCachedPolls(queryClient, user?.id ?? null), [accountDeletionPending, queryClient, status, user?.id]);
  useEffect(() => {
    const unfocus = focusManager.subscribe((focused) => { if (focused && onlineManager.isOnline()) void reconcilePolls(); });
    const unonline = onlineManager.subscribe((online) => { if (online && focusManager.isFocused()) void reconcilePolls(); });
    return () => { unfocus(); unonline(); };
  }, [reconcilePolls, sessionEpoch]);

  useEffect(() => subscribeToAccountDeletion(() => {
    void completeAccountDeletion().then(() => {
      replaceCurrentPageWithDeletionStatus();
    }).catch(() => {
      replaceCurrentPageWithDeletionStatus(true);
    });
  }), [completeAccountDeletion]);

  const value = useMemo<SessionState>(() => ({
    status, user, sessionEpoch,
    signIn: (input) => authenticate(() => login(input)),
    register: (input) => authenticate(() => register(input)),
    signOut: () => { clearSession(); void logout().catch(() => undefined); },
    completeAccountDeletion, accountDeletionPending, setAccountDeletionPending,
    updateUser: setUser, reconcilePolls,
  }), [accountDeletionPending, authenticate, clearSession, completeAccountDeletion, reconcilePolls, sessionEpoch, setAccountDeletionPending, status, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within a SessionProvider.');
  return value;
}

// This hook is also consumed by isolated feature tests without a session provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalSession(): SessionState | null {
  return useContext(SessionContext);
}
