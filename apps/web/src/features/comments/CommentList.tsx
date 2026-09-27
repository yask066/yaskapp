import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteComment, likeComment, listComments, unlikeComment } from '../../api/polls';
import type { Poll, PollComment } from '../../api/models';
import { mutationErrorMessage } from '../polls/usePollMutations';
import { commentScrollBehavior } from './comment-scroll';
import { CommentThread } from './CommentThread';

interface CommentListProps {
  pollId: string;
  currentUserId?: string | null;
  focusedCommentId?: string | null;
  focusedReplyId?: string | null;
  forcedExpandedRootId?: string | null;
  resolvedRootComment?: PollComment;
  onReplyCreated?: (poll: Poll) => void;
}

function replaceComment(queryClient: ReturnType<typeof useQueryClient>, pollId: string, comment: PollComment) {
  queryClient.setQueryData<PollComment[]>(['comments', pollId], (cached = []) => cached.map((item) => item.id === comment.id ? comment : item));
}

export function CommentList({
  pollId,
  currentUserId,
  focusedCommentId,
  focusedReplyId,
  forcedExpandedRootId,
  resolvedRootComment,
  onReplyCreated,
}: CommentListProps) {
  const queryClient = useQueryClient();
  const commentsQuery = useQuery({ queryKey: ['comments', pollId], queryFn: () => listComments(pollId) });
  const likeMutation = useMutation({
    mutationFn: (comment: PollComment) => comment.viewerHasLiked ? unlikeComment(pollId, comment.id) : likeComment(pollId, comment.id),
    onSuccess: (comment) => replaceComment(queryClient, pollId, comment),
  });
  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deleteComment(pollId, commentId),
    onSuccess: (_, commentId) => {
      queryClient.setQueryData<PollComment[]>(['comments', pollId], (cached = []) => cached.filter((comment) => comment.id !== commentId));
      return queryClient.invalidateQueries({ queryKey: ['poll', pollId] });
    },
  });
  const focusedCommentRef = useRef<HTMLLIElement | null>(null);
  const focusRootId = focusedReplyId ? forcedExpandedRootId : focusedCommentId;
  useEffect(() => {
    if (!focusRootId || !commentsQuery.data) return;
    const target = focusedCommentRef.current;
    if (!target) return;
    if (!focusedReplyId) target.focus();
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    target.scrollIntoView?.({ block: 'center', behavior: commentScrollBehavior(prefersReducedMotion) });
  }, [commentsQuery.data, focusRootId, focusedReplyId]);
  const writeError = likeMutation.error ?? deleteMutation.error;

  if (commentsQuery.isPending) return <p role="status">Loading comments…</p>;
  if (commentsQuery.isError) return <p role="alert">{mutationErrorMessage(commentsQuery.error)}</p>;

  const comments = commentsQuery.data ?? [];
  const visibleComments = resolvedRootComment && !comments.some((comment) => comment.id === resolvedRootComment.id)
    ? [resolvedRootComment, ...comments]
    : comments;

  function handleReplyCreated(rootComment: PollComment, _reply: PollComment, poll: Poll) {
    queryClient.setQueryData<PollComment[]>(['comments', pollId], (cached = []) => {
      const hasRoot = cached.some((comment) => comment.id === rootComment.id);
      const updated = cached.map((comment) => comment.id === rootComment.id
        ? { ...comment, repliesCount: comment.repliesCount + 1 }
        : comment);
      return hasRoot ? updated : [{ ...rootComment, repliesCount: rootComment.repliesCount + 1 }, ...updated];
    });
    void queryClient.invalidateQueries({ queryKey: ['comments', pollId], exact: true });
    onReplyCreated?.(poll);
  }

  return (
    <div className="comment-list">
      {writeError ? <p role="alert">{mutationErrorMessage(writeError)}</p> : null}
      {visibleComments.length ? <ul>
        {visibleComments.map((comment) => <li className={`comment-card${comment.id === focusRootId && !focusedReplyId ? ' comment-card--focused' : ''}`} key={comment.id} ref={comment.id === focusRootId ? focusedCommentRef : undefined} tabIndex={comment.id === focusRootId ? -1 : undefined} aria-current={comment.id === focusRootId && !focusedReplyId ? 'location' : undefined}>
          <p className="comment-card__author"><strong>{comment.author.displayName || comment.author.username}</strong> <span>@{comment.author.username}</span></p>
          <p className="comment-card__body">{comment.body}</p>
          <div className="comment-card__actions">{currentUserId ? <button className="button" type="button" aria-pressed={comment.viewerHasLiked} onClick={() => likeMutation.mutate(comment)}>Like ({comment.likesCount})</button> : null}{comment.author.id === currentUserId ? <button className="button" type="button" onClick={() => { if (window.confirm('Delete this comment?')) deleteMutation.mutate(comment.id); }}>Delete</button> : null}</div>
          <CommentThread
            pollId={pollId}
            rootComment={comment}
            currentUserId={currentUserId}
            focusedReplyId={comment.id === forcedExpandedRootId ? focusedReplyId : null}
            autoExpand={comment.id === forcedExpandedRootId}
            onReplyCreated={(reply, poll) => handleReplyCreated(comment, reply, poll)}
          />
        </li>)}
      </ul> : <p>No comments yet.</p>}
    </div>
  );
}
