import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useMutationState, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useNavigationType } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { deleteComment, likeComment, listCommentsPage, unlikeComment } from '../../api/polls';
import type { ClientCursorPage, Poll, PollComment } from '../../api/models';
import { isAmbiguousMutationError, mutationErrorMessage } from '../polls/usePollMutations';
import { pollSessionEpoch, reconcilePoll } from '../polls/poll-state';
import { commentScrollBehavior } from './comment-scroll';
import { CommentThread } from './CommentThread';
import { useListScrollState } from '../../core/scroll/useListScrollState';
import { AsyncState } from '../../components/AsyncState';
import { EntryMotion } from '../../core/motion/EntryMotion';
import { ContentEntryTransition } from '../../components/ContentEntryTransition';
import { focusRetryLandmark } from '../../components/focusRetryLandmark';
import { isFeedPaginationEnabled } from '../../core/pagination/feed-pagination-flag';
import {
  canAppend,
  mergePageIds,
  paginationQueryKey,
  paginationQueryOptions,
  type PaginationLoadTrigger,
  type PaginationState,
} from '../../core/pagination/pagination-state';
import { PaginationFooter } from '../../components/PaginationFooter';
import { paginationAnalytics, resolvePaginationPageRequest } from '../../core/pagination/pagination-analytics';
import {
  applyCommentReaction,
  commentReactionRevision,
  commentMutationQueryKey,
  deleteCommentFromCache,
  invalidateCommentPages,
  isCommentHidden,
  reconcileCommentPage,
  reconcileCommentPageCache,
  useCommentOverlayState,
} from './comment-state';

type CommentPages = InfiniteData<ClientCursorPage<PollComment>, string | null>;

export interface CommentTargetState {
  comment?: PollComment;
  root?: PollComment;
  isPending: boolean;
  error: unknown;
  retry: () => void;
  rootIsPending: boolean;
  rootError: unknown;
  retryRoot: () => void;
}

interface CommentListProps {
  pollId: string;
  sessionEpoch?: number;
  sessionReady?: boolean;
  currentUserId?: string | null;
  focusedCommentId?: string | null;
  focusedReplyId?: string | null;
  forcedExpandedRootId?: string | null;
  resolvedRootComment?: PollComment;
  target?: CommentTargetState;
  onReplyCreated?: (poll: Poll) => void;
}

interface CommentRootItemProps {
  comment: PollComment;
  pollId: string;
  sessionEpoch: number;
  sessionReady: boolean;
  currentUserId?: string | null;
  isLiking: boolean;
  isDeleting: boolean;
  indexInBatch: number;
  contextKey: string;
  isFocusedRoot: boolean;
  focusedReplyId?: string | null;
  forcedExpandedRootId?: string | null;
  replyGeneration: number;
  contextReply?: PollComment;
  focusedTargetRef?: (node: HTMLLIElement | null) => void;
  onLike: (comment: PollComment) => void;
  onDelete: (comment: PollComment) => void;
  onReplyCreated?: (reply: PollComment, poll: Poll) => void;
}

const CommentRootItem = memo(function CommentRootItem({
  comment,
  pollId,
  sessionEpoch,
  sessionReady,
  currentUserId,
  isLiking,
  isDeleting,
  indexInBatch,
  contextKey,
  isFocusedRoot,
  focusedReplyId,
  forcedExpandedRootId,
  replyGeneration,
  contextReply,
  focusedTargetRef,
  onLike,
  onDelete,
  onReplyCreated,
}: CommentRootItemProps) {
  const isTargetReplyRoot = Boolean(focusedReplyId && comment.id === forcedExpandedRootId && contextReply?.parentCommentId === comment.id);
  return <EntryMotion key={comment.id} contextKey={contextKey} itemId={comment.id} visible indexInBatch={indexInBatch}>
    <li className={`comment-card${isFocusedRoot ? ' comment-card--focused' : ''}`} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 150px' }} data-list-item-id={comment.id} ref={isFocusedRoot ? focusedTargetRef : undefined} tabIndex={-1} aria-current={isFocusedRoot ? 'location' : undefined}>
      <p className="comment-card__author"><strong>{comment.author.displayName || comment.author.username}</strong> <span>@{comment.author.username}</span></p>
      <p className="comment-card__body">{comment.body}</p>
      <div className="comment-card__actions">
        {currentUserId ? <button className="button" type="button" disabled={isLiking} aria-pressed={comment.viewerHasLiked} onClick={() => onLike(comment)}>Like ({comment.likesCount})</button> : null}
        {comment.author.id === currentUserId ? <button className="button" type="button" disabled={isDeleting} onClick={() => onDelete(comment)}>Delete</button> : null}
      </div>
      <CommentThread
        pollId={pollId}
        sessionEpoch={sessionEpoch}
        sessionReady={sessionReady}
        rootComment={comment}
        currentUserId={currentUserId}
        focusedReplyId={isTargetReplyRoot ? focusedReplyId : null}
        contextReply={isTargetReplyRoot ? contextReply : undefined}
        focusedTargetRef={isTargetReplyRoot ? focusedTargetRef : undefined}
        autoExpand={comment.id === forcedExpandedRootId}
        refreshGeneration={replyGeneration}
        onReplyCreated={onReplyCreated}
      />
    </li>
  </EntryMotion>;
});

