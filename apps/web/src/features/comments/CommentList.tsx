import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useNavigationType } from 'react-router-dom';
import { deleteComment, likeComment, listCommentsPage, unlikeComment } from '../../api/polls';
import type { ClientCursorPage, Poll, PollComment } from '../../api/models';
import { mutationErrorMessage } from '../polls/usePollMutations';
import { commentScrollBehavior } from './comment-scroll';
import { CommentThread } from './CommentThread';
import { useListScrollState } from '../../core/scroll/useListScrollState';
import { AsyncState } from '../../components/AsyncState';
import { EntryMotion } from '../../core/motion/EntryMotion';
import { ContentEntryTransition } from '../../components/ContentEntryTransition';
import { focusRetryLandmark } from '../../components/focusRetryLandmark';
import {
  canAppend,
  mergePageIds,
  paginationQueryKey,
  paginationQueryOptions,
  type PaginationLoadTrigger,
  type PaginationState,
} from '../../core/pagination/pagination-state';
import { PaginationFooter } from '../../components/PaginationFooter';

type CommentPages = InfiniteData<ClientCursorPage<PollComment>, string | null>;

interface CommentListProps {
  pollId: string;
  sessionEpoch?: number;
  sessionReady?: boolean;
  currentUserId?: string | null;
  focusedCommentId?: string | null;
  focusedReplyId?: string | null;
  forcedExpandedRootId?: string | null;
  resolvedRootComment?: PollComment;
  onReplyCreated?: (poll: Poll) => void;
}

function updateCommentPages(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: ReturnType<typeof paginationQueryKey>,
  update: (comment: PollComment) => PollComment | null,
) {
  queryClient.setQueryData<CommentPages>(queryKey, (cached) => cached ? {
    pages: cached.pages.map((page) => ({
      ...page,
      items: page.items.flatMap((comment) => {
        const updated = update(comment);
        return updated ? [updated] : [];
      }),
    })),
    pageParams: cached.pageParams,
  } : cached);
}

