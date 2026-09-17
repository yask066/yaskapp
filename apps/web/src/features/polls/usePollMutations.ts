import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cancelVote as cancelPollVote, deletePoll as deletePollRequest, likePoll, unlikePoll, vote as votePoll } from '../../api/polls';
import type { Poll } from '../../api/models';
import { ApiError } from '../../api/client';

export function replaceCachedPoll(queryClient: ReturnType<typeof useQueryClient>, poll: Poll) {
  [['polls'], ['user-polls']].forEach((queryKey) => queryClient.getQueryCache().findAll({ queryKey }).forEach((query) => {
    const cached = queryClient.getQueryData<Poll[]>(query.queryKey);
    if (Array.isArray(cached)) queryClient.setQueryData(query.queryKey, cached.map((item) => item.id === poll.id ? poll : item));
  }));
  if (queryClient.getQueryData(['poll', poll.id])) queryClient.setQueryData(['poll', poll.id], poll);
}

export function removeCachedPoll(queryClient: ReturnType<typeof useQueryClient>, pollId: string) {
  queryClient.getQueryCache().findAll({ queryKey: ['polls'] }).forEach((query) => {
    const cached = queryClient.getQueryData<Poll[]>(query.queryKey);
    if (Array.isArray(cached)) queryClient.setQueryData(query.queryKey, cached.filter((item) => item.id !== pollId));
  });
  queryClient.removeQueries({ queryKey: ['poll', pollId], exact: true });
}

export function mutationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'poll_closed') return 'This poll is closed. Voting changes are no longer available.';
    if (error.code === 'vote_cancellation_not_allowed') return 'The poll author does not allow vote cancellation.';
    return error.message;
  }
  return 'The request could not be completed.';
}

export function usePollMutations() {
  const queryClient = useQueryClient();
  const voteMutation = useMutation({
    mutationFn: ({ pollId, optionId }: { pollId: string; optionId: string }) => votePoll(pollId, optionId),
    onSuccess: (poll) => replaceCachedPoll(queryClient, poll),
  });
  const cancelVoteMutation = useMutation({
    mutationFn: (pollId: string) => cancelPollVote(pollId),
    onSuccess: (poll) => replaceCachedPoll(queryClient, poll),
  });
  const likeMutation = useMutation({
    mutationFn: ({ pollId, viewerHasLiked }: { pollId: string; viewerHasLiked: boolean }) => viewerHasLiked ? unlikePoll(pollId) : likePoll(pollId),
    onSuccess: (poll) => replaceCachedPoll(queryClient, poll),
  });
  const deleteMutation = useMutation({
    mutationFn: (pollId: string) => deletePollRequest(pollId),
    onSuccess: (_, pollId) => removeCachedPoll(queryClient, pollId),
  });
  const error = [voteMutation.error, cancelVoteMutation.error, likeMutation.error, deleteMutation.error].find(Boolean);

  return {
    vote: voteMutation.mutate,
    cancelVote: cancelVoteMutation.mutate,
    toggleLike: likeMutation.mutate,
    deletePoll: deleteMutation.mutate,
    isPending: voteMutation.isPending || cancelVoteMutation.isPending || likeMutation.isPending || deleteMutation.isPending,
    error: error ? mutationErrorMessage(error) : null,
  };
}
