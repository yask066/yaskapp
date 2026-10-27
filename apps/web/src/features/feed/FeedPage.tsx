import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useNavigationType } from 'react-router-dom';
import { listPollsPage, listSubscriptionsPage } from '../../api/polls';
import { ApiError } from '../../api/client';
import type { ClientCursorPage, Poll } from '../../api/models';
import { listPopularUsers } from '../../api/profiles';
import { useSession } from '../../app/session-provider';
import { AsyncState } from '../../components/AsyncState';
import { ContentEntryTransition } from '../../components/ContentEntryTransition';
import { Avatar } from '../../components/Avatar';
import { MaterialIcon } from '../../components/MaterialIcon';
import { usePollMutations } from '../polls/usePollMutations';
import { fetchPollQuery } from '../polls/poll-state';
import { useListScrollState } from '../../core/scroll/useListScrollState';
import { canAppend, followingGenerationQueryKey, mergePageIds, paginationQueryKey, paginationQueryOptions, type PaginationLoadTrigger, type PaginationState } from '../../core/pagination/pagination-state';
import { PaginationFooter } from '../../components/PaginationFooter';
import { FeedPollItem } from './FeedPollItem';
import { paginationAnalytics, resolvePaginationPageRequest } from '../../core/pagination/pagination-analytics';

type FeedSort = 'for-you' | 'following' | 'trending';
type FeedUiState = { pending: boolean; error: unknown | null; appendError: unknown | null };
const initialFeedUiState: FeedUiState = { pending: false, error: null, appendError: null };

function readFeedSort(key: string): FeedSort {
  try {
    const storedSort = sessionStorage.getItem(key);
    return storedSort === 'following' || storedSort === 'trending' || storedSort === 'for-you' ? storedSort : 'for-you';
  } catch {
    return 'for-you';
  }
}

