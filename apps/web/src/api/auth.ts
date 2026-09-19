import { apiClient } from './client';
import { decodeAuthUser, responseField, type AuthUser } from './models';

export function login(input: { login: string; password: string }): Promise<AuthUser> {
  return apiClient.send('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-auth-mode': 'cookie' }, body: JSON.stringify(input) }, (body) => responseField(body, 'user', decodeAuthUser));
}

export function register(input: { email: string; username: string; password: string; countryCode: string; displayName?: string }): Promise<AuthUser> {
  return apiClient.send('/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-auth-mode': 'cookie' }, body: JSON.stringify(input) }, (body) => responseField(body, 'user', decodeAuthUser));
}

export function getMe(): Promise<AuthUser> {
  return apiClient.get('/auth/me', (body) => responseField(body, 'user', decodeAuthUser));
}

export function logout(): Promise<void> {
  return apiClient.send('/auth/logout', { method: 'POST' }, () => undefined);
}