export function CommentList({
  pollId,
  sessionEpoch = 0,
  sessionReady = true,
  currentUserId,
  focusedCommentId,
  focusedReplyId,
  forcedExpandedRootId,
  resolvedRootComment,
  onReplyCreated,
}: CommentListProps) {
  const queryClient = useQueryClient();
  const queryKey = paginationQueryKey({
    surface: 'comments', sessionEpoch, userId: currentUserId ?? null, pollId,
  });
  const queryIdentity = JSON.stringify(queryKey);
  const commentsQuery = useInfiniteQuery({
    queryKey,
    ...paginationQueryOptions,
    queryFn: ({ pageParam, signal }) => listCommentsPage(pollId, { cursor: pageParam ?? undefined, order: 'newest' }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.paginationSupported ? lastPage.nextCursor ?? undefined : undefined,
    enabled: sessionReady,
  });
  const likeMutation = useMutation({
    mutationFn: (comment: PollComment) => comment.viewerHasLiked ? unlikeComment(pollId, comment.id) : likeComment(pollId, comment.id),
    onSuccess: (comment) => updateCommentPages(queryClient, queryKey, (item) => item.id === comment.id ? comment : item),
  });
  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deleteComment(pollId, commentId),
    onSuccess: (_, commentId) => {
      updateCommentPages(queryClient, queryKey, (comment) => comment.id === commentId ? null : comment);
      return queryClient.invalidateQueries({ queryKey: ['poll', pollId] });
    },
  });
  const focusedCommentRef = useRef<HTMLLIElement | null>(null);
  const navigationType = useNavigationType();
  const focusRootId = focusedReplyId ? forcedExpandedRootId : focusedCommentId;
  const pageData = commentsQuery.data?.pages ?? [];
  const commentById = useMemo(
    () => new Map(pageData.flatMap((page) => page.items).map((comment) => [comment.id, comment] as const)),
    [pageData],
  );
  const comments = mergePageIds(pageData, (comment) => comment.id)
    .map((commentId) => commentById.get(commentId)!)
    .filter(Boolean);
  const visibleComments = resolvedRootComment && !comments.some((comment) => comment.id === resolvedRootComment.id)
    ? [resolvedRootComment, ...comments]
    : comments;
  const commentScroll = useListScrollState(
    { userId: currentUserId ?? null, route: `/polls/${pollId}`, list: 'comments', query: focusedCommentId ?? focusedReplyId ?? '', filter: '', sort: '' },
    { itemIds: visibleComments.map((comment) => comment.id), priority: focusedCommentId || focusedReplyId ? 'explicit-target' : null, restoreFocusOnPop: navigationType === 'POP' },
  );
  const [refreshState, setRefreshState] = useState<{ identity: string; pending: boolean; error: unknown | null }>({
    identity: '', pending: false, error: null,
  });
  const currentRefreshState = refreshState.identity === queryIdentity ? refreshState : { identity: queryIdentity, pending: false, error: null };
  const [replyGenerationState, setReplyGenerationState] = useState({ identity: queryIdentity, value: 0 });
  const replyGeneration = replyGenerationState.identity === queryIdentity ? replyGenerationState.value : 0;
  const currentIdentity = useRef(queryIdentity);
  currentIdentity.current = queryIdentity;
  const refreshGeneration = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const activeAppendRequests = useRef(new Set<string>());
  const automaticLoadCounts = useRef(new Map<string, number>());

  useEffect(() => () => {
    refreshController.current?.abort();
    refreshController.current = null;
    activeAppendRequests.current.clear();
  }, [queryIdentity]);

  useEffect(() => {
    if (!focusRootId || !commentsQuery.data) return;
    const target = focusedCommentRef.current;
    if (!target) return;
    if (!focusedReplyId) target.focus();
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    target.scrollIntoView?.({ block: 'center', behavior: commentScrollBehavior(prefersReducedMotion) });
  }, [commentsQuery.data, focusRootId, focusedReplyId]);

  const lastPage = pageData.at(-1);
  const nextCursor = lastPage?.paginationSupported ? lastPage.nextCursor : null;
  const paginationState: PaginationState = {
    generation: replyGeneration,
    sessionEpoch,
    userId: currentUserId ?? null,
    followingGeneration: 0,
    nextCursor: nextCursor ?? null,
    cursorHistory: commentsQuery.data?.pageParams.filter((cursor): cursor is string => typeof cursor === 'string') ?? [],
    paginationSupported: lastPage?.paginationSupported ?? false,
    automaticLoadCount: automaticLoadCounts.current.get(queryIdentity) ?? 0,
    pending: currentRefreshState.pending
      ? { kind: 'refresh', cursor: null }
      : commentsQuery.isFetchingNextPage ? { kind: 'append', cursor: nextCursor ?? null } : null,
    appendError: commentsQuery.isFetchNextPageError,
  };
  const repeatedCursor = paginationState.nextCursor !== null && paginationState.cursorHistory.includes(paginationState.nextCursor);

  function loadMore(trigger: PaginationLoadTrigger) {
    const cursor = paginationState.nextCursor;
    if (!canAppend(paginationState, trigger) || cursor === null) return;
    const requestKey = `${queryIdentity}:${cursor}`;
    if (activeAppendRequests.current.has(requestKey)) {
      if (commentsQuery.isFetchingNextPage) return;
      activeAppendRequests.current.delete(requestKey);
    }
    activeAppendRequests.current.add(requestKey);
    automaticLoadCounts.current.set(queryIdentity, trigger === 'automatic' ? paginationState.automaticLoadCount + 1 : 0);
    void commentsQuery.fetchNextPage({ cancelRefetch: false }).finally(() => activeAppendRequests.current.delete(requestKey));
  }

  async function refreshComments() {
    if (refreshController.current) return;
    const requestIdentity = queryIdentity;
    const requestGeneration = ++refreshGeneration.current;
    const controller = new AbortController();
    refreshController.current = controller;
    setRefreshState({ identity: requestIdentity, pending: true, error: null });
    try {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const page = await listCommentsPage(pollId, { order: 'newest' }, controller.signal);
      if (controller.signal.aborted || currentIdentity.current !== requestIdentity || refreshGeneration.current !== requestGeneration) return;
      queryClient.setQueryData<CommentPages>(queryKey, { pages: [page], pageParams: [null] });
      automaticLoadCounts.current.set(requestIdentity, 0);
      setReplyGenerationState((current) => ({
        identity: requestIdentity,
        value: current.identity === requestIdentity ? current.value + 1 : 1,
      }));
      setRefreshState({ identity: requestIdentity, pending: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted && currentIdentity.current === requestIdentity && refreshGeneration.current === requestGeneration) {
        setRefreshState({ identity: requestIdentity, pending: false, error });
      }
    } finally {
      if (refreshController.current === controller) refreshController.current = null;
    }
  }

  const writeError = likeMutation.error ?? deleteMutation.error;

  function handleReplyCreated(rootComment: PollComment, _reply: PollComment, poll: Poll) {
    updateCommentPages(queryClient, queryKey, (comment) => comment.id === rootComment.id
      ? { ...comment, repliesCount: comment.repliesCount + 1 }
      : comment);
    onReplyCreated?.(poll);
  }

  return (
    <div className="comment-list" ref={commentScroll.listRef} aria-busy={commentsQuery.isFetching || currentRefreshState.pending}>
      <div className="comment-list__actions">
        <button className="button" type="button" disabled={!sessionReady || currentRefreshState.pending} onClick={() => void refreshComments()}>
          {currentRefreshState.pending ? 'Refreshing comments…' : currentRefreshState.error ? 'Retry refresh' : 'Refresh comments'}
        </button>
      </div>
      {writeError ? <p role="alert">{mutationErrorMessage(writeError)}</p> : null}
      {currentRefreshState.error ? <p role="alert">{mutationErrorMessage(currentRefreshState.error)}</p> : null}
      <ContentEntryTransition loading={commentsQuery.isPending && !commentsQuery.data} kind="comment" rows={2}>
      {visibleComments.length ? <ul>
        {visibleComments.map((comment, index) => <EntryMotion key={comment.id} contextKey={`comments:${sessionEpoch}:${currentUserId ?? 'anonymous'}:${pollId}`} itemId={comment.id} visible indexInBatch={index}>
          <li className={`comment-card${comment.id === focusRootId && !focusedReplyId ? ' comment-card--focused' : ''}`} data-list-item-id={comment.id} ref={comment.id === focusRootId ? focusedCommentRef : undefined} tabIndex={-1} aria-current={comment.id === focusRootId && !focusedReplyId ? 'location' : undefined}>
          <p className="comment-card__author"><strong>{comment.author.displayName || comment.author.username}</strong> <span>@{comment.author.username}</span></p>
          <p className="comment-card__body">{comment.body}</p>
          <div className="comment-card__actions">{currentUserId ? <button className="button" type="button" aria-pressed={comment.viewerHasLiked} onClick={() => likeMutation.mutate(comment)}>Like ({comment.likesCount})</button> : null}{comment.author.id === currentUserId ? <button className="button" type="button" onClick={() => { if (window.confirm('Delete this comment?')) deleteMutation.mutate(comment.id); }}>Delete</button> : null}</div>
          <CommentThread
            pollId={pollId}
            sessionEpoch={sessionEpoch}
            sessionReady={sessionReady}
            rootComment={comment}
            currentUserId={currentUserId}
            focusedReplyId={comment.id === forcedExpandedRootId ? focusedReplyId : null}
            autoExpand={comment.id === forcedExpandedRootId}
            refreshGeneration={replyGeneration}
            onReplyCreated={(reply, poll) => handleReplyCreated(comment, reply, poll)}
          />
          </li>
        </EntryMotion>)}
      </ul> : commentsQuery.isPending || (commentsQuery.isError && !commentsQuery.data) ? null : <p>No comments yet.</p>}
      </ContentEntryTransition>
      {commentsQuery.isError && !commentsQuery.data ? <div role="alert"><p>{mutationErrorMessage(commentsQuery.error)}</p><button type="button" onClick={(event) => { focusRetryLandmark(event.currentTarget); void commentsQuery.refetch(); }}>Retry loading comments</button></div> : null}
      {commentsQuery.isError && commentsQuery.data && !commentsQuery.isFetchNextPageError ? <div role="alert" className="async-state async-state--error"><p>{mutationErrorMessage(commentsQuery.error)}</p><button type="button" onClick={(event) => { focusRetryLandmark(event.currentTarget); void commentsQuery.refetch(); }}>Retry loading comments</button></div> : null}
      {commentsQuery.data ? <PaginationFooter
        hasNextPage={Boolean(commentsQuery.hasNextPage)}
        isFetchingNextPage={commentsQuery.isFetchingNextPage}
        isRefreshing={currentRefreshState.pending}
        isFetchNextPageError={commentsQuery.isFetchNextPageError}
        paginationSupported={lastPage?.paginationSupported ?? false}
        automaticLoadEnabled={canAppend(paginationState, 'automatic')}
        repeatedCursor={repeatedCursor}
        error={commentsQuery.error}
        itemName="comments"
        refreshLabel="comments"
        onLoadMore={loadMore}
      /> : null}
      {(commentsQuery.isFetching && commentsQuery.data && !commentsQuery.isFetchingNextPage) || currentRefreshState.pending
        ? <AsyncState state="refreshing" kind="comment" /> : null}
    </div>
  );
}
