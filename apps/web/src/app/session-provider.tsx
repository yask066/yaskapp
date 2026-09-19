import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getMe, login, logout, register } from '../api/auth';
import { ApiError, apiClient } from '../api/client';
import type { AuthUser } from '../api/models';

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
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
  const sessionEpoch = useRef(0);

  const clearSession = useCallback(() => {
    queryClient.clear();
    setUser(null);
    setStatus('anonymous');
  }, [queryClient]);

  useEffect(() => {
    const epoch = sessionEpoch.current;
    apiClient.setOnUnauthorized(clearSession);
    void getMe().then((currentUser) => {
      if (sessionEpoch.current !== epoch) return;
      setUser(currentUser);
      setStatus('authenticated');
    }).catch((error: unknown) => {
      if (sessionEpoch.current !== epoch) return;
      if (error instanceof ApiError && error.status === 401) {
        clearSession();
        return;
      }
      setStatus('anonymous');
    });
    return () => apiClient.setOnUnauthorized(null);
  }, [clearSession]);

  const establishSession = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
    setStatus('authenticated');
  }, []);

  const value = useMemo<SessionState>(() => ({
    status, user,
    signIn: async (input) => establishSession(await login(input)),
    register: async (input) => establishSession(await register(input)),
    signOut: () => { sessionEpoch.current += 1; clearSession(); void logout().catch(() => undefined); },
    updateUser: setUser,
  }), [clearSession, establishSession, status, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within a SessionProvider.');
  return value;
}
