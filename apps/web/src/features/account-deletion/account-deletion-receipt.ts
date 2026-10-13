export interface AccountDeletionReceipt {
  operationId: string;
  statusToken: string;
  expiresAt: string;
}

const RECEIPT_PREFIX = 'yask.account-deletion.receipt:';

function receiptKeys(): string[] {
  return Object.keys(localStorage).filter((key) => key.startsWith(RECEIPT_PREFIX));
}

export function loadAccountDeletionReceipt(now = Date.now()): AccountDeletionReceipt | null {
  try {
    const [key] = receiptKeys();
    if (!key) return null;
    const receipt: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (typeof receipt !== 'object' || receipt === null) { localStorage.removeItem(key); return null; }
    const value = receipt as Record<string, unknown>;
    const operationId = typeof value.operationId === 'string' ? value.operationId : null;
    const statusToken = typeof value.statusToken === 'string' ? value.statusToken : null;
    const expiresAtValue = typeof value.expiresAt === 'string' ? value.expiresAt : null;
    const expiresAt = expiresAtValue === null ? Number.NaN : Date.parse(expiresAtValue);
    if (operationId === null || statusToken === null || expiresAtValue === null || !Number.isFinite(expiresAt) || expiresAt <= now) {
      localStorage.removeItem(key);
      return null;
    }
    return { operationId, statusToken, expiresAt: expiresAtValue };
  } catch {
    return null;
  }
}

export function saveAccountDeletionReceipt(receipt: AccountDeletionReceipt): void {
  for (const key of receiptKeys()) localStorage.removeItem(key);
  const key = `${RECEIPT_PREFIX}${crypto.randomUUID()}`;
  localStorage.setItem(key, JSON.stringify(receipt));
}

export function clearAccountDeletionReceipt(): void {
  for (const key of receiptKeys()) localStorage.removeItem(key);
}

export function clearPrivateBrowserStorage(): void {
  const preservedReceipts = new Set(receiptKeys());
  for (const key of Object.keys(localStorage)) if (!preservedReceipts.has(key)) localStorage.removeItem(key);
  sessionStorage.clear();
}
