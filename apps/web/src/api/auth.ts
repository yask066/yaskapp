import { apiClient } from './client';
import { decodeAuthSession, decodeAuthUser, responseField, type AuthSession, type AuthUser } from './models';

export function login(input: { login: string; password: string }): Promise<AuthSession> {
  return apiClient.send('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, decodeAuthSession);
}

export function register(input: { email: string; username: string; password: string; countryCode: string; displayName?: string }): Promise<AuthSession> {
  return apiClient.send('/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, decodeAuthSession);
}

export function getMe(): Promise<AuthUser> {
  return apiClient.get('/auth/me', (body) => responseField(body, 'user', decodeAuthUser));
}
