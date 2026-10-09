import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createComment, listCommentReplies } from '../../api/polls';
import type { Poll, PollComment } from '../../api/models';
import { mutationErrorMessage } from '../polls/usePollMutations';
import { commentScrollBehavior } from './comment-scroll';
import { CommentForm } from './CommentForm';
import { pollSessionEpoch, reconcilePoll } from '../polls/poll-state';
import { isAmbiguousMutationError } from '../polls/usePollMutations';
import { useListScrollState } from '../../core/scroll/useListScrollState';
import { EntryMotion } from '../../core/motion/EntryMotion';
import { ContentEntryTransition } from '../../components/ContentEntryTransition';
import { AsyncState } from '../../components/AsyncState';
import { focusRetryLandmark } from '../../components/focusRetryLandmark';

interface CommentThreadProps {
  pollId: string;
  sessionEpoch?: number;
  rootComment: PollComment;
  currentUserId?: string | null;
  focusedReplyId?: string | null;
  autoExpand?: boolean;
  onReplyCreated?: (comment: PollComment, poll: Poll) => void;
}

export function CommentThread({
  pollId,
  sessionEpoch = 0,
  rootComment,
  currentUserId,
  focusedReplyId,
  autoExpand = false,
  onReplyCreated,
}: CommentThreadProps) {
  const queryClient = useQueryClient();
  const queryKey = ['comment-replies', pollId, rootComment.id] as const;
  const [isExpanded, setIsExpanded] = useState(autoExpand || Boolean(focusedReplyId));
  const [isReplying, setIsReplying] = useState(false);
  const focusedReplyRef = useRef<HTMLLIElement | null>(null);
  const didFocusReply = useRef(false);
  const repliesQuery = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => listCommentReplies(pollId, rootComment.id, { cursor: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isExpanded,
  });
  const replyMutation = useMutation({
    mutationFn: ({ body }: { body: string; epoch: number }) => createComment(pollId, body, rootComment.id),
    onSuccess: async ({ comment, poll }, { epoch }) => {
      if (pollSessionEpoch(queryClient) !== epoch) return;
      onReplyCreated?.(comment, poll);
      setIsReplying(false);
      setIsExpanded(true);
      await queryClient.invalidateQueries({ queryKey, exact: true });
    },
    onError: (error, { epoch }) => {
      if (pollSessionEpoch(queryClient) !== epoch || !isAmbiguousMutationError(error)) return;
      void reconcilePoll(queryClient, pollId, currentUserId ?? null, epoch);
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ['comments', pollId] });
    },
  });
  const replies = useMemo(() => repliesQuery.data?.pages.flatMap((page) => page.items) ?? [], [repliesQuery.data]);
  const repliesScroll = useListScrollState(
    { userId: currentUserId ?? null, route: `/polls/${pollId}`, list: `replies:${rootComment.id}`, query: focusedReplyId ?? '', filter: '', sort: '' },
    { itemIds: isExpanded ? replies.map((reply) => reply.id) : [], priority: focusedReplyId ? 'explicit-target' : null },
  );
  const { isError, hasNextPage, isFetchingNextPage, fetchNextPage } = repliesQuery;

  useEffect(() => {
    if (autoExpand || focusedReplyId) setIsExpanded(true);
  }, [autoExpand, focusedReplyId]);

  useEffect(() => {
    didFocusReply.current = false;
  }, [focusedReplyId]);

  useEffect(() => {
    if (!isExpanded || !focusedReplyId || didFocusReply.current) return;
    const matchingReply = replies.find((reply) => reply.id === focusedReplyId);
    if (matchingReply && focusedReplyRef.current) {
      didFocusReply.current = true;
      focusedReplyRef.current.focus();
      const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      focusedReplyRef.current.scrollIntoView?.({ block: 'center', behavior: commentScrollBehavior(prefersReducedMotion) });
      return;
    }
    if (!isError && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [focusedReplyId, isExpanded, replies, fetchNextPage, hasNextPage, isError, isFetchingNextPage]);

  const authorLabel = rootComment.author.displayName || rootComment.author.username;
  const replyButtonName = `Reply to ${authorLabel}`;

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
        {repliesQuery.isError && !repliesQuery.data ? <div className="comment-thread__error">
          <p role="alert">{mutationErrorMessage(repliesQuery.error)}</p>
          <button className="button" type="button" onClick={(event) => { focusRetryLandmark(event.currentTarget); void repliesQuery.refetch(); }}>Retry loading replies</button>
        </div> : null}
        {!repliesQuery.isPending && !repliesQuery.isError && replies.length === 0 ? <p>No replies yet.</p> : null}
        {replies.length ? <ul className="comment-thread__list">
          {replies.map((reply, index) => <EntryMotion key={reply.id} contextKey={`replies:${sessionEpoch}:${currentUserId ?? 'anonymous'}:${pollId}:${rootComment.id}`} itemId={reply.id} visible indexInBatch={index}>
            <li
              className={`comment-card comment-thread__reply${reply.id === focusedReplyId ? ' comment-card--focused' : ''}`}
              data-list-item-id={reply.id}
              ref={reply.id === focusedReplyId ? focusedReplyRef : undefined}
              tabIndex={-1}
              aria-current={reply.id === focusedReplyId ? 'location' : undefined}
            >
              <p className="comment-card__author"><strong>{reply.author.displayName || reply.author.username}</strong> <span>@{reply.author.username}</span></p>
              <p className="comment-card__body">{reply.body}</p>
            </li>
          </EntryMotion>)}
        </ul> : null}
        {repliesQuery.hasNextPage ? <button
          className="button comment-thread__load-more"
          type="button"
          disabled={repliesQuery.isFetchingNextPage}
          onClick={() => void repliesQuery.fetchNextPage()}
        >{repliesQuery.isFetchingNextPage ? 'Loading more replies…' : 'Load more replies'}</button> : null}
        {repliesQuery.isError && repliesQuery.data ? <div className="comment-thread__error"><p role="alert">{mutationErrorMessage(repliesQuery.error)}</p><button className="button" type="button" onClick={(event) => { focusRetryLandmark(event.currentTarget); void repliesQuery.refetch(); }}>Retry loading replies</button></div> : null}
        {repliesQuery.isFetching && !repliesQuery.isFetchingNextPage && repliesQuery.data ? <AsyncState state="refreshing" kind="comment" /> : null}
        </ContentEntryTransition>
      </div> : null}
    </section>
  );
}
