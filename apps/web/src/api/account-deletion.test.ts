import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ApiError, apiClient } from './client';
import { deleteAccount, getAccountDeletionStatus, verifyAccountDeletion } from './account-deletion';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); apiClient.setOnUnauthorized(null); });
afterAll(() => server.close());

test('invalid deletion credentials do not invoke the ordinary unauthorized handler', async () => {
  const onUnauthorized = vi.fn();
  apiClient.setOnUnauthorized(onUnauthorized);
  server.use(http.post('/auth/account-deletion/verification', async ({ request }) => {
    expect(request.headers.get('x-auth-mode')).toBe('cookie');
    expect(await request.json()).toEqual({ login: 'locked@example.com', password: 'wrong' });
    return HttpResponse.json({ error: 'invalid_credentials', message: 'The login or password is incorrect.' }, { status: 403 });
  }));

  await expect(verifyAccountDeletion({ login: 'locked@example.com', password: 'wrong' }))
    .rejects.toMatchObject({ status: 403, code: 'invalid_credentials' });
  expect(onUnauthorized).not.toHaveBeenCalled();
});

test('preserves the ordinary session when the server returns 401 for deletion-only credentials', async () => {
  const onUnauthorized = vi.fn();
  apiClient.setOnUnauthorized(onUnauthorized);
  server.use(http.post('/auth/account-deletion/verification', () => HttpResponse.json({ error: 'unauthorized', message: 'The login or password is incorrect.' }, { status: 401 })));

  await expect(verifyAccountDeletion({ login: 'locked@example.com', password: 'wrong' })).rejects.toMatchObject({ status: 401 });
  expect(onUnauthorized).not.toHaveBeenCalled();
});

test('keeps origin rejection local to the deletion flow', async () => {
  const onUnauthorized = vi.fn();
  apiClient.setOnUnauthorized(onUnauthorized);
  server.use(http.post('/auth/account-deletion/verification', () => HttpResponse.json({ error: 'csrf_origin_rejected', message: 'This request origin is not trusted.' }, { status: 403 })));

  await expect(verifyAccountDeletion({ password: 'correct' })).rejects.toMatchObject({ status: 403, code: 'csrf_origin_rejected' });
  expect(onUnauthorized).not.toHaveBeenCalled();
});

test('sends deletion and status credentials only in authorization headers', async () => {
  const requests: Array<{ method: string; authorization: string | null; url: string; body?: unknown }> = [];
  server.use(
    http.delete('/auth/me', async ({ request }) => {
      requests.push({ method: request.method, authorization: request.headers.get('authorization'), url: new URL(request.url).href, body: await request.json() });
      return HttpResponse.json({ operationId: 'operation-1', status: 'pending', acceptedAt: '2026-10-12T10:15:00.000Z', deadlineAt: '2026-10-13T10:15:00.000Z', completedAt: null }, { status: 202 });
    }),
    http.get('/auth/account-deletion/status', ({ request }) => {
      requests.push({ method: request.method, authorization: request.headers.get('authorization'), url: new URL(request.url).href });
      return HttpResponse.json({ operationId: 'operation-1', status: 'processing', acceptedAt: '2026-10-12T10:15:00.000Z', deadlineAt: '2026-10-13T10:15:00.000Z', completedAt: null });
    }),
  );

  await expect(deleteAccount('deletion-secret')).resolves.toMatchObject({ status: 'pending' });
  await expect(getAccountDeletionStatus('status-secret')).resolves.toMatchObject({ status: 'processing' });
  expect(requests).toEqual([
    { method: 'DELETE', authorization: 'Bearer deletion-secret', url: expect.stringMatching(/\/auth\/me$/), body: { confirm: true } },
    { method: 'GET', authorization: 'Bearer status-secret', url: expect.stringMatching(/\/auth\/account-deletion\/status$/) },
  ]);
});

test('does not treat an expired status token as proof of deletion', async () => {
  server.use(http.get('/auth/account-deletion/status', () => HttpResponse.json({ error: 'unauthorized', message: 'The status token has expired.' }, { status: 401 })));
  await expect(getAccountDeletionStatus('expired-secret')).rejects.toBeInstanceOf(ApiError);
});
