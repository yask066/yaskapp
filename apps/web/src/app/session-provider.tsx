import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getMe, login, register } from '../api/auth';
import { ApiError, apiClient } from '../api/client';
import type { AuthUser } from '../api/models';

const accessTokenKey = 'yaskapp.access-token';
type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  signIn(input: { login: string; password: string }): Promise<void>;
  register(input: { email: string; username: string; password: string; countryCode: string; displayName?: string }): Promise<void>;
  signOut(): void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const clearSession = useCallback(() => {
    apiClient.clearAccessToken();
    sessionStorage.removeItem(accessTokenKey);
    queryClient.clear();
    setUser(null);
    setStatus('anonymous');
  }, [queryClient]);

  useEffect(() => {
    apiClient.setOnUnauthorized(clearSession);
    const token = sessionStorage.getItem(accessTokenKey);
    if (!token) { apiClient.clearAccessToken(); setStatus('anonymous'); return () => apiClient.setOnUnauthorized(null); }
    apiClient.setAccessToken(token);
    void getMe().then((currentUser) => {
      if (sessionStorage.getItem(accessTokenKey) !== token) return;
      setUser(currentUser);
      setStatus('authenticated');
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        if (sessionStorage.getItem(accessTokenKey) === token) clearSession();
        return;
      }
      if (sessionStorage.getItem(accessTokenKey) === token) setStatus('anonymous');
    });
    return () => apiClient.setOnUnauthorized(null);
  }, [clearSession]);

  const establishSession = useCallback((session: { accessToken: string; user: AuthUser }) => {
    sessionStorage.setItem(accessTokenKey, session.accessToken);
    apiClient.setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');
  }, []);

  const value = useMemo<SessionState>(() => ({
    status, user,
    signIn: async (input) => establishSession(await login(input)),
    register: async (input) => establishSession(await register(input)),
    signOut: clearSession,
  }), [clearSession, establishSession, status, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within a SessionProvider.');
  return value;
}
