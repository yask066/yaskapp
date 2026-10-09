const seenIdsByContext = new Map<string, Set<string>>();

export function markEntryMotionSeen(contextKey: string, itemId: string): boolean {
  let seenIds = seenIdsByContext.get(contextKey);
  if (!seenIds) {
    seenIds = new Set();
    seenIdsByContext.set(contextKey, seenIds);
  }
  if (seenIds.has(itemId)) return false;
  seenIds.add(itemId);
  return true;
}

export function clearEntryMotionRegistry() {
  seenIdsByContext.clear();
}
