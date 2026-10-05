import type { Poll } from '../../api/models';
import type { QueryClient } from '@tanstack/react-query';
import { CancelledError } from '@tanstack/react-query';
import { getPoll } from '../../api/polls';
import { ApiError } from '../../api/client';

export type PollOrigin = 'http' | 'mutation' | 'realtime';
type MergeResult = { poll: Poll; needsReconcile: boolean };
const groups = ['votes', 'likes', 'comments'] as const;
type Group = typeof groups[number];
type ClientState = { polls: Map<string, Poll>; tombstones: Set<string>; pending: Map<string, string>; epoch: number; generation: number; pollGenerations: Map<string, number>; reconciliationRequests: Map<string, Promise<void>> };
const clients = new WeakMap<QueryClient, ClientState>();
function clientState(client: QueryClient): ClientState {
  let state = clients.get(client);
  if (!state) { state = { polls: new Map(), tombstones: new Set(), pending: new Map(), epoch: 0, generation: 0, pollGenerations: new Map(), reconciliationRequests: new Map() }; clients.set(client, state); }
  return state;
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a); const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key) => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

function groupPayload(poll: Poll, group: Group): unknown {
  if (group === 'votes') return [poll.votesCount, [...poll.options].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, votesCount }) => [id, votesCount])];
  if (group === 'likes') return poll.likesCount;
  return poll.commentsCount;
}

function validGroup(poll: Poll, group: Group): boolean {
  if (group === 'votes') {
    const ids = poll.options.map((option) => option.id);
    return Number.isSafeInteger(poll.votesCount) && poll.votesCount >= 0 &&
      ids.length === new Set(ids).size && poll.options.every((option) => Number.isSafeInteger(option.votesCount) && option.votesCount >= 0) &&
      poll.options.reduce((sum, option) => sum + option.votesCount, 0) === poll.votesCount &&
      (poll.viewerState?.voteOptionId === undefined || poll.viewerState.voteOptionId === null || ids.includes(poll.viewerState.voteOptionId));
  }
  const count = group === 'likes' ? poll.likesCount : poll.commentsCount;
  return Number.isSafeInteger(count) && count >= 0;
}

function applyGroup(current: Poll, incoming: Poll, group: Group): Poll {
  if (group === 'votes') return { ...current, votesCount: incoming.votesCount, options: incoming.options, stateRevisions: { ...current.stateRevisions, ...(incoming.stateRevisions?.votes !== undefined ? { votes: incoming.stateRevisions.votes } : {}) } };
  if (group === 'likes') return { ...current, likesCount: incoming.likesCount, stateRevisions: { ...current.stateRevisions, ...(incoming.stateRevisions?.likes !== undefined ? { likes: incoming.stateRevisions.likes } : {}) } };
  return { ...current, commentsCount: incoming.commentsCount, stateRevisions: { ...current.stateRevisions, ...(incoming.stateRevisions?.comments !== undefined ? { comments: incoming.stateRevisions.comments } : {}) } };
}