function linkedCommentErrorMessage(error: unknown, isParent = false): string {
  if (error instanceof ApiError && error.status === 404) {
    return isParent ? 'The parent comment is unavailable or may have been removed.' : 'This comment is unavailable or may have been removed.';
  }
  return isParent ? 'Could not load the parent comment from this link.' : 'Could not load this comment from the link.';
}

function isPermanentTargetError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
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
  target,
  onReplyCreated,
}: CommentListProps) {
  const paginationEnabled = isFeedPaginationEnabled();
  const queryClient = useQueryClient();
  const commentScope = useMemo(() => ({ sessionEpoch, userId: currentUserId ?? null, pollId }), [sessionEpoch, currentUserId, pollId]);
  const queryKey = useMemo(() => paginationQueryKey({
    surface: 'comments', sessionEpoch, userId: currentUserId ?? null, pollId,
  }), [sessionEpoch, currentUserId, pollId]);
  const commentOverlays = useCommentOverlayState(commentScope);
  const queryIdentity = JSON.stringify(queryKey);
  const currentIdentity = useRef(queryIdentity);
  currentIdentity.current = queryIdentity;
  useEffect(() => () => paginationAnalytics.disposeChain(queryIdentity), [queryIdentity]);
  const refetchPageNumber = useRef(1);
  const replyGenerationKey = [...queryKey, 'reply-generation'] as const;
  const replyGenerationQuery = useQuery({
    queryKey: replyGenerationKey,
    queryFn: () => 0,
    initialData: 0,
    staleTime: Infinity,
  });
  const commentsQuery = useInfiniteQuery({
    queryKey,
    ...paginationQueryOptions,
    queryFn: async ({ pageParam, signal }) => {
      const reactionRevision = commentReactionRevision(queryClient, commentScope);
      const cached = queryClient.getQueryData<CommentPages>(queryKey);
      const queryState = queryClient.getQueryState(queryKey);
      const isFetchingMore = queryState?.fetchMeta?.fetchMore !== undefined;
      const isRefetching = cached !== undefined && !isFetchingMore;
      const { pageNumber, kind } = resolvePaginationPageRequest(
        cached?.pageParams,
        pageParam,
        isFetchingMore,
        isRefetching,
        refetchPageNumber.current,
      );
      const page = await paginationAnalytics.trackPageRequest<PollComment, ClientCursorPage<PollComment>>({
        surface: 'comments',
        sort: 'newest',
        pageNumber,
        chainId: queryIdentity,
        kind,
        cursor: pageParam,
        signal,
        isCurrent: () => !signal.aborted && currentIdentity.current === queryIdentity,
        existingIds: kind === 'append' ? cached?.pages.flatMap((entry) => entry.items.map((comment) => comment.id)) ?? [] : [],
        getId: (comment) => comment.id,
      }, ({ requestId, action }) => listCommentsPage(
        pollId,
        { cursor: pageParam ?? undefined, order: 'newest', requestId, pageNumber, paginationAction: action },
        signal,
      ));
      if (kind === 'refetch' && !signal.aborted && currentIdentity.current === queryIdentity) {
        refetchPageNumber.current = pageNumber + 1;
      }
      return reconcileCommentPage(queryClient, commentScope, page, reactionRevision);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => paginationEnabled && lastPage.paginationSupported ? lastPage.nextCursor ?? undefined : undefined,
    enabled: sessionReady,
  });
  const likeMutationKey = commentMutationQueryKey(commentScope, 'like');
  const deleteMutationKey = commentMutationQueryKey(commentScope, 'delete');
  const pendingLikeIds = useMutationState({
    filters: { mutationKey: likeMutationKey, exact: true, status: 'pending' },
    select: (mutation) => (mutation.state.variables as { comment: PollComment }).comment.id,
  });
  const pendingDeleteIds = useMutationState({
    filters: { mutationKey: deleteMutationKey, exact: true, status: 'pending' },
    select: (mutation) => (mutation.state.variables as { comment: PollComment }).comment.id,
  });
  const likeMutation = useMutation({
    mutationKey: likeMutationKey,
    mutationFn: ({ comment }: { comment: PollComment; epoch: number }) => comment.viewerHasLiked ? unlikeComment(pollId, comment.id) : likeComment(pollId, comment.id),
    onSuccess: (comment, request) => {
      if (pollSessionEpoch(queryClient) === request.epoch) applyCommentReaction(queryClient, commentScope, comment);
    },
    onError: (error, request) => {
      if (pollSessionEpoch(queryClient) === request.epoch && isAmbiguousMutationError(error)) void invalidateCommentPages(queryClient, commentScope);
    },
  });
  const deleteMutation = useMutation({
    mutationKey: deleteMutationKey,
    mutationFn: ({ comment }: { comment: PollComment; epoch: number }) => deleteComment(pollId, comment.id),
    onSuccess: (_, request) => {
      if (pollSessionEpoch(queryClient) !== request.epoch) return;
      deleteCommentFromCache(queryClient, commentScope, request.comment);
      void reconcilePoll(queryClient, pollId, currentUserId ?? null, request.epoch);
    },
    onError: (error, request) => {
      if (pollSessionEpoch(queryClient) !== request.epoch || !isAmbiguousMutationError(error)) return;
      void reconcilePoll(queryClient, pollId, currentUserId ?? null, request.epoch);
      void invalidateCommentPages(queryClient, commentScope);
    },
  });
  const mutateRootLike = likeMutation.mutate;
  const handleRootLike = useCallback((comment: PollComment) => {
    mutateRootLike({ comment, epoch: pollSessionEpoch(queryClient) });
  }, [mutateRootLike, queryClient]);
  const mutateRootDelete = deleteMutation.mutate;
  const handleRootDelete = useCallback((comment: PollComment) => {
    if (window.confirm('Delete this comment?')) mutateRootDelete({ comment, epoch: pollSessionEpoch(queryClient) });
  }, [mutateRootDelete, queryClient]);
  const [focusedTargetNode, setFocusedTargetNode] = useState<HTMLLIElement | null>(null);
  const navigationType = useNavigationType();
  const focusRootId = focusedReplyId ? forcedExpandedRootId : focusedCommentId;
  const targetFocusKey = focusedReplyId ?? focusedCommentId ?? null;
  const didFocusTarget = useRef({ key: targetFocusKey, focused: false });
  if (didFocusTarget.current.key !== targetFocusKey) didFocusTarget.current = { key: targetFocusKey, focused: false };
  const pageData = useMemo(() => commentsQuery.data?.pages ?? [], [commentsQuery.data?.pages]);
  const commentById = useMemo(
    () => new Map(pageData.flatMap((page) => page.items).map((comment) => [comment.id, comment] as const)),
    [pageData],
  );
  const comments = mergePageIds(pageData, (comment) => comment.id)
    .map((commentId) => commentById.get(commentId)!)
    .filter((comment): comment is PollComment => comment !== undefined && !isCommentHidden(commentOverlays, comment));
  const targetAlreadyInRootPages = focusedCommentId && !focusedReplyId ? commentById.get(focusedCommentId) : undefined;
  const serverIds = new Set(comments.map((comment) => comment.id));
  const rootOverlays = commentOverlays.roots.filter((comment) => !serverIds.has(comment.id) && !isCommentHidden(commentOverlays, comment));
  const rootOverlayIds = new Set(rootOverlays.map((comment) => comment.id));
  const targetRoot = resolvedRootComment && !serverIds.has(resolvedRootComment.id) && !rootOverlayIds.has(resolvedRootComment.id) && !isCommentHidden(commentOverlays, resolvedRootComment)
    ? resolvedRootComment
    : null;
  const mainComments = comments;
  const visibleComments = [...rootOverlays, ...(targetRoot ? [targetRoot] : []), ...mainComments];
  const commentScroll = useListScrollState(
    { userId: currentUserId ?? null, route: `/polls/${pollId}`, list: 'comments', query: focusedCommentId ?? focusedReplyId ?? '', filter: '', sort: '' },
    { itemIds: visibleComments.map((comment) => comment.id), priority: focusedCommentId || focusedReplyId ? 'explicit-target' : null, restoreFocusOnPop: navigationType === 'POP' },
  );
  const [refreshState, setRefreshState] = useState<{ identity: string; pending: boolean; error: unknown | null }>({
    identity: '', pending: false, error: null,
  });
  const currentRefreshState = refreshState.identity === queryIdentity ? refreshState : { identity: queryIdentity, pending: false, error: null };
  const replyGeneration = replyGenerationQuery.data;
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
    if (!targetFocusKey || !focusedTargetNode || didFocusTarget.current.focused) return;
    didFocusTarget.current.focused = true;
    focusedTargetNode.focus();
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    focusedTargetNode.scrollIntoView?.({ block: 'center', behavior: commentScrollBehavior(prefersReducedMotion) });
  }, [targetFocusKey, focusedTargetNode]);

  const lastPage = pageData.at(-1);
  const nextCursor = paginationEnabled && lastPage?.paginationSupported ? lastPage.nextCursor : null;
  const paginationState: PaginationState = {
    generation: replyGeneration,
    sessionEpoch,
    userId: currentUserId ?? null,
    followingGeneration: 0,
    nextCursor: nextCursor ?? null,
    cursorHistory: commentsQuery.data?.pageParams.filter((cursor): cursor is string => typeof cursor === 'string') ?? [],
    paginationSupported: paginationEnabled && (lastPage?.paginationSupported ?? false),
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
    const reactionRevision = commentReactionRevision(queryClient, commentScope);
    void commentsQuery.fetchNextPage({ cancelRefetch: false }).finally(() => {
      reconcileCommentPageCache(queryClient, commentScope, reactionRevision);
      activeAppendRequests.current.delete(requestKey);
    });
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
      const reactionRevision = commentReactionRevision(queryClient, commentScope);
      const page = reconcileCommentPage(
        queryClient,
        commentScope,
        await paginationAnalytics.trackPageRequest<PollComment, ClientCursorPage<PollComment>>({
          surface: 'comments',
          sort: 'newest',
          pageNumber: 1,
          chainId: requestIdentity,
          kind: 'refresh',
          cursor: null,
          signal: controller.signal,
          isCurrent: () => !controller.signal.aborted && currentIdentity.current === requestIdentity && refreshGeneration.current === requestGeneration,
          existingIds: commentsQuery.data?.pages.flatMap((entry) => entry.items.map((comment) => comment.id)) ?? [],
          getId: (comment) => comment.id,
        }, ({ requestId, action }) => listCommentsPage(
          pollId,
          { order: 'newest', requestId, pageNumber: 1, paginationAction: action },
          controller.signal,
        )),
        reactionRevision,
      );
      if (controller.signal.aborted || currentIdentity.current !== requestIdentity || refreshGeneration.current !== requestGeneration) return;
      queryClient.setQueryData<CommentPages>(queryKey, { pages: [page], pageParams: [null] });
      automaticLoadCounts.current.set(requestIdentity, 0);
      queryClient.setQueryData<number>(replyGenerationKey, (current) => (current ?? 0) + 1);
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

  const handleReplyCreated = useCallback((_reply: PollComment, poll: Poll) => {
    onReplyCreated?.(poll);
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }, [onReplyCreated, queryClient, queryKey]);

  function renderRootComment(comment: PollComment, index: number) {
    return <CommentRootItem
      key={comment.id}
      comment={comment}
      pollId={pollId}
      sessionEpoch={sessionEpoch}
      sessionReady={sessionReady}
      currentUserId={currentUserId}
      isLiking={pendingLikeIds.includes(comment.id)}
      isDeleting={pendingDeleteIds.includes(comment.id)}
      indexInBatch={index}
      contextKey={`comments:${sessionEpoch}:${currentUserId ?? 'anonymous'}:${pollId}`}
      isFocusedRoot={comment.id === focusRootId && !focusedReplyId}
      focusedReplyId={focusedReplyId}
      forcedExpandedRootId={forcedExpandedRootId}
      replyGeneration={replyGeneration}
      contextReply={target?.comment}
      focusedTargetRef={setFocusedTargetNode}
      onLike={handleRootLike}
      onDelete={handleRootDelete}
      onReplyCreated={handleReplyCreated}
    />;
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
      {focusedCommentId && !target?.comment && !targetAlreadyInRootPages && target?.isPending ? <section className="comment-list__target" aria-label="Comment from link">
        <p role="status">Loading the linked comment…</p>
      </section> : null}
      {focusedCommentId && !target?.comment && !targetAlreadyInRootPages && target?.error ? <section className="comment-list__target" aria-label="Comment from link">
        <p role="alert">{linkedCommentErrorMessage(target.error)}</p>
        {!isPermanentTargetError(target.error) ? <button className="button" type="button" onClick={(event) => { focusRetryLandmark(event.currentTarget); target.retry(); }}>Retry loading linked comment</button> : null}
      </section> : null}
      {targetRoot && !focusedReplyId ? <section className="comment-list__target" aria-label="Comment from link">
        <p role="status">This comment is outside the loaded pages.</p>
        <ul>{renderRootComment(targetRoot, 0)}</ul>
      </section> : null}
      {targetRoot && focusedReplyId ? <section className="comment-list__target" aria-label="Comment from link">
        <p role="status">This comment is outside the loaded pages.</p>
        <ul>{renderRootComment(targetRoot, 0)}</ul>
      </section> : null}
      {focusedReplyId && target?.comment && !target?.root && (!target.rootIsPending || target.rootError) && !isCommentHidden(commentOverlays, target.comment) ? <section className="comment-list__target" aria-label="Comment from link">
        <p role="status">This reply is outside the loaded comment pages.</p>
        {target?.rootIsPending ? <p role="status">Loading the reply’s parent comment…</p> : null}
        {target?.rootError ? <div className="comment-thread__error">
          <p role="alert">{linkedCommentErrorMessage(target.rootError, true)}</p>
          {!isPermanentTargetError(target.rootError) ? <button className="button" type="button" onClick={(event) => { focusRetryLandmark(event.currentTarget); target.retryRoot(); }}>Retry loading linked parent</button> : null}
        </div> : null}
        <ul className="comment-thread__list"><li
          className="comment-card comment-thread__reply comment-card--focused"
          data-list-item-id={target.comment.id}
          ref={setFocusedTargetNode}
          tabIndex={-1}
          aria-current="location"
        >
          <p className="comment-card__author"><strong>{target.comment.author.displayName || target.comment.author.username}</strong> <span>@{target.comment.author.username}</span></p>
          <p className="comment-card__body">{target.comment.body}</p>
        </li></ul>
      </section> : null}
      <ContentEntryTransition loading={commentsQuery.isPending && !commentsQuery.data} kind="comment" rows={2}>
      {rootOverlays.length ? <section className="comment-list__overlay" aria-label="Your new comments">
        <p role="status">Your comment</p>
        <ul>{rootOverlays.map(renderRootComment)}</ul>
      </section> : null}
      {mainComments.length ? <ul>{mainComments.map(renderRootComment)}</ul>
        : visibleComments.length === 0 && !commentsQuery.isPending && !(commentsQuery.isError && !commentsQuery.data) ? <p>No comments yet.</p> : null}
      </ContentEntryTransition>
      {commentsQuery.isError && !commentsQuery.data ? <div role="alert"><p>{mutationErrorMessage(commentsQuery.error)}</p><button type="button" onClick={(event) => { focusRetryLandmark(event.currentTarget); void commentsQuery.refetch(); }}>Retry loading comments</button></div> : null}
      {commentsQuery.isError && commentsQuery.data && !commentsQuery.isFetchNextPageError ? <div role="alert" className="async-state async-state--error"><p>{mutationErrorMessage(commentsQuery.error)}</p><button type="button" onClick={(event) => { focusRetryLandmark(event.currentTarget); void commentsQuery.refetch(); }}>Retry loading comments</button></div> : null}
      {commentsQuery.data ? <PaginationFooter
        hasNextPage={Boolean(commentsQuery.hasNextPage)}
        isFetchingNextPage={commentsQuery.isFetchingNextPage}
        isRefreshing={currentRefreshState.pending}
        isFetchNextPageError={commentsQuery.isFetchNextPageError}
        paginationSupported={paginationEnabled && (lastPage?.paginationSupported ?? false)}
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
