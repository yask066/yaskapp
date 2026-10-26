import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { createComment, getComment, getPoll } from '../../api/polls';
import type { ClientCursorPage, PollComment } from '../../api/models';
import { useSession } from '../../app/session-provider';
import { AsyncState } from '../../components/AsyncState';
import { PollCard } from '../../components/PollCard';
import { isAmbiguousMutationError, replaceCachedPoll, usePollMutations } from '../polls/usePollMutations';
import { fetchPollQuery, pollSessionEpoch, reconcilePoll } from '../polls/poll-state';
import { CommentForm } from './CommentForm';
import { CommentList } from './CommentList';
import { paginationQueryKey } from '../../core/pagination/pagination-state';

export function PollDetailPage() {
  const { pollId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const focusedCommentId = searchParams.get('comment');
  const { user, status, sessionEpoch } = useSession();
  const queryClient = useQueryClient();
  const pollMutations = usePollMutations();
  const commentsQueryKey = paginationQueryKey({
    surface: 'comments', sessionEpoch, userId: user?.id ?? null, pollId,
  });
  const pollQuery = useQuery({ queryKey: ['poll', pollId], queryFn: ({ signal }) => fetchPollQuery(queryClient, user?.id ?? null, () => getPoll(pollId, signal), true, signal), enabled: Boolean(pollId) && status !== 'loading' });
  const commentTargetQuery = useQuery({
    queryKey: ['comment-target', pollId, focusedCommentId],
    queryFn: ({ signal }) => getComment(pollId, focusedCommentId ?? '', signal),
    enabled: Boolean(pollId && focusedCommentId),
  });
  const targetRootId = commentTargetQuery.data?.parentCommentId ?? null;
  const rootTargetQuery = useQuery({
    queryKey: ['comment-target', pollId, targetRootId],
    queryFn: ({ signal }) => getComment(pollId, targetRootId ?? '', signal),
    enabled: Boolean(pollId && focusedCommentId && targetRootId),
  });
  const focusedReplyId = targetRootId ? focusedCommentId : null;
  const resolvedRootComment = targetRootId ? rootTargetQuery.data : commentTargetQuery.data;
  const createMutation = useMutation({
    mutationFn: ({ body }: { body: string; epoch: number }) => createComment(pollId, body),
    onSuccess: ({ comment, poll }, { epoch }) => {
      if (pollSessionEpoch(queryClient) !== epoch) return;
      const cached = queryClient.getQueryData<InfiniteData<ClientCursorPage<PollComment>, string | null>>(commentsQueryKey);
      if (cached) {
        const alreadyPresent = cached.pages.some((page) => page.items.some((item) => item.id === comment.id));
        queryClient.setQueryData<InfiniteData<ClientCursorPage<PollComment>, string | null>>(commentsQueryKey, {
          ...cached,
          pages: cached.pages.map((page, index) => {
            if (page.items.some((item) => item.id === comment.id)) {
              return { ...page, items: page.items.map((item) => item.id === comment.id ? comment : item) };
            }
            return index === 0 && !alreadyPresent ? { ...page, items: [comment, ...page.items] } : page;
          }),
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: commentsQueryKey, exact: true });
      }
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
          focusedCommentId={focusedReplyId ? null : focusedCommentId}
          focusedReplyId={focusedReplyId}
          forcedExpandedRootId={targetRootId}
          resolvedRootComment={resolvedRootComment}
          onReplyCreated={(poll) => replaceCachedPoll(queryClient, poll, user?.id ?? null)}
        /> : null}
      </section>
      {pollQuery.isError && pollQuery.data ? <AsyncState state="error" error={pollQuery.error} onRetry={() => void pollQuery.refetch()} /> : null}{pollQuery.isFetching && pollQuery.data ? <AsyncState state="refreshing" kind="poll" /> : null}
    </main>
  );
}
