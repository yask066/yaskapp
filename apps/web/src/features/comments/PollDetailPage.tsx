import { CancelledError, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { createComment, getComment, getPoll } from '../../api/polls';
import { useSession } from '../../app/session-provider';
import { AsyncState } from '../../components/AsyncState';
import { PollCard } from '../../components/PollCard';
import { isAmbiguousMutationError, replaceCachedPoll, usePollMutations } from '../polls/usePollMutations';
import { fetchPollQuery, pollSessionEpoch, reconcilePoll } from '../polls/poll-state';
import { CommentForm } from './CommentForm';
import { CommentList, type CommentTargetState } from './CommentList';
import { paginationQueryKey } from '../../core/pagination/pagination-state';
import { addCreatedCommentOverlay, commentReactionRevision, reconcileCommentSnapshot } from './comment-state';

export function PollDetailPage() {
  const { pollId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const focusedCommentId = searchParams.get('comment');
  const { user, status, sessionEpoch } = useSession();
  const queryClient = useQueryClient();
  const pollMutations = usePollMutations();
  const commentScope = { sessionEpoch, userId: user?.id ?? null, pollId };
  const commentsQueryKey = paginationQueryKey({
    surface: 'comments', sessionEpoch, userId: user?.id ?? null, pollId,
  });
  const pollQuery = useQuery({ queryKey: ['poll', pollId], queryFn: ({ signal }) => fetchPollQuery(queryClient, user?.id ?? null, () => getPoll(pollId, signal), true, signal), enabled: Boolean(pollId) && status !== 'loading' });
  const commentTargetQuery = useQuery({
    queryKey: ['comment-target', pollId, focusedCommentId],
    queryFn: async ({ signal }) => {
      const reactionRevision = commentReactionRevision(queryClient, commentScope);
      const comment = await getComment(pollId, focusedCommentId ?? '', signal);
      const current = reconcileCommentSnapshot(queryClient, commentScope, comment, reactionRevision);
      if (!current) throw new CancelledError({ silent: true });
      return current;
    },
    enabled: Boolean(pollId && focusedCommentId),
  });
  const targetRootId = commentTargetQuery.data?.parentCommentId ?? null;
  const rootTargetQuery = useQuery({
    queryKey: ['comment-target', pollId, targetRootId],
    queryFn: async ({ signal }) => {
      const reactionRevision = commentReactionRevision(queryClient, commentScope);
      const comment = await getComment(pollId, targetRootId ?? '', signal);
      const current = reconcileCommentSnapshot(queryClient, commentScope, comment, reactionRevision);
      if (!current) throw new CancelledError({ silent: true });
      return current;
    },
    enabled: Boolean(pollId && focusedCommentId && targetRootId),
  });
  const focusedReplyId = targetRootId ? focusedCommentId : null;
  const resolvedRootComment = targetRootId ? rootTargetQuery.data : commentTargetQuery.data;
  const commentTarget: CommentTargetState | undefined = focusedCommentId ? {
    comment: commentTargetQuery.data,
    root: resolvedRootComment,
    isPending: commentTargetQuery.isPending,
    error: commentTargetQuery.error,
    retry: () => { void commentTargetQuery.refetch(); },
    rootIsPending: Boolean(targetRootId) && rootTargetQuery.isPending,
    rootError: targetRootId ? rootTargetQuery.error : null,
    retryRoot: () => { void rootTargetQuery.refetch(); },
  } : undefined;
  const createMutation = useMutation({
    mutationFn: ({ body }: { body: string; epoch: number }) => createComment(pollId, body),
    onSuccess: ({ comment, poll }, { epoch }) => {
      if (pollSessionEpoch(queryClient) !== epoch) return;
      addCreatedCommentOverlay(queryClient, commentScope, comment);
      replaceCachedPoll(queryClient, poll, user?.id ?? null);
    },
    onError: (error, { epoch }) => {
      if (pollSessionEpoch(queryClient) !== epoch || !isAmbiguousMutationError(error)) return;
      void reconcilePoll(queryClient, pollId, user?.id ?? null, epoch);
      void queryClient.invalidateQueries({ queryKey: commentsQueryKey, exact: true });
    },
  });

  return (
    <main id="main-content" className="detail-page">
      {pollQuery.isPending && !pollQuery.data ? <AsyncState state="loading" kind="poll" rows={1} /> : null}
      {pollQuery.isError && !pollQuery.data ? <AsyncState state="error" error={pollQuery.error} onRetry={() => void pollQuery.refetch()} /> : null}
      {pollQuery.data ? <PollCard poll={pollQuery.data} viewerId={user?.id} isVoting={pollMutations.isVoting(pollId)} isLiking={pollMutations.isLiking(pollId)} onVote={user ? (id, optionId) => pollMutations.vote({ pollId: id, optionId }) : undefined} onCancelVote={user ? pollMutations.cancelVote : undefined} onLike={user ? (id, viewerHasLiked) => pollMutations.toggleLike({ pollId: id, viewerHasLiked }) : undefined} onDelete={user ? pollMutations.deletePoll : undefined} /> : null}
      <section className="comments-section" aria-labelledby="comments-heading">
        <header className="page-heading"><h1 id="comments-heading">Comments</h1></header>
        {user ? <CommentForm onSubmit={async (body) => { await createMutation.mutateAsync({ body, epoch: pollSessionEpoch(queryClient) }); }} /> : <Link to={`/login?next=${encodeURIComponent(`/polls/${pollId}`)}`}>Login</Link>}
        {pollId ? <CommentList
          pollId={pollId}
          currentUserId={user?.id}
          sessionEpoch={sessionEpoch}
          sessionReady={status !== 'loading'}
          focusedCommentId={focusedCommentId}
          focusedReplyId={focusedReplyId}
          forcedExpandedRootId={targetRootId}
          resolvedRootComment={resolvedRootComment}
          target={commentTarget}
          onReplyCreated={(poll) => replaceCachedPoll(queryClient, poll, user?.id ?? null)}
        /> : null}
      </section>
      {pollQuery.isError && pollQuery.data ? <AsyncState state="error" error={pollQuery.error} onRetry={() => void pollQuery.refetch()} /> : null}{pollQuery.isFetching && pollQuery.data ? <AsyncState state="refreshing" kind="poll" /> : null}
    </main>
  );
}
