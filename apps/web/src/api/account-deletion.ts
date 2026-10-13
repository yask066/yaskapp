import type { AccountDeletionStatusResponse, AccountDeletionVerificationResponse } from '@yaskapp/shared';
import { ApiError } from './client';

export type AccountDeletionVerificationInput = { login?: string; password: string };

async function request<T>(path: string, init: RequestInit, decode: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-auth-mode': 'cookie', ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'network_error', 'The request could not be completed.');
  }

  const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const payload = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    throw new ApiError(response.status, typeof payload.error === 'string' ? payload.error : undefined, typeof payload.message === 'string' ? payload.message : 'Request failed.');
  }
  try {
    return decode(body);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'invalid_response', 'The server returned an invalid response.');
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid object');
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('invalid string');
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function decodeStatus(value: unknown): AccountDeletionStatusResponse {
  const source = object(value);
  const status = source.status;
  if (!['not_started', 'pending', 'processing', 'retrying', 'completed'].includes(String(status))) throw new Error('invalid status');
  return {
    operationId: string(source.operationId),
    status: status as AccountDeletionStatusResponse['status'],
    acceptedAt: nullableString(source.acceptedAt),
    deadlineAt: nullableString(source.deadlineAt),
    completedAt: nullableString(source.completedAt),
  };
}

function decodeVerification(value: unknown): AccountDeletionVerificationResponse {
  const source = object(value);
  if (source.status !== 'not_started') throw new Error('invalid status');
  return {
    operationId: string(source.operationId),
    status: 'not_started',
    deletionToken: string(source.deletionToken),
    statusToken: string(source.statusToken),
    deletionTokenExpiresAt: string(source.deletionTokenExpiresAt),
    statusTokenExpiresAt: string(source.statusTokenExpiresAt),
  };
}

export function verifyAccountDeletion(input: AccountDeletionVerificationInput): Promise<AccountDeletionVerificationResponse> {
  return request('/auth/account-deletion/verification', {
    method: 'POST',
    body: JSON.stringify(input.login === undefined ? { password: input.password } : { login: input.login, password: input.password }),
  }, decodeVerification);
}

export function deleteAccount(deletionToken: string): Promise<AccountDeletionStatusResponse> {
  return request('/auth/me', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${deletionToken}` },
    body: JSON.stringify({ confirm: true }),
  }, decodeStatus);
}

export function getAccountDeletionStatus(statusToken: string): Promise<AccountDeletionStatusResponse> {
  return request('/auth/account-deletion/status', {
    method: 'GET',
    headers: { authorization: `Bearer ${statusToken}` },
  }, decodeStatus);
}
