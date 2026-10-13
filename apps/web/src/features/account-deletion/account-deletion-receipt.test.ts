import { afterEach, expect, test, vi } from 'vitest';
import { clearAccountDeletionReceipt, clearPrivateBrowserStorage, loadAccountDeletionReceipt, saveAccountDeletionReceipt } from './account-deletion-receipt';

function futureExpiry() { return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); }

afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useRealTimers(); });

test('persists only the status receipt and restores it after a reload', () => {
  const expiresAt = futureExpiry();
  saveAccountDeletionReceipt({ operationId: 'operation-1', statusToken: 'status-secret', expiresAt });

  expect(loadAccountDeletionReceipt()).toEqual({ operationId: 'operation-1', statusToken: 'status-secret', expiresAt });
  expect(Object.values(localStorage)).not.toContain('deletion-secret');
  expect(Object.keys(localStorage).some((key) => key.includes('operation-1'))).toBe(false);
});

test('removes an expired receipt instead of treating it as a completed deletion', () => {
  vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
  saveAccountDeletionReceipt({ operationId: 'operation-1', statusToken: 'status-secret', expiresAt: '2026-10-15T10:00:00.000Z' });

  expect(loadAccountDeletionReceipt()).toBeNull();
  expect(Object.keys(localStorage)).toHaveLength(0);
});

test('clears private browser state while retaining the deletion status receipt', () => {
  localStorage.setItem('account-cache', 'private profile');
  sessionStorage.setItem('navigation-cache', 'private route');
  saveAccountDeletionReceipt({ operationId: 'operation-1', statusToken: 'status-secret', expiresAt: futureExpiry() });

  clearPrivateBrowserStorage();

  expect(loadAccountDeletionReceipt()?.statusToken).toBe('status-secret');
  expect(localStorage.getItem('account-cache')).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

test('deletes the receipt after the server reports completion', () => {
  saveAccountDeletionReceipt({ operationId: 'operation-1', statusToken: 'status-secret', expiresAt: futureExpiry() });

  clearAccountDeletionReceipt();

  expect(loadAccountDeletionReceipt()).toBeNull();
});
