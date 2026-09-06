import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteComment, likeComment, listComments, unlikeComment } from '../../api/polls';
import type { PollComment } from '../../api/models';
import { mutationErrorMessage } from '../polls/usePollMutations';

interface CommentListProps {
  pollId: string;
  currentUserId?: string | null;
}

function replaceComment(queryClient: ReturnType<typeof useQueryClient>, pollId: string, comment: PollComment) {
  queryClient.setQueryData<PollComment[]>(['comments', pollId], (cached = []) => cached.map((item) => item.id === comment.id ? comment : item));
}

export function CommentList({ pollId, currentUserId }: CommentListProps) {
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
  const writeError = likeMutation.error ?? deleteMutation.error;

  if (commentsQuery.isPending) return <p role="status">Loading comments…</p>;
  if (commentsQuery.isError) return <p role="alert">{mutationErrorMessage(commentsQuery.error)}</p>;

  return (
    <>
      {writeError ? <p role="alert">{mutationErrorMessage(writeError)}</p> : null}
      {commentsQuery.data?.length ? <ul>
        {commentsQuery.data.map((comment) => <li key={comment.id}>
          <p><strong>{comment.author.displayName || comment.author.username}</strong></p>
          <p>{comment.body}</p>
          {currentUserId ? <button type="button" aria-pressed={comment.viewerHasLiked} onClick={() => likeMutation.mutate(comment)}>Like ({comment.likesCount})</button> : null}
          {comment.author.id === currentUserId ? <button type="button" onClick={() => { if (window.confirm('Delete this comment?')) deleteMutation.mutate(comment.id); }}>Delete</button> : null}
        </li>)}
      </ul> : <p>No comments yet.</p>}
    </>
  );
}
