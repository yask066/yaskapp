import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { ClientCursorPage, PollComment } from '../../api/models';

export interface CommentCacheScope {
  sessionEpoch: number;
  userId: string | null;
  pollId: string;
}

export interface CommentOverlayState {
  roots: PollComment[];
  repliesByRoot: Record<string, PollComment[]>;
  reactionRevision: number;
  reactionsById: Record<string, Pick<PollComment, 'likesCount' | 'viewerHasLiked'> & { revision: number }>;
  deletedIds: string[];
  deletedRootIds: string[];
}

const EMPTY_OVERLAYS: CommentOverlayState = {
  roots: [],
  repliesByRoot: {},
  reactionRevision: 0,
  reactionsById: {},
  deletedIds: [],
  deletedRootIds: [],
};

export function commentOverlayQueryKey(scope: CommentCacheScope) {
  return ['comment-overlays', scope.sessionEpoch, scope.userId, scope.pollId] as const;
}

export function commentMutationQueryKey(scope: CommentCacheScope, action: 'like' | 'delete') {
  return ['comment-mutation', action, scope.sessionEpoch, scope.userId, scope.pollId] as const;
}

export function useCommentOverlayState(scope: CommentCacheScope): CommentOverlayState {
  return useQuery({
    queryKey: commentOverlayQueryKey(scope),
    queryFn: () => EMPTY_OVERLAYS,
    initialData: EMPTY_OVERLAYS,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  }).data;
}

export function isCommentHidden(overlays: CommentOverlayState, comment: PollComment): boolean {
  return overlays.deletedIds.includes(comment.id) ||
    (comment.parentCommentId !== null && comment.parentCommentId !== undefined && overlays.deletedRootIds.includes(comment.parentCommentId));
}

function getOverlays(client: QueryClient, scope: CommentCacheScope): CommentOverlayState {
  return client.getQueryData<CommentOverlayState>(commentOverlayQueryKey(scope)) ?? EMPTY_OVERLAYS;
}

function setOverlays(client: QueryClient, scope: CommentCacheScope, updater: (current: CommentOverlayState) => CommentOverlayState): void {
  client.setQueryData<CommentOverlayState>(commentOverlayQueryKey(scope), (current) => updater(current ?? EMPTY_OVERLAYS));
}

function isPollComment(value: unknown): value is PollComment {
  if (!value || typeof value !== 'object') return false;
  const comment = value as PollComment;
  return typeof comment.id === 'string' && typeof comment.pollId === 'string' &&
    typeof comment.body === 'string' && typeof comment.likesCount === 'number' &&
    typeof comment.viewerHasLiked === 'boolean' && Boolean(comment.author && typeof comment.author.id === 'string');
}

function matchesScope(queryKey: readonly unknown[], scope: CommentCacheScope): boolean {
  if (queryKey[0] === 'pagination') {
    return (queryKey[1] === 'comments' || queryKey[1] === 'replies') &&
      queryKey[2] === scope.sessionEpoch && queryKey[3] === scope.userId && queryKey[5] === scope.pollId;
  }
  return queryKey[0] === 'comment-target' && queryKey[1] === scope.pollId;
}

export function invalidateCommentPages(client: QueryClient, scope: CommentCacheScope): Promise<void> {
  return client.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[0] === 'pagination' && matchesScope(queryKey, scope),
  });
}

function mapComments(value: unknown, update: (comment: PollComment) => PollComment | undefined): unknown {
  if (isPollComment(value)) return update(value);
  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    for (const item of value) {
      const result = mapComments(item, update);
      if (result !== item) changed = true;
      if (result === undefined && item !== undefined) { changed = true; continue; }
      next.push(result);
    }
    return changed ? next : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = mapComments(item, update);
      if (result !== item) changed = true;
      if (result === undefined && item !== undefined) { changed = true; continue; }
      next[key] = result;
    }
    return changed ? next : value;
  }
  return value;
}

