import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useReducer } from 'react';
import { cancelVote as cancelPollVote, deletePoll as deletePollRequest, likePoll, unlikePoll, vote as votePoll } from '../../api/polls';
import type { Poll } from '../../api/models';
import { ApiError } from '../../api/client';
import { beginPollOperation, deleteCachedPoll, finishPollOperation, ingestPoll, isPollOperationPending, pollSessionEpoch } from './poll-state';
import { useOptionalSession } from '../../app/session-provider';

export function replaceCachedPoll(queryClient: ReturnType<typeof useQueryClient>, poll: Poll, viewerId: string | null = null) {
  ingestPoll(queryClient, poll, 'mutation', viewerId);
}

export function removeCachedPoll(queryClient: ReturnType<typeof useQueryClient>, pollId: string) {
  deleteCachedPoll(queryClient, pollId);
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
  const session = useOptionalSession();
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const epoch = pollSessionEpoch(queryClient);
  const viewerId = session?.user?.id ?? null;
  type OperationRequest = { pollId: string; token: string; epoch: number; run: () => Promise<Poll> };
  const operationCallbacks = (action: 'vote' | 'like') => ({
    mutationFn: (request: OperationRequest) => request.run(),
    onSuccess: (poll: Poll, request: OperationRequest) => { if (pollSessionEpoch(queryClient) === request.epoch) ingestPoll(queryClient, poll, 'mutation', viewerId ?? '__mutation_viewer__', request.epoch); },
    onSettled: (_data: Poll | undefined, _error: Error | null, request: OperationRequest) => { finishPollOperation(queryClient, request.pollId, action, request.token); rerender(); },
  });
  const voteMutation = useMutation(operationCallbacks('vote'));
  const likeMutation = useMutation(operationCallbacks('like'));
  const deleteMutation = useMutation({
    mutationFn: ({ pollId }: { pollId: string; epoch: number }) => deletePollRequest(pollId),
    onSuccess: (_, { pollId, epoch: requestEpoch }) => { if (pollSessionEpoch(queryClient) === requestEpoch) removeCachedPoll(queryClient, pollId); },
  });
  const error = [voteMutation.error, likeMutation.error, deleteMutation.error].find(Boolean);

  const runAction = useCallback((action: 'vote' | 'like', pollId: string, run: () => Promise<Poll>) => {
    const token = beginPollOperation(queryClient, pollId, action);
    if (!token) return;
    const operationEpoch = pollSessionEpoch(queryClient);
    rerender();
    const mutation = action === 'vote' ? voteMutation : likeMutation;
    mutation.mutate({ pollId, token, epoch: operationEpoch, run });
  }, [likeMutation, queryClient, voteMutation]);

  return {
    vote: ({ pollId, optionId }: { pollId: string; optionId: string }) => runAction('vote', pollId, () => votePoll(pollId, optionId)),
    cancelVote: (pollId: string) => runAction('vote', pollId, () => cancelPollVote(pollId)),
    toggleLike: ({ pollId, viewerHasLiked }: { pollId: string; viewerHasLiked: boolean }) => runAction('like', pollId, () => viewerHasLiked ? unlikePoll(pollId) : likePoll(pollId)),
    deletePoll: (pollId: string) => deleteMutation.mutate({ pollId, epoch }),
    isVoting: (pollId: string) => isPollOperationPending(queryClient, pollId, 'vote'),
    isLiking: (pollId: string) => isPollOperationPending(queryClient, pollId, 'like'),
    isPending: voteMutation.isPending || likeMutation.isPending || deleteMutation.isPending,
    error: error ? mutationErrorMessage(error) : null,
  };
}
