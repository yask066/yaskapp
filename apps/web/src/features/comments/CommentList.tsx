import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useMutationState, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useNavigationType } from 'react-router-dom';
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
import {
  canAppend,
  mergePageIds,
  paginationQueryKey,
  paginationQueryOptions,
  type PaginationLoadTrigger,
  type PaginationState,
} from '../../core/pagination/pagination-state';
import { PaginationFooter } from '../../components/PaginationFooter';
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
  const commentScope = useMemo(() => ({ sessionEpoch, userId: currentUserId ?? null, pollId }), [sessionEpoch, currentUserId, pollId]);
  const queryKey = paginationQueryKey({
    surface: 'comments', sessionEpoch, userId: currentUserId ?? null, pollId,
  });
  const commentOverlays = useCommentOverlayState(commentScope);
  const queryIdentity = JSON.stringify(queryKey);
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
      const page = await listCommentsPage(pollId, { cursor: pageParam ?? undefined, order: 'newest' }, signal);
      return reconcileCommentPage(queryClient, commentScope, page, reactionRevision);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.paginationSupported ? lastPage.nextCursor ?? undefined : undefined,
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
  const focusedCommentRef = useRef<HTMLLIElement | null>(null);
  const navigationType = useNavigationType();
  const focusRootId = focusedReplyId ? forcedExpandedRootId : focusedCommentId;
  const pageData = useMemo(() => commentsQuery.data?.pages ?? [], [commentsQuery.data?.pages]);
  const commentById = useMemo(
    () => new Map(pageData.flatMap((page) => page.items).map((comment) => [comment.id, comment] as const)),
    [pageData],
  );
  const comments = mergePageIds(pageData, (comment) => comment.id)
    .map((commentId) => commentById.get(commentId)!)
    .filter((comment): comment is PollComment => comment !== undefined && !isCommentHidden(commentOverlays, comment));
  const serverIds = new Set(comments.map((comment) => comment.id));
  const rootOverlays = commentOverlays.roots.filter((comment) => !serverIds.has(comment.id) && !isCommentHidden(commentOverlays, comment));
  const rootOverlayIds = new Set(rootOverlays.map((comment) => comment.id));
  const targetRoot = resolvedRootComment && !serverIds.has(resolvedRootComment.id) && !rootOverlayIds.has(resolvedRootComment.id) && !isCommentHidden(commentOverlays, resolvedRootComment)
    ? resolvedRootComment
    : null;
  const mainComments = targetRoot ? [targetRoot, ...comments] : comments;
  const visibleComments = [...rootOverlays, ...mainComments];
  const commentScroll = useListScrollState(
    { userId: currentUserId ?? null, route: `/polls/${pollId}`, list: 'comments', query: focusedCommentId ?? focusedReplyId ?? '', filter: '', sort: '' },
    { itemIds: visibleComments.map((comment) => comment.id), priority: focusedCommentId || focusedReplyId ? 'explicit-target' : null, restoreFocusOnPop: navigationType === 'POP' },
  );
  const [refreshState, setRefreshState] = useState<{ identity: string; pending: boolean; error: unknown | null }>({
    identity: '', pending: false, error: null,
  });
  const currentRefreshState = refreshState.identity === queryIdentity ? refreshState : { identity: queryIdentity, pending: false, error: null };
  const replyGeneration = replyGenerationQuery.data;
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
        await listCommentsPage(pollId, { order: 'newest' }, controller.signal),
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

  function handleReplyCreated(_rootComment: PollComment, _reply: PollComment, poll: Poll) {
    onReplyCreated?.(poll);
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }

  function renderRootComment(comment: PollComment, index: number) {
    return <EntryMotion key={comment.id} contextKey={`comments:${sessionEpoch}:${currentUserId ?? 'anonymous'}:${pollId}`} itemId={comment.id} visible indexInBatch={index}>
      <li className={`comment-card${comment.id === focusRootId && !focusedReplyId ? ' comment-card--focused' : ''}`} data-list-item-id={comment.id} ref={comment.id === focusRootId ? focusedCommentRef : undefined} tabIndex={-1} aria-current={comment.id === focusRootId && !focusedReplyId ? 'location' : undefined}>
        <p className="comment-card__author"><strong>{comment.author.displayName || comment.author.username}</strong> <span>@{comment.author.username}</span></p>
        <p className="comment-card__body">{comment.body}</p>
        <div className="comment-card__actions">
          {currentUserId ? <button className="button" type="button" disabled={pendingLikeIds.includes(comment.id)} aria-pressed={comment.viewerHasLiked} onClick={() => likeMutation.mutate({ comment, epoch: pollSessionEpoch(queryClient) })}>Like ({comment.likesCount})</button> : null}
          {comment.author.id === currentUserId ? <button className="button" type="button" disabled={pendingDeleteIds.includes(comment.id)} onClick={() => { if (window.confirm('Delete this comment?')) deleteMutation.mutate({ comment, epoch: pollSessionEpoch(queryClient) }); }}>Delete</button> : null}
        </div>
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
    </EntryMotion>;
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
