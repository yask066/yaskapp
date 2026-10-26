import { memo } from 'react';
import type { Poll } from '../../api/models';
import { PollCard } from '../../components/PollCard';
import { EntryMotion } from '../../core/motion/EntryMotion';

export interface FeedPollItemProps {
  poll: Poll;
  contextKey: string;
  indexInBatch: number;
  viewerId?: string | null;
  isVoting?: boolean;
  isLiking?: boolean;
  onVote?: (pollId: string, optionId: string) => void;
  onCancelVote?: (pollId: string) => void;
  onLike?: (pollId: string, viewerHasLiked: boolean) => void;
  onDelete?: (pollId: string) => void;
  onOpenComments?: (poll: Poll) => void;
}

export const FeedPollItem = memo(function FeedPollItem({ poll, contextKey, indexInBatch, viewerId, isVoting, isLiking, onVote, onCancelVote, onLike, onDelete, onOpenComments }: FeedPollItemProps) {
  return <EntryMotion key={poll.id} contextKey={contextKey} itemId={poll.id} visible indexInBatch={indexInBatch}>
    <PollCard poll={poll} viewerId={viewerId} isVoting={isVoting} isLiking={isLiking} onVote={onVote} onCancelVote={onCancelVote} onLike={onLike} onDelete={onDelete} onOpenComments={onOpenComments} />
  </EntryMotion>;
});
