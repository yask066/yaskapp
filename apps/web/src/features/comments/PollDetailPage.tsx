import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { createComment, getPoll } from '../../api/polls';
import type { PollComment } from '../../api/models';
import { useSession } from '../../app/session-provider';
import { AsyncState } from '../../components/AsyncState';
import { PollCard } from '../../components/PollCard';
import { replaceCachedPoll, usePollMutations } from '../polls/usePollMutations';
import { CommentForm } from './CommentForm';
import { CommentList } from './CommentList';

export function PollDetailPage() {
  const { pollId = '' } = useParams();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const pollMutations = usePollMutations();
  const pollQuery = useQuery({ queryKey: ['poll', pollId], queryFn: () => getPoll(pollId), enabled: Boolean(pollId) });
  const createMutation = useMutation({
    mutationFn: (body: string) => createComment(pollId, body),
    onSuccess: ({ comment, poll }) => {
      queryClient.setQueryData<PollComment[]>(['comments', pollId], (cached = []) => [comment, ...cached]);
      replaceCachedPoll(queryClient, poll);
    },
  });

  return (
    <main id="main-content">
      {pollQuery.isPending ? <AsyncState state="loading" /> : null}
      {pollQuery.isError ? <AsyncState state="error" error={pollQuery.error} onRetry={() => void pollQuery.refetch()} /> : null}
      {pollQuery.data ? <PollCard poll={pollQuery.data} viewerId={user?.id} onVote={user ? (id, optionId) => pollMutations.vote({ pollId: id, optionId }) : undefined} onCancelVote={user ? pollMutations.cancelVote : undefined} onLike={user ? (id, viewerHasLiked) => pollMutations.toggleLike({ pollId: id, viewerHasLiked }) : undefined} onDelete={user ? pollMutations.deletePoll : undefined} /> : null}
      <section aria-labelledby="comments-heading">
        <h1 id="comments-heading">Comments</h1>
        {user ? <CommentForm onSubmit={async (body) => { await createMutation.mutateAsync(body); }} /> : <Link to={`/login?next=${encodeURIComponent(`/polls/${pollId}`)}`}>Login</Link>}
        {pollId ? <CommentList pollId={pollId} currentUserId={user?.id} /> : null}
      </section>
    </main>
  );
}
