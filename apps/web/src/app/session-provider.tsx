import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getMe, login, logout, register } from '../api/auth';
import { ApiError, apiClient } from '../api/client';
import type { AuthUser } from '../api/models';
import { resetPollSession } from '../features/polls/poll-state';

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  sessionEpoch: number;
  signIn(input: { login: string; password: string }): Promise<void>;
  register(input: { email: string; username: string; password: string; countryCode: string; displayName?: string }): Promise<void>;
  signOut(): void;
  updateUser(user: AuthUser): void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const requestEpoch = useRef(0);

  const clearSession = useCallback(() => {
    setSessionEpoch((epoch) => epoch + 1);
    resetPollSession(queryClient);
    queryClient.clear();
    setUser(null);
    setStatus('anonymous');
  }, [queryClient]);

  useEffect(() => {
    const epoch = requestEpoch.current;
    apiClient.setOnUnauthorized(clearSession);
    void getMe().then((currentUser) => {
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
    return () => apiClient.setOnUnauthorized(null);
  }, [clearSession]);

  const establishSession = useCallback((nextUser: AuthUser) => {
    setSessionEpoch((epoch) => epoch + 1);
    resetPollSession(queryClient);
    setUser(nextUser);
    setStatus('authenticated');
  }, [queryClient]);

  const value = useMemo<SessionState>(() => ({
    status, user, sessionEpoch,
    signIn: async (input) => establishSession(await login(input)),
    register: async (input) => establishSession(await register(input)),
    signOut: () => { requestEpoch.current += 1; clearSession(); void logout().catch(() => undefined); },
    updateUser: setUser,
  }), [clearSession, establishSession, sessionEpoch, status, user]);

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