const trends = [
  { topic: 'Programming', polls: '1.2K polls' },
  { topic: 'Lifestyle', polls: '980 polls' },
  { topic: 'Tech', polls: '784 polls' },
  { topic: 'Games', polls: '612 polls' },
  { topic: 'Education', polls: '590 polls' },
];
export function FeedPage() {
  const { status, user, sessionEpoch } = useSession();
  const viewerId = user?.id ?? null;
  const sortStorageKey = `feed-sort:${sessionEpoch}:${viewerId ?? 'anonymous'}`;
  const [sort, setSort] = useState<FeedSort>(() => readFeedSort(sortStorageKey));
  const sortStorageKeyRef = useRef(sortStorageKey);
  useEffect(() => {
    if (sortStorageKeyRef.current !== sortStorageKey) {
      sortStorageKeyRef.current = sortStorageKey;
      setSort(readFeedSort(sortStorageKey));
      return;
    }
    try { sessionStorage.setItem(sortStorageKey, sort); } catch { /* Storage may be unavailable in private contexts. */ }
  }, [sort, sortStorageKey]);
  const [trendsOpen, setTrendsOpen] = useState(true);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const mutations = usePollMutations();
  const { vote, toggleLike } = mutations;
  const onVote = useCallback((pollId: string, optionId: string) => vote({ pollId, optionId }), [vote]);
  const onLike = useCallback((pollId: string, viewerHasLiked: boolean) => toggleLike({ pollId, viewerHasLiked }), [toggleLike]);
  const onOpenComments = useCallback((openedPoll: Poll) => navigate(`/polls/${openedPoll.id}`), [navigate]);
  const followingGenerationKey = followingGenerationQueryKey(sessionEpoch, viewerId);
  const followingGenerationQuery = useQuery({
    queryKey: followingGenerationKey,
    queryFn: async () => 0,
    initialData: 0,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: status !== 'loading',
  });
  const feedQueryKey = sort === 'following'
    ? paginationQueryKey({ surface: 'subscriptions', sessionEpoch, userId: viewerId, followingGeneration: followingGenerationQuery.data })
    : paginationQueryKey({ surface: 'feed', sessionEpoch, userId: viewerId, sort: sort === 'trending' ? 'popular' : 'newest' });
  const feedRequestIdentity = JSON.stringify(feedQueryKey);
  const activeFeedRequestIdentity = useRef(feedRequestIdentity);
  activeFeedRequestIdentity.current = feedRequestIdentity;
  const refetchPageNumber = useRef(1);
  const pollsQuery = useInfiniteQuery({
    queryKey: feedQueryKey,
    queryFn: ({ pageParam, signal }) => {
      const cached = queryClient.getQueryData<InfiniteData<ClientCursorPage<Poll>, string | null>>(feedQueryKey);
      const queryState = queryClient.getQueryState(feedQueryKey);
      const isFetchingMore = queryState?.fetchMeta?.fetchMore !== undefined;
      const isRefetching = cached !== undefined && !isFetchingMore;
      const { pageNumber, kind } = resolvePaginationPageRequest(
        cached?.pageParams,
        pageParam,
        isFetchingMore,
        isRefetching,
        refetchPageNumber.current,
      );
      const surface = sort === 'following' ? 'subscriptions' : 'feed';
      const pageSort = sort === 'trending' ? 'popular' : 'newest';
      return paginationAnalytics.trackPageRequest<Poll, ClientCursorPage<Poll>>({
        surface,
        sort: pageSort,
        pageNumber,
        chainId: feedRequestIdentity,
        kind,
        cursor: pageParam,
        signal,
        isCurrent: () => !signal.aborted && activeFeedRequestIdentity.current === feedRequestIdentity,
        existingIds: kind === 'append' ? cached?.pages.flatMap((page) => page.items.map((poll) => poll.id)) ?? [] : [],
        getId: (poll) => poll.id,
      }, ({ requestId, action }) => fetchPollQuery(
        queryClient,
        viewerId,
        () => sort === 'following'
          ? listSubscriptionsPage({ cursor: pageParam ?? undefined, requestId, pageNumber, paginationAction: action }, signal)
          : listPollsPage({ sort: pageSort, cursor: pageParam ?? undefined, requestId, pageNumber, paginationAction: action }, signal),
        true,
        signal,
      )).then((page) => {
        if (kind === 'refetch' && !signal.aborted && activeFeedRequestIdentity.current === feedRequestIdentity) {
          refetchPageNumber.current = pageNumber + 1;
        }
        return page;
      });
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.paginationSupported ? lastPage.nextCursor ?? undefined : undefined,
    enabled: status !== 'loading' && (sort !== 'following' || status === 'authenticated'),
    staleTime: Infinity,
    ...paginationQueryOptions,
  });
  const queryIdentity = feedRequestIdentity;
  useEffect(() => () => paginationAnalytics.disposeChain(feedRequestIdentity), [feedRequestIdentity]);
  const feedUiStateKey = ['pagination', 'feed-ui-state', ...feedQueryKey] as const;
  const feedUiStateQuery = useQuery({
    queryKey: feedUiStateKey,
    queryFn: async () => initialFeedUiState,
    initialData: initialFeedUiState,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const refreshState = feedUiStateQuery.data;
  const updateFeedUiState = (state: Partial<FeedUiState>) => {
    queryClient.setQueryData<FeedUiState>(feedUiStateKey, (current) => ({ ...initialFeedUiState, ...current, ...state }));
  };
  const pageData = pollsQuery.data?.pages ?? [];
  const pollById = new Map(pageData.flatMap((page) => page.items).map((poll) => [poll.id, poll] as const));
  const polls = mergePageIds(pageData, (item) => item.id).map((pollId) => pollById.get(pollId)!);
  const automaticLoadCounts = useRef(new Map<string, number>());
  const activeAppendRequests = useRef(new Set<string>());
  const activeRefreshRequests = useRef(new Set<string>());
  const activeRefreshControllers = useRef(new Map<string, AbortController>());
  const currentSessionIdentity = useRef({ sessionEpoch, viewerId });
  currentSessionIdentity.current = { sessionEpoch, viewerId };
  useEffect(() => () => {
    for (const controller of activeRefreshControllers.current.values()) controller.abort();
    activeRefreshControllers.current.clear();
    activeRefreshRequests.current.clear();
  }, [sessionEpoch, viewerId]);
  const lastPage = pageData.at(-1);
  const paginationState: PaginationState = {
    generation: 0,
    sessionEpoch,
    userId: viewerId,
    followingGeneration: sort === 'following' ? followingGenerationQuery.data : 0,
    nextCursor: lastPage?.paginationSupported ? lastPage.nextCursor : null,
    cursorHistory: pollsQuery.data?.pageParams.filter((cursor): cursor is string => typeof cursor === 'string') ?? [],
    paginationSupported: lastPage?.paginationSupported ?? false,
    automaticLoadCount: automaticLoadCounts.current.get(queryIdentity) ?? 0,
    pending: refreshState.pending
      ? { kind: 'refresh', cursor: null }
      : pollsQuery.isFetchingNextPage ? { kind: 'append', cursor: lastPage?.nextCursor ?? null } : null,
    appendError: pollsQuery.isFetchNextPageError || Boolean(refreshState.appendError),
  };
  const repeatedCursor = paginationState.nextCursor !== null && paginationState.cursorHistory.includes(paginationState.nextCursor);
  const appendError = refreshState.appendError instanceof Error ? refreshState.appendError : pollsQuery.error;
  const popularSnapshotExpired = sort === 'trending' && appendError instanceof ApiError &&
    appendError.status === 410 && appendError.code === 'pagination_expired';
  const loadMore = (trigger: PaginationLoadTrigger) => {
    const cursor = paginationState.nextCursor;
    if (!canAppend(paginationState, trigger) || cursor === null) return;
    const requestKey = `${queryIdentity}:${cursor}`;
    if (activeAppendRequests.current.has(requestKey)) {
      if (pollsQuery.isFetchingNextPage) return;
      activeAppendRequests.current.delete(requestKey);
    }
    activeAppendRequests.current.add(requestKey);
    automaticLoadCounts.current.set(queryIdentity, trigger === 'automatic' ? paginationState.automaticLoadCount + 1 : 0);
    if (trigger === 'manual') updateFeedUiState({ appendError: null });
    void pollsQuery.fetchNextPage({ cancelRefetch: false }).then((result) => {
      updateFeedUiState({ appendError: result.isFetchNextPageError ? result.error : null });
    }).finally(() => activeAppendRequests.current.delete(requestKey));
  };
  const refreshFeed = async () => {
    if ((sort === 'following' && status !== 'authenticated') || activeRefreshRequests.current.has(queryIdentity)) return;
    activeRefreshRequests.current.add(queryIdentity);
    const controller = new AbortController();
    activeRefreshControllers.current.set(queryIdentity, controller);
    const requestEpoch = sessionEpoch;
    const requestViewerId = viewerId;
    updateFeedUiState({ pending: true, error: null });
    try {
      await queryClient.cancelQueries({ queryKey: feedQueryKey, exact: true });
      const page = await paginationAnalytics.trackPageRequest<Poll, ClientCursorPage<Poll>>({
        surface: sort === 'following' ? 'subscriptions' : 'feed',
        sort: sort === 'trending' ? 'popular' : 'newest',
        pageNumber: 1,
        chainId: queryIdentity,
        kind: 'refresh',
        cursor: null,
        signal: controller.signal,
        isCurrent: () => !controller.signal.aborted && activeFeedRequestIdentity.current === queryIdentity && currentSessionIdentity.current.sessionEpoch === requestEpoch && currentSessionIdentity.current.viewerId === requestViewerId,
        existingIds: pollsQuery.data?.pages.flatMap((cachedPage) => cachedPage.items.map((poll) => poll.id)) ?? [],
        getId: (poll) => poll.id,
      }, ({ requestId, action }) => fetchPollQuery(
        queryClient,
        viewerId,
        () => sort === 'following'
          ? listSubscriptionsPage({ requestId, pageNumber: 1, paginationAction: action }, controller.signal)
          : listPollsPage({ sort: sort === 'trending' ? 'popular' : 'newest', requestId, pageNumber: 1, paginationAction: action }, controller.signal),
        true,
        controller.signal,
      ));
      if (controller.signal.aborted || currentSessionIdentity.current.sessionEpoch !== requestEpoch || currentSessionIdentity.current.viewerId !== requestViewerId) return;
      queryClient.setQueryData<InfiniteData<ClientCursorPage<Poll>, string | null>>(feedQueryKey, {
        pages: [page],
        pageParams: [null],
      });
      automaticLoadCounts.current.set(queryIdentity, 0);
      updateFeedUiState({ pending: false, error: null, appendError: null });
    } catch (error) {
      if (!controller.signal.aborted && currentSessionIdentity.current.sessionEpoch === requestEpoch && currentSessionIdentity.current.viewerId === requestViewerId) {
        updateFeedUiState({ pending: false, error });
      }
    } finally {
      activeRefreshRequests.current.delete(queryIdentity);
      activeRefreshControllers.current.delete(queryIdentity);
      if (currentSessionIdentity.current.sessionEpoch === requestEpoch && currentSessionIdentity.current.viewerId === requestViewerId) {
        updateFeedUiState({ pending: false });
      }
    }
  };
  const feedScroll = useListScrollState(
    { userId: viewerId, route: '/', list: 'feed', query: '', filter: '', sort },
    { itemIds: polls.map((poll) => poll.id), restoreFocusOnPop: navigationType === 'POP' },
  );
  const feedEntryContext = `feed:${sessionEpoch}:${user?.id ?? 'anonymous'}:${sort}`;
  const suggestedUsersQuery = useQuery({ queryKey: ['popular-users'], queryFn: ({ signal }) => listPopularUsers(3, signal), enabled: status === 'authenticated' });
  const suggestedUsers = suggestedUsersQuery.data?.filter((person) => person.id !== user?.id && !person.viewerIsFollowing) ?? [];
  return <main id="main-content" className="feed-page">
    <section className="feed-main" aria-label="Poll feed">
      <header className="page-heading feed-heading"><div><p className="eyebrow">Latest conversations</p><h1>Your feed</h1></div><div className="feed-heading__actions"><button className="button" type="button" disabled={refreshState.pending || (sort === 'following' && status !== 'authenticated')} onClick={() => void refreshFeed()}>{refreshState.pending ? 'Refreshing…' : 'Refresh feed'}</button><Link className="button button--primary" to="/polls/new"><MaterialIcon name="add" /> Create poll</Link></div></header>
      <section className="feed-toolbar" aria-label="Create and filter polls"><section className="poll-composer" aria-label="Create a poll"><div className="composer-avatar">{user?.profile.displayName.slice(0, 1).toUpperCase() ?? 'Y'}</div><p>What's on your mind today?</p><Link className="create-poll-link" to="/polls/new"><MaterialIcon name="add" /> Post</Link><div className="composer-actions"><span><MaterialIcon name="image" /> Image</span><span><MaterialIcon name="poll" /> Poll</span><span><MaterialIcon name="gif" /> GIF</span></div></section><div className="segmented-tabs feed-tabs" aria-label="Feed order"><button type="button" aria-pressed={sort === 'for-you'} onClick={() => setSort('for-you')}>For you</button><button type="button" aria-pressed={sort === 'following'} onClick={() => setSort('following')}>Following</button><button type="button" aria-pressed={sort === 'trending'} onClick={() => setSort('trending')}>Trending</button></div></section>
      {sort === 'following' && status !== 'authenticated' ? <p className="feed-following-guest">Sign in to see polls from people you follow. <Link to={`/login?next=${encodeURIComponent('/')}`}>Sign in</Link></p> : null}
      {pollsQuery.isError && !pollsQuery.data ? <AsyncState state="error" error={pollsQuery.error} onRetry={() => void pollsQuery.refetch()} /> : null}{refreshState.error ? <p role="alert">{refreshState.error instanceof Error ? refreshState.error.message : 'Could not refresh polls.'}</p> : null}{pollsQuery.data && polls.length === 0 ? <AsyncState state="empty" emptyMessage="No polls to show yet." /> : null}{mutations.error ? <p aria-live="polite">{mutations.error}</p> : null}
      <ContentEntryTransition loading={pollsQuery.isPending && !pollsQuery.data} kind="poll" rows={2}>
      <div className="feed-list" ref={feedScroll.listRef} aria-busy={pollsQuery.isFetching || refreshState.pending}>{polls.map((poll, index) => <FeedPollItem key={poll.id} poll={poll} contextKey={feedEntryContext} indexInBatch={index} viewerId={user?.id} isVoting={mutations.isVoting(poll.id)} isLiking={mutations.isLiking(poll.id)} onVote={user ? onVote : undefined} onCancelVote={user ? mutations.cancelVote : undefined} onLike={user ? onLike : undefined} onDelete={user ? mutations.deletePoll : undefined} onOpenComments={onOpenComments} />)}</div>
      </ContentEntryTransition>{pollsQuery.data ? <PaginationFooter
        hasNextPage={Boolean(pollsQuery.hasNextPage)}
        isFetchingNextPage={pollsQuery.isFetchingNextPage}
        isRefreshing={refreshState.pending}
        isFetchNextPageError={pollsQuery.isFetchNextPageError || Boolean(refreshState.appendError)}
        paginationSupported={lastPage?.paginationSupported ?? false}
        automaticLoadEnabled={canAppend(paginationState, 'automatic')}
        repeatedCursor={repeatedCursor}
        expired={popularSnapshotExpired}
        error={appendError}
        onRefresh={() => void refreshFeed()}
        onLoadMore={loadMore}
      /> : null}{pollsQuery.isError && pollsQuery.data && !pollsQuery.isFetchNextPageError ? <AsyncState state="error" error={pollsQuery.error} onRetry={() => void pollsQuery.refetch()} /> : null}{(pollsQuery.isFetching && pollsQuery.data && !pollsQuery.isFetchingNextPage) || refreshState.pending ? <AsyncState state="refreshing" kind="poll" /> : null}</section>
    <aside className="feed-sidebar context-rail" aria-label="Discover content"><section className="context-panel discovery-card trends-card"><header className="discovery-heading"><h2><MaterialIcon name="fire" /> Trending today</h2></header><button className="trends-toggle" type="button" aria-expanded={trendsOpen} aria-controls="trends-list" onClick={() => setTrendsOpen((open) => !open)}>Toggle trending topics</button>{trendsOpen ? <ul id="trends-list">{trends.map((trend, index) => <li key={trend.topic}><a href={`/?topic=${trend.topic}`}><span>{index + 1}</span><div><strong>{trend.topic}</strong><small>{trend.polls}</small></div></a></li>)}</ul> : null}</section><section className="context-panel discovery-card suggested-users"><header className="discovery-heading"><h2>Who to follow</h2><a className="show-more" href="/search">See all</a></header><ul>{suggestedUsersQuery.isFetching && !suggestedUsersQuery.data ? <li><AsyncState state="loading" kind="user" rows={2} /></li> : null}{suggestedUsersQuery.isError ? <li><AsyncState state="error" kind="user" error={suggestedUsersQuery.error} onRetry={() => void suggestedUsersQuery.refetch()} /></li> : null}{suggestedUsers.map((person) => <li key={person.id}><Link to={`/users/${person.id}`}><Avatar name={person.profile.displayName || person.username} src={person.profile.avatarUrl} size={40} /></Link><p><Link to={`/users/${person.id}`}><strong>{person.profile.displayName || person.username}</strong></Link><small>@{person.username}</small></p><button type="button">Follow</button></li>)}</ul></section><footer className="sidebar-links"><div><a href="/">About</a><a href="/">Help</a><a href="/">Privacy</a><a href="/">Terms</a></div><p>© {new Date().getFullYear()} Yask. All rights reserved.</p></footer></aside>
  </main>;
}
