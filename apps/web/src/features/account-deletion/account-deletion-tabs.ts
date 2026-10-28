const CHANNEL_NAME = 'yask.account-deletion';
const STORAGE_EVENT_KEY = 'yask.account-deletion.event';
const MESSAGE = { type: 'account.deleted' } as const;

function publishWithStorageEvent(): void {
  const event = JSON.stringify({ ...MESSAGE, nonce: crypto.randomUUID() });
  localStorage.setItem(STORAGE_EVENT_KEY, event);
  localStorage.removeItem(STORAGE_EVENT_KEY);
}

export function announceAccountDeletion(): void {
  if (typeof BroadcastChannel !== 'undefined') {
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(MESSAGE);
      return;
    } catch {
      // Fall through to the storage event for browsers that block BroadcastChannel.
    } finally {
      channel?.close();
    }
  }
  try { publishWithStorageEvent(); } catch { /* Cross-tab notification must not hide a completed server deletion. */ }
}

function isDeletionMessage(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'account.deleted';
}

export function subscribeToAccountDeletion(onDeleted: () => void): () => void {
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event: MessageEvent<unknown>) => { if (isDeletionMessage(event.data)) onDeleted(); };
      return () => channel.close();
    } catch {
      // Fall through to the storage event for browsers that block BroadcastChannel.
    }
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_EVENT_KEY || !event.newValue) return;
    try { if (isDeletionMessage(JSON.parse(event.newValue))) onDeleted(); } catch { /* Ignore malformed cross-tab messages. */ }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

export function replaceCurrentPageWithDeletionStatus(cleanupFailed = false): void {
  const suffix = cleanupFailed ? '&cleanup=failed' : '';
  window.history.replaceState(null, '', `/account-deletion?status=accepted${suffix}`);
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
}
