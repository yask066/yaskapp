import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useInfiniteQuery, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { createComment, deleteComment, likeComment, listCommentReplies, unlikeComment } from '../../api/polls';
import type { Poll, PollComment } from '../../api/models';
import { mutationErrorMessage } from '../polls/usePollMutations';
import { CommentForm } from './CommentForm';
import { pollSessionEpoch, reconcilePoll } from '../polls/poll-state';
import { isAmbiguousMutationError } from '../polls/usePollMutations';
import { useListScrollState } from '../../core/scroll/useListScrollState';
import { EntryMotion } from '../../core/motion/EntryMotion';
import { ContentEntryTransition } from '../../components/ContentEntryTransition';
import { AsyncState } from '../../components/AsyncState';
import { focusRetryLandmark } from '../../components/focusRetryLandmark';
import {
  addCreatedCommentOverlay,
  applyCommentReaction,
  commentReactionRevision,
  commentMutationQueryKey,
  deleteCommentFromCache,
  invalidateCommentPages,
  isCommentDeleted,
  isCommentHidden,
  reconcileCommentPage,
  reconcileCommentPageCache,
  useCommentOverlayState,
} from './comment-state';
import {
  canAppend,
  mergePageIds,
  paginationQueryKey,
  paginationQueryOptions,
  type PaginationState,
} from '../../core/pagination/pagination-state';

interface CommentThreadProps {
  pollId: string;
  sessionEpoch?: number;
  sessionReady?: boolean;
  rootComment: PollComment;
  currentUserId?: string | null;
  focusedReplyId?: string | null;
  contextReply?: PollComment;
  focusedTargetRef?: Ref<HTMLLIElement>;
  autoExpand?: boolean;
  refreshGeneration?: number;
  onReplyCreated?: (comment: PollComment, poll: Poll) => void;
}