function updateCachedComments(
  client: QueryClient,
  scope: CommentCacheScope,
  update: (comment: PollComment) => PollComment | undefined,
): void {
  for (const query of client.getQueryCache().findAll({ predicate: ({ queryKey }) => matchesScope(queryKey, scope) })) {
    const next = mapComments(query.state.data, update);
    if (next !== query.state.data && next !== undefined) client.setQueryData(query.queryKey, next);
    else if (query.queryKey[0] === 'comment-target' && next === undefined && query.state.data !== undefined) {
      void client.cancelQueries({ queryKey: query.queryKey, exact: true });
      client.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

function hasCachedComment(client: QueryClient, scope: CommentCacheScope, commentId: string): boolean {
  let found = false;
  for (const query of client.getQueryCache().findAll({ predicate: ({ queryKey }) => queryKey[0] === 'pagination' && matchesScope(queryKey, scope) })) {
    mapComments(query.state.data, (comment) => {
      if (comment.id === commentId) found = true;
      return comment;
    });
    if (found) return true;
  }
  return false;
}

export function addCreatedCommentOverlay(client: QueryClient, scope: CommentCacheScope, comment: PollComment): void {
  const overlays = getOverlays(client, scope);
  if (isCommentHidden(overlays, comment)) return;
  if (hasCachedComment(client, scope, comment.id)) {
    updateCachedComments(client, scope, (cached) => cached.id === comment.id ? comment : cached);
    return;
  }
  setOverlays(client, scope, (current) => {
    if (comment.parentCommentId === null || comment.parentCommentId === undefined) {
      return { ...current, roots: [comment, ...current.roots.filter((item) => item.id !== comment.id)] };
    }
    const existing = current.repliesByRoot[comment.parentCommentId] ?? [];
    return {
      ...current,
      repliesByRoot: { ...current.repliesByRoot, [comment.parentCommentId]: [...existing.filter((item) => item.id !== comment.id), comment] },
    };
  });
}

export function applyCommentReaction(client: QueryClient, scope: CommentCacheScope, comment: PollComment): void {
  const overlays = getOverlays(client, scope);
  if (isCommentHidden(overlays, comment)) return;
  const reaction = { likesCount: comment.likesCount, viewerHasLiked: comment.viewerHasLiked };
  const revision = overlays.reactionRevision + 1;
  setOverlays(client, scope, (current) => ({
    ...current,
    reactionRevision: revision,
    reactionsById: { ...current.reactionsById, [comment.id]: { ...reaction, revision } },
    roots: current.roots.map((item) => item.id === comment.id ? { ...item, ...reaction } : item),
    repliesByRoot: Object.fromEntries(Object.entries(current.repliesByRoot).map(([rootId, items]) => [
      rootId,
      items.map((item) => item.id === comment.id ? { ...item, ...reaction } : item),
    ])),
  }));
  updateCachedComments(client, scope, (cached) => {
    if (cached.id !== comment.id) return cached;
    return { ...cached, ...reaction };
  });
}

export function deleteCommentFromCache(client: QueryClient, scope: CommentCacheScope, comment: PollComment): void {
  const deletingRoot = comment.parentCommentId === null || comment.parentCommentId === undefined;
  setOverlays(client, scope, (current) => ({
    ...current,
    roots: current.roots.filter((item) => item.id !== comment.id),
    repliesByRoot: deletingRoot
      ? Object.fromEntries(Object.entries(current.repliesByRoot).filter(([rootId]) => rootId !== comment.id))
      : Object.fromEntries(Object.entries(current.repliesByRoot).map(([rootId, items]) => [rootId, items.filter((item) => item.id !== comment.id)])),
    reactionsById: Object.fromEntries(Object.entries(current.reactionsById).filter(([commentId]) => commentId !== comment.id)),
    deletedIds: current.deletedIds.includes(comment.id) ? current.deletedIds : [...current.deletedIds, comment.id],
    deletedRootIds: deletingRoot && !current.deletedRootIds.includes(comment.id) ? [...current.deletedRootIds, comment.id] : current.deletedRootIds,
  }));
  updateCachedComments(client, scope, (cached) => {
    if (cached.id === comment.id || (deletingRoot && cached.parentCommentId === comment.id)) return undefined;
    return cached;
  });
  if (deletingRoot) {
    const replyPrefix = ['pagination', 'replies', scope.sessionEpoch, scope.userId, null, scope.pollId, comment.id] as const;
    void client.cancelQueries({ queryKey: replyPrefix });
    client.removeQueries({ queryKey: replyPrefix });
  }
}

export function isCommentDeleted(client: QueryClient, scope: CommentCacheScope, comment: PollComment): boolean {
  return isCommentHidden(getOverlays(client, scope), comment);
}

export function reconcileCommentPage(
  client: QueryClient,
  scope: CommentCacheScope,
  page: ClientCursorPage<PollComment>,
  requestRevision = getOverlays(client, scope).reactionRevision,
): ClientCursorPage<PollComment> {
  const overlays = getOverlays(client, scope);
  const items = page.items.flatMap((comment) => {
    if (isCommentHidden(overlays, comment)) return [];
    const reaction = overlays.reactionsById[comment.id];
    return reaction && reaction.revision > requestRevision &&
      (comment.likesCount !== reaction.likesCount || comment.viewerHasLiked !== reaction.viewerHasLiked)
      ? [{ ...comment, likesCount: reaction.likesCount, viewerHasLiked: reaction.viewerHasLiked }]
      : [comment];
  });
  return items.length === page.items.length && items.every((item, index) => item === page.items[index])
    ? page
    : { ...page, items };
}

export function reconcileCommentPageCache(
  client: QueryClient,
  scope: CommentCacheScope,
  requestRevision = commentReactionRevision(client, scope),
): void {
  for (const query of client.getQueryCache().findAll({
    predicate: ({ queryKey }) => queryKey[0] === 'pagination' && matchesScope(queryKey, scope),
  })) {
    const data = query.state.data;
    if (!data || typeof data !== 'object' || !('pages' in data) || !Array.isArray(data.pages)) continue;
    let changed = false;
    const pages = (data.pages as ClientCursorPage<PollComment>[]).map((page) => {
      const reconciled = reconcileCommentPage(client, scope, page, requestRevision);
      if (reconciled !== page) changed = true;
      return reconciled;
    });
    if (changed) client.setQueryData(query.queryKey, { ...data, pages });
  }
}

export function commentReactionRevision(client: QueryClient, scope: CommentCacheScope): number {
  return getOverlays(client, scope).reactionRevision;
}

export function reconcileCommentSnapshot(
  client: QueryClient,
  scope: CommentCacheScope,
  comment: PollComment,
  requestRevision = commentReactionRevision(client, scope),
): PollComment | undefined {
  const overlays = getOverlays(client, scope);
  if (isCommentHidden(overlays, comment)) return undefined;
  const reaction = overlays.reactionsById[comment.id];
  return reaction && reaction.revision > requestRevision
    ? { ...comment, likesCount: reaction.likesCount, viewerHasLiked: reaction.viewerHasLiked }
    : comment;
}