export function mergePollSnapshot(current: Poll | undefined, incoming: Poll, origin: PollOrigin = 'http', viewerId: string | null = null, allowLegacyBootstrap = true, allowLegacyViewerState = true): MergeResult {
  if (!current || current.id !== incoming.id) return { poll: current ?? incoming, needsReconcile: false };
  let poll = current;
  let needsReconcile = false;
  const currentRevisions = current.stateRevisions;
  const nextRevisions = incoming.stateRevisions;
  const accepted: Partial<Record<Group, boolean>> = {};
  for (const group of groups) {
    const next = nextRevisions?.[group];
    const prior = currentRevisions?.[group];
    if (next === undefined) {
      if (prior !== undefined || origin === 'realtime') { needsReconcile = true; continue; }
      if (!allowLegacyBootstrap) { needsReconcile = true; continue; }
      if (!validGroup(incoming, group)) { needsReconcile = true; continue; }
      poll = applyGroup(poll, incoming, group); accepted[group] = true;
      continue;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(next) || BigInt(next) > 9223372036854775807n || !validGroup(incoming, group)) { needsReconcile = true; continue; }
    if (prior === undefined || BigInt(next) > BigInt(prior)) { poll = applyGroup(poll, incoming, group); accepted[group] = true; }
    else if (BigInt(next) === BigInt(prior) && !same(groupPayload(current, group), groupPayload(incoming, group))) needsReconcile = true;
  }
  const viewerRevisions = { ...current.viewerStateRevisions };
  const viewerState = { ...current.viewerState };
  if (origin !== 'realtime' && viewerId !== null) {
    const incomingLike = incoming.viewerState?.hasLiked ?? (incoming.viewerState === undefined ? incoming.viewerHasLiked : undefined);
    const incomingVote = incoming.viewerState?.voteOptionId ?? (incoming.viewerState === undefined ? incoming.viewerVoteOptionId : undefined);
    const likeRevision = nextRevisions?.likes;
    const voteRevision = nextRevisions?.votes;
    if (incomingLike !== undefined && likeRevision && (viewerRevisions.hasLiked === undefined || BigInt(likeRevision) > BigInt(viewerRevisions.hasLiked))) {
      viewerState.hasLiked = incomingLike; viewerRevisions.hasLiked = likeRevision;
      poll = { ...poll, viewerHasLiked: incomingLike };
    } else if (incomingLike !== undefined && likeRevision && BigInt(likeRevision) === BigInt(viewerRevisions.hasLiked ?? '-1') && viewerState.hasLiked !== undefined && viewerState.hasLiked !== incomingLike) {
      needsReconcile = true;
    } else if (allowLegacyViewerState && incomingLike !== undefined && likeRevision === undefined && viewerRevisions.hasLiked === undefined && accepted.likes) {
      viewerState.hasLiked = incomingLike; poll = { ...poll, viewerHasLiked: incomingLike };
    }
    if (incomingVote !== undefined && voteRevision && (viewerRevisions.voteOptionId === undefined || BigInt(voteRevision) > BigInt(viewerRevisions.voteOptionId))) {
      viewerState.voteOptionId = incomingVote; viewerRevisions.voteOptionId = voteRevision;
      poll = { ...poll, viewerVoteOptionId: incomingVote };
    } else if (incomingVote !== undefined && voteRevision && BigInt(voteRevision) === BigInt(viewerRevisions.voteOptionId ?? '-1') && viewerState.voteOptionId !== undefined && viewerState.voteOptionId !== incomingVote) {
      needsReconcile = true;
    } else if (allowLegacyViewerState && incomingVote !== undefined && voteRevision === undefined && viewerRevisions.voteOptionId === undefined && accepted.votes) {
      viewerState.voteOptionId = incomingVote; poll = { ...poll, viewerVoteOptionId: incomingVote };
    }
  }
  const result = { ...poll };
  Object.defineProperties(result, {
    viewerState: { value: viewerState, enumerable: false },
    viewerStateRevisions: { value: viewerRevisions, enumerable: false },
  });
  return { poll: result, needsReconcile };
}

function isPoll(value: unknown): value is Poll {
  return Boolean(value && typeof value === 'object' && typeof (value as Poll).id === 'string' && Array.isArray((value as Poll).options) &&
    typeof (value as Poll).votesCount === 'number' && typeof (value as Poll).likesCount === 'number');
}

export function replacePollInQueryData<T>(data: T, poll: Poll): T {
  if (isPoll(data)) return (data.id === poll.id ? poll : data) as T;
  if (Array.isArray(data)) return data.map((item) => replacePollInQueryData(item, poll)) as T;
  if (data && typeof data === 'object') {
    const source = data as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = { ...source };
    for (const [key, value] of Object.entries(source)) {
      const replacement = replacePollInQueryData(value, poll);
      if (replacement !== value) { next[key] = replacement; changed = true; }
    }
    return (changed ? next : data) as T;
  }
  return data;
}