export function CommentThread({
  pollId,
  sessionEpoch = 0,
  sessionReady = true,
  rootComment,
  currentUserId,
  focusedReplyId,
  contextReply,
  focusedTargetRef,
  autoExpand = false,
  refreshGeneration = 0,
  onReplyCreated,
}: CommentThreadProps) {
  const queryClient = useQueryClient();
  const commentScope = useMemo(() => ({ sessionEpoch, userId: currentUserId ?? null, pollId }), [sessionEpoch, currentUserId, pollId]);
  const commentOverlays = useCommentOverlayState(commentScope);
  const queryKey = [...paginationQueryKey({
    surface: 'replies', sessionEpoch, userId: currentUserId ?? null, pollId, rootId: rootComment.id,
  }), refreshGeneration] as const;
  const commentsQueryKey = paginationQueryKey({
    surface: 'comments', sessionEpoch, userId: currentUserId ?? null, pollId,
  });
  const [isExpanded, setIsExpanded] = useState(autoExpand || Boolean(focusedReplyId));
  const [isReplying, setIsReplying] = useState(false);
  const activeAppendRequests = useRef(new Set<string>());
  const repliesQuery = useInfiniteQuery({
    queryKey,
    ...paginationQueryOptions,
    queryFn: async ({ pageParam, signal }) => {
      const reactionRevision = commentReactionRevision(queryClient, commentScope);
      const page = await listCommentReplies(pollId, rootComment.id, { cursor: pageParam }, signal);
      return reconcileCommentPage(queryClient, commentScope, page, reactionRevision);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isExpanded && sessionReady,
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
      void invalidateCommentPages(queryClient, commentScope);
    },
    onError: (error, request) => {
      if (pollSessionEpoch(queryClient) !== request.epoch || !isAmbiguousMutationError(error)) return;
      void reconcilePoll(queryClient, pollId, currentUserId ?? null, request.epoch);
      void invalidateCommentPages(queryClient, commentScope);
    },
  });
  const replyMutation = useMutation({
    mutationFn: ({ body }: { body: string; epoch: number }) => createComment(pollId, body, rootComment.id),
    onSuccess: async ({ comment, poll }, { epoch }) => {
      if (pollSessionEpoch(queryClient) !== epoch || isCommentDeleted(queryClient, commentScope, rootComment)) return;
      addCreatedCommentOverlay(queryClient, commentScope, comment);
      onReplyCreated?.(comment, poll);
      setIsReplying(false);
      setIsExpanded(true);
      await queryClient.invalidateQueries({ queryKey, exact: true });
    },
    onError: (error, { epoch }) => {
      if (pollSessionEpoch(queryClient) !== epoch || isCommentDeleted(queryClient, commentScope, rootComment) || !isAmbiguousMutationError(error)) return;
      void reconcilePoll(queryClient, pollId, currentUserId ?? null, epoch);
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: commentsQueryKey, exact: true });
    },
  });
  const replyPages = useMemo(() => repliesQuery.data?.pages ?? [], [repliesQuery.data?.pages]);
  const replyById = useMemo(
    () => new Map(replyPages.flatMap((page) => page.items).map((reply) => [reply.id, reply] as const)),
    [replyPages],
  );
  const replies = mergePageIds(replyPages, (reply) => reply.id)
    .map((replyId) => replyById.get(replyId)!)
    .filter((reply): reply is PollComment => reply !== undefined && !isCommentHidden(commentOverlays, reply));
  const serverReplyIds = new Set(replies.map((reply) => reply.id));
  const ownReplyOverlays = (commentOverlays.repliesByRoot[rootComment.id] ?? [])
    .filter((reply) => !serverReplyIds.has(reply.id) && !isCommentHidden(commentOverlays, reply));
  const visibleReplyIds = new Set([...replies, ...ownReplyOverlays].map((reply) => reply.id));
  const linkedReplyContext = contextReply && contextReply.id === focusedReplyId &&
    !visibleReplyIds.has(contextReply.id) && !isCommentHidden(commentOverlays, contextReply)
    ? contextReply
    : null;
  const replyGapExists = ownReplyOverlays.length > 0 &&
    (!replyPages.length || !(replyPages.at(-1)?.paginationSupported ?? false) || Boolean(replyPages.at(-1)?.nextCursor));
  const visibleReplies = [...replies, ...ownReplyOverlays];
  const repliesScroll = useListScrollState(
    { userId: currentUserId ?? null, route: `/polls/${pollId}`, list: `replies:${rootComment.id}`, query: focusedReplyId ?? '', filter: '', sort: '' },
    { itemIds: isExpanded ? visibleReplies.map((reply) => reply.id) : [], priority: focusedReplyId ? 'explicit-target' : null },
  );
  const { hasNextPage, isFetchingNextPage } = repliesQuery;
  const lastPage = replyPages.at(-1);
  const nextCursor = lastPage?.nextCursor ?? null;
  const cursorHistory = useMemo(
    () => repliesQuery.data?.pageParams.filter((cursor): cursor is string => typeof cursor === 'string') ?? [],
    [repliesQuery.data?.pageParams],
  );
  const paginationSupported = lastPage?.paginationSupported ?? false;
  const appendError = repliesQuery.isFetchNextPageError;
  const paginationState = useMemo<PaginationState>(() => ({
    generation: refreshGeneration,
    sessionEpoch,
    userId: currentUserId ?? null,
    followingGeneration: 0,
    nextCursor,
    cursorHistory,
    paginationSupported,
    automaticLoadCount: 0,
    pending: isFetchingNextPage ? { kind: 'append', cursor: nextCursor } : null,
    appendError,
  }), [refreshGeneration, sessionEpoch, currentUserId, nextCursor, cursorHistory, paginationSupported, isFetchingNextPage, appendError]);
  const repeatedCursor = paginationState.nextCursor !== null && paginationState.cursorHistory.includes(paginationState.nextCursor);
  const fetchNextRepliesPage = repliesQuery.fetchNextPage;
  const isFetchingNextRepliesPage = repliesQuery.isFetchingNextPage;

  const loadMoreReplies = useCallback(() => {
    const cursor = paginationState.nextCursor;
    if (!canAppend(paginationState, 'manual') || cursor === null) return;
    const requestKey = `${rootComment.id}:${cursor}`;
    if (activeAppendRequests.current.has(requestKey)) {
      if (isFetchingNextRepliesPage) return;
      activeAppendRequests.current.delete(requestKey);
    }
    activeAppendRequests.current.add(requestKey);
    const reactionRevision = commentReactionRevision(queryClient, commentScope);
    void fetchNextRepliesPage({ cancelRefetch: false }).finally(() => {
      reconcileCommentPageCache(queryClient, commentScope, reactionRevision);
      activeAppendRequests.current.delete(requestKey);
    });
  }, [paginationState, fetchNextRepliesPage, isFetchingNextRepliesPage, rootComment.id, queryClient, commentScope]);

  useEffect(() => {
    if (autoExpand || focusedReplyId) setIsExpanded(true);
  }, [autoExpand, focusedReplyId]);

  const authorLabel = rootComment.author.displayName || rootComment.author.username;
  const replyButtonName = `Reply to ${authorLabel}`;
  const mutationError = likeMutation.error ?? deleteMutation.error;

  function renderReply(reply: PollComment, index: number) {
    return <EntryMotion key={reply.id} contextKey={`replies:${sessionEpoch}:${currentUserId ?? 'anonymous'}:${pollId}:${rootComment.id}`} itemId={reply.id} visible indexInBatch={index}>
      <li
        className={`comment-card comment-thread__reply${reply.id === focusedReplyId ? ' comment-card--focused' : ''}`}
        data-list-item-id={reply.id}
        ref={reply.id === focusedReplyId ? focusedTargetRef : undefined}
        tabIndex={-1}
        aria-current={reply.id === focusedReplyId ? 'location' : undefined}
      >
        <p className="comment-card__author"><strong>{reply.author.displayName || reply.author.username}</strong> <span>@{reply.author.username}</span></p>
        <p className="comment-card__body">{reply.body}</p>
        {currentUserId ? <div className="comment-card__actions">
          <button className="button" type="button" disabled={pendingLikeIds.includes(reply.id)} aria-pressed={reply.viewerHasLiked} onClick={() => likeMutation.mutate({ comment: reply, epoch: pollSessionEpoch(queryClient) })}>Like ({reply.likesCount})</button>
          {reply.author.id === currentUserId ? <button className="button" type="button" disabled={pendingDeleteIds.includes(reply.id)} onClick={() => { if (window.confirm('Delete this reply?')) deleteMutation.mutate({ comment: reply, epoch: pollSessionEpoch(queryClient) }); }}>Delete reply</button> : null}
        </div> : null}
      </li>
    </EntryMotion>;
  }

  return (
    <section className="comment-thread" aria-label={`Replies to ${authorLabel}`}>
      <div className="comment-thread__actions">
        {rootComment.repliesCount > 0 || isExpanded ? <button
          className="button comment-thread__toggle"
          type="button"
          aria-expanded={isExpanded}
          aria-controls={`replies-${rootComment.id}`}
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >{isExpanded ? `Hide replies (${rootComment.repliesCount})` : `Show replies (${rootComment.repliesCount})`}</button> : null}
        {currentUserId ? <button className="button comment-thread__reply-button" type="button" onClick={() => setIsReplying((replying) => !replying)}>{replyButtonName}</button> : null}
      </div>

      {isReplying && currentUserId ? <CommentForm
        label="Write a reply"
        submitLabel="Post reply"
        replyToLabel={authorLabel}
        onCancel={() => setIsReplying(false)}
        onSubmit={async (body) => { await replyMutation.mutateAsync({ body, epoch: pollSessionEpoch(queryClient) }); }}
      /> : null}

      {isExpanded ? <div className="comment-thread__replies" id={`replies-${rootComment.id}`} ref={repliesScroll.listRef}>
        <ContentEntryTransition loading={repliesQuery.isPending && !repliesQuery.data} kind="comment" rows={2}>
        {mutationError ? <p role="alert">{mutationErrorMessage(mutationError)}</p> : null}
        {repliesQuery.isError && !repliesQuery.data ? <div className="comment-thread__error">
          <p role="alert">{mutationErrorMessage(repliesQuery.error)}</p>
          <button className="button" type="button" onClick={(event) => { focusRetryLandmark(event.currentTarget); void repliesQuery.refetch(); }}>Retry loading replies</button>
        </div> : null}
        {!repliesQuery.isPending && !repliesQuery.isError && visibleReplies.length === 0 ? <p>No replies yet.</p> : null}
        {replies.length ? <ul className="comment-thread__list">
          {replies.map(renderReply)}
        </ul> : null}
        {linkedReplyContext ? <section className="comment-thread__target" aria-label="Linked reply">
          <p role="status">This reply is outside the loaded pages.</p>
          <ul className="comment-thread__list">{renderReply(linkedReplyContext, replies.length + ownReplyOverlays.length)}</ul>
        </section> : null}
        {replyGapExists ? <section className="comment-thread__overlay" aria-label="Your replies">
          <p role="status">Your reply</p>
          <p>Replies between these sections are not loaded yet.</p>
          <ul className="comment-thread__list">{ownReplyOverlays.map((reply, index) => renderReply(reply, replies.length + index))}</ul>
        </section> : null}
        {!replyGapExists && ownReplyOverlays.length ? <ul className="comment-thread__list">
          {ownReplyOverlays.map((reply, index) => renderReply(reply, replies.length + index))}
        </ul> : null}
        {repliesQuery.hasNextPage && !repeatedCursor ? <button
          className="button comment-thread__load-more"
          type="button"
          disabled={repliesQuery.isFetchingNextPage || !canAppend(paginationState, 'manual')}
          onClick={loadMoreReplies}
        >{repliesQuery.isFetchingNextPage ? 'Loading more replies…' : repliesQuery.isFetchNextPageError ? 'Retry loading more replies' : 'Load more replies'}</button> : null}
        {paginationSupported && nextCursor === null && visibleReplies.length > 0 ? <p role="status">You've seen all replies.</p> : null}
        {repeatedCursor ? <p role="alert">The server returned a repeated cursor. Refresh comments to continue.</p> : null}
        {repliesQuery.isFetchNextPageError && repliesQuery.data ? <div className="comment-thread__error"><p role="alert">{mutationErrorMessage(repliesQuery.error)}</p></div> : null}
        {repliesQuery.isFetching && !repliesQuery.isFetchingNextPage && repliesQuery.data ? <AsyncState state="refreshing" kind="comment" /> : null}
        </ContentEntryTransition>
      </div> : null}
    </section>
  );
}
