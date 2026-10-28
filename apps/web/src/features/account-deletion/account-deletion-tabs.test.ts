import { afterEach, expect, test, vi } from 'vitest';
import { announceAccountDeletion, subscribeToAccountDeletion } from './account-deletion-tabs';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

test('announces account deletion across tabs without including credentials or profile data', () => {
  const postMessage = vi.fn();
  const close = vi.fn();
  class ChannelMock { postMessage = postMessage; close = close; }
  vi.stubGlobal('BroadcastChannel', ChannelMock);

  announceAccountDeletion();

  expect(postMessage).toHaveBeenCalledWith({ type: 'account.deleted' });
  expect(JSON.stringify(postMessage.mock.calls)).not.toContain('token');
  expect(close).toHaveBeenCalledOnce();
});

test('uses a storage event when BroadcastChannel is unavailable', () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  const onDeleted = vi.fn();
  const unsubscribe = subscribeToAccountDeletion(onDeleted);
  announceAccountDeletion();
  window.dispatchEvent(new StorageEvent('storage', { key: 'yask.account-deletion.event', newValue: JSON.stringify({ type: 'account.deleted', nonce: 'other-tab' }) }));

  expect(onDeleted).toHaveBeenCalledOnce();
  unsubscribe();
});
