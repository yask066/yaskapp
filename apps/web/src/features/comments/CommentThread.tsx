import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createComment, listCommentReplies } from '../../api/polls';
import type { Poll, PollComment } from '../../api/models';
import { mutationErrorMessage } from '../polls/usePollMutations';
import { commentScrollBehavior } from './comment-scroll';
import { CommentForm } from './CommentForm';

interface CommentThreadProps {
  pollId: string;
  rootComment: PollComment;
  currentUserId?: string | null;
  focusedReplyId?: string | null;
  autoExpand?: boolean;
  onReplyCreated?: (comment: PollComment, poll: Poll) => void;
}

export function CommentThread({
  pollId,
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
    queryFn: ({ pageParam }) => listCommentReplies(pollId, rootComment.id, { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isExpanded,
  });
  const replyMutation = useMutation({
    mutationFn: (body: string) => createComment(pollId, body, rootComment.id),
    onSuccess: async ({ comment, poll }) => {
      onReplyCreated?.(comment, poll);
      setIsReplying(false);
      setIsExpanded(true);
      await queryClient.invalidateQueries({ queryKey, exact: true });
    },
  });
  const replies = repliesQuery.data?.pages.flatMap((page) => page.items) ?? [];

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
    if (!repliesQuery.isError && repliesQuery.hasNextPage && !repliesQuery.isFetchingNextPage) {
      void repliesQuery.fetchNextPage();
    }
  }, [focusedReplyId, isExpanded, replies, repliesQuery.fetchNextPage, repliesQuery.hasNextPage, repliesQuery.isError, repliesQuery.isFetchingNextPage]);

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
        onSubmit={async (body) => { await replyMutation.mutateAsync(body); }}
      /> : null}

      {isExpanded ? <div className="comment-thread__replies" id={`replies-${rootComment.id}`}>
        {repliesQuery.isPending ? <p role="status">Loading replies…</p> : null}
        {repliesQuery.isError ? <div className="comment-thread__error">
          <p role="alert">{mutationErrorMessage(repliesQuery.error)}</p>
          <button className="button" type="button" onClick={() => void repliesQuery.refetch()}>Retry loading replies</button>
        </div> : null}
        {!repliesQuery.isPending && !repliesQuery.isError && replies.length === 0 ? <p>No replies yet.</p> : null}
        {replies.length ? <ul className="comment-thread__list">
          {replies.map((reply) => <li
            className={`comment-card comment-thread__reply${reply.id === focusedReplyId ? ' comment-card--focused' : ''}`}
            key={reply.id}
            ref={reply.id === focusedReplyId ? focusedReplyRef : undefined}
            tabIndex={reply.id === focusedReplyId ? -1 : undefined}
            aria-current={reply.id === focusedReplyId ? 'location' : undefined}
          >
            <p className="comment-card__author"><strong>{reply.author.displayName || reply.author.username}</strong> <span>@{reply.author.username}</span></p>
            <p className="comment-card__body">{reply.body}</p>
          </li>)}
        </ul> : null}
        {repliesQuery.hasNextPage ? <button
          className="button comment-thread__load-more"
          type="button"
          disabled={repliesQuery.isFetchingNextPage}
          onClick={() => void repliesQuery.fetchNextPage()}
        >{repliesQuery.isFetchingNextPage ? 'Loading more replies…' : 'Load more replies'}</button> : null}
      </div> : null}
    </section>
  );
}