function cachedPoll(client: QueryClient, pollId: string): Poll | undefined {
  for (const query of client.getQueryCache().findAll()) {
    let found: Poll | undefined;
    const visit = (value: unknown): void => {
      if (isPoll(value)) { if (value.id === pollId) found = value; return; }
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(query.state.data);
    if (found) return found;
  }
}
export function pollSessionEpoch(client: QueryClient): number { return clientState(client).epoch; }
export function resetPollSession(client: QueryClient): void {
  const state = clientState(client); state.epoch += 1; state.generation = 0; state.pollGenerations.clear(); state.polls.clear(); state.tombstones.clear(); state.pending.clear(); state.reconciliationRequests.clear();
}
export function ingestPoll(client: QueryClient, incoming: Poll, origin: PollOrigin = 'http', viewerId: string | null = null, expectedEpoch = pollSessionEpoch(client), startedGeneration = clientState(client).generation, allowLegacyViewerState = true): Poll | undefined {
  const state = clientState(client);
  if (state.epoch !== expectedEpoch) return undefined;
  if (state.tombstones.has(incoming.id)) return undefined;
  const current = state.polls.get(incoming.id) ?? cachedPoll(client, incoming.id);
  const allowLegacyBootstrap = (state.pollGenerations.get(incoming.id) ?? 0) <= startedGeneration;
  const result = mergePollSnapshot(current, incoming, origin, viewerId, allowLegacyBootstrap, allowLegacyViewerState);
  if (result.needsReconcile) void reconcilePoll(client, incoming.id, viewerId, expectedEpoch);
  state.polls.set(incoming.id, result.poll);
  for (const query of client.getQueryCache().findAll()) {
    const data = query.state.data;
    if (data !== undefined) client.setQueryData(query.queryKey, replacePollInQueryData(data, result.poll));
  }
  return result.poll;
}

// One bounded HTTP read per Poll. A failed read can be retried by the next
// lifecycle event; neither reconciliation nor ambiguous writes retry themselves.
export function reconcilePoll(client: QueryClient, pollId: string, viewerId: string | null, expectedEpoch = pollSessionEpoch(client)): Promise<void> {
  const state = clientState(client);
  if (state.epoch !== expectedEpoch || state.tombstones.has(pollId)) return Promise.resolve();
  const existing = state.reconciliationRequests.get(pollId);
  if (existing) return existing;
  const startedGeneration = state.generation;
  const request = Promise.resolve().then(async () => {
    if (state.epoch !== expectedEpoch) return;
    try {
      const snapshot = await getPoll(pollId);
      ingestPoll(client, snapshot, 'http', viewerId, expectedEpoch, startedGeneration);
    } catch (error) {
      if (state.epoch === expectedEpoch && error instanceof ApiError && error.status === 404) deleteCachedPoll(client, pollId);
    }
  }).finally(() => {
    if (state.reconciliationRequests.get(pollId) === request) state.reconciliationRequests.delete(pollId);
  });
  state.reconciliationRequests.set(pollId, request);
  return request;
}

export async function reconcileCachedPolls(client: QueryClient, viewerId: string | null): Promise<void> {
  const epoch = pollSessionEpoch(client);
  const ids = new Set(clientState(client).polls.keys());
  const visit = (value: unknown): void => {
    if (isPoll(value)) { ids.add(value.id); return; }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const query of client.getQueryCache().findAll()) visit(query.state.data);
  await Promise.all([...ids].map((id) => reconcilePoll(client, id, viewerId, epoch)));
}
export function reconcilePollQueryData<T>(client: QueryClient, data: T, viewerId: string | null, expectedEpoch = pollSessionEpoch(client), startedGeneration = clientState(client).generation, allowLegacyViewerState = true): T {
  const visit = (value: unknown): unknown => {
    if (isPoll(value)) return ingestPoll(client, value, 'http', viewerId, expectedEpoch, startedGeneration, allowLegacyViewerState);
    if (Array.isArray(value)) return value.map(visit).filter((item) => item !== undefined);
    if (value && typeof value === 'object') {
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) { next[key] = visit(item); if (next[key] !== item) changed = true; }
      return changed ? next : value;
    }
    return value;
  };
  return visit(data) as T;
}
export async function fetchPollQuery<T>(client: QueryClient, viewerId: string | null, fetcher: () => Promise<T>, allowLegacyViewerState = true, signal?: AbortSignal): Promise<T> {
  const epoch = pollSessionEpoch(client);
  const startedGeneration = clientState(client).generation;
  const data = await fetcher();
  if (signal?.aborted || pollSessionEpoch(client) !== epoch) throw new CancelledError({ silent: true });
  return reconcilePollQueryData(client, data, viewerId, epoch, startedGeneration, allowLegacyViewerState);
}
export function beginPollOperation(client: QueryClient, pollId: string, action: 'vote' | 'like'): string | null {
  const state = clientState(client);
  const key = pollId + ':' + action;
  if (state.tombstones.has(pollId) || state.pending.has(key)) return null;
  state.generation += 1;
  state.pollGenerations.set(pollId, state.generation);
  const token = crypto.randomUUID();
  state.pending.set(key, token);
  return token;
}
export function finishPollOperation(client: QueryClient, pollId: string, action: 'vote' | 'like', token: string): void {
  const key = pollId + ':' + action;
  if (clientState(client).pending.get(key) === token) clientState(client).pending.delete(key);
}
export function isPollOperationPending(client: QueryClient, pollId: string, action: 'vote' | 'like'): boolean {
  return clientState(client).pending.has(pollId + ':' + action);
}
export function deleteCachedPoll(client: QueryClient, pollId: string): void {
  const state = clientState(client);
  state.tombstones.add(pollId); state.polls.delete(pollId);
  state.pending.delete(pollId + ':vote'); state.pending.delete(pollId + ':like');
  for (const query of client.getQueryCache().findAll()) {
    const remove = (value: unknown): unknown => {
      if (isPoll(value)) return value.id === pollId ? undefined : value;
      if (Array.isArray(value)) return value.map(remove).filter((item) => item !== undefined);
      if (value && typeof value === 'object') {
        const entries = Object.entries(value).map(([key, item]) => [key, remove(item)] as const);
        return Object.fromEntries(entries.filter(([, item]) => item !== undefined));
      }
      return value;
    };
    const next = remove(query.state.data);
    if (next !== query.state.data) client.setQueryData(query.queryKey, next);
  }
  client.removeQueries({ queryKey: ['poll', pollId], exact: true });
}
