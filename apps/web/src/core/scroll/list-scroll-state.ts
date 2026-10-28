export interface ListContext {
  userId: string | null;
  route: string;
  list: string;
  query: string;
  filter: string;
  sort: string;
}

export interface ListAnchor {
  id: string;
  top: number;
}

interface SavedListState {
  anchor: ListAnchor;
  visibleAnchors: ListAnchor[];
  itemIds: string[];
}

function contextKey(context: ListContext): string {
  return JSON.stringify([
    context.userId,
    context.route,
    context.list,
    context.query,
    context.filter,
    context.sort,
  ]);
}

export class ListScrollStateStore {
  private readonly states = new Map<string, SavedListState>();

  capture(
    context: ListContext,
    anchor: ListAnchor,
    visibleAnchors: ListAnchor[] = [anchor],
    itemIds: string[] = visibleAnchors.map(({ id }) => id),
  ): void {
    const anchors = visibleAnchors.some(({ id }) => id === anchor.id)
      ? visibleAnchors
      : [anchor, ...visibleAnchors];
    const orderedIds = itemIds.includes(anchor.id) ? itemIds : [anchor.id, ...itemIds];
    this.states.set(contextKey(context), {
      anchor: { ...anchor },
      visibleAnchors: anchors.map((item) => ({ ...item })),
      itemIds: [...orderedIds],
    });
  }

  read(context: ListContext, currentItemIds?: string[]): ListAnchor | null {
    const saved = this.states.get(contextKey(context));
    if (!saved) return null;
    if (currentItemIds === undefined) return { ...saved.anchor };
    if (currentItemIds.includes(saved.anchor.id)) return { ...saved.anchor };
    if (currentItemIds.length === 0) return null;

    const available = new Set(currentItemIds);
    const originalIndex = saved.itemIds.indexOf(saved.anchor.id);
    const next = saved.itemIds.slice(Math.max(0, originalIndex + 1)).find((id) => available.has(id));
    const previous = saved.itemIds.slice(0, Math.max(0, originalIndex)).reverse().find((id) => available.has(id));
    const fallbackId = next ?? previous ?? currentItemIds[0];
    const fallbackPosition = saved.visibleAnchors.find(({ id }) => id === fallbackId);

    // If the fallback was not visible when captured, the old anchor's top is the best
    // available coordinate; the browser integration can still clamp at list edges.
    return { id: fallbackId, top: fallbackPosition?.top ?? saved.anchor.top };
  }

  clearForUser(userId: string): void {
    for (const key of this.states.keys()) {
      const savedUserId: unknown = JSON.parse(key)[0];
      if (savedUserId === userId) this.states.delete(key);
    }
  }

  clear(): void {
    this.states.clear();
  }
}

export const listScrollState = new ListScrollStateStore();
