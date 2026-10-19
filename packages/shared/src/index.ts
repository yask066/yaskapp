import type { CursorPage } from './pagination.js';

export type { CursorPage } from './pagination.js';

export type {
  AccountDeletionStatus,
  AccountDeletionStatusResponse,
  AccountDeletionVerificationResponse
} from './account-deletion.js';

export type PollVisibility = 'public' | 'followers' | 'private';

export type PollAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatarObjectKey: string | null;
  avatarUrl: string | null;
};

export type PollOption = {
  id: string;
  text: string;
  position: number;
  votesCount: number;
};

export type PollStateRevisions = {
  votes: string;
  likes: string;
  comments: string;
};

export type PollComment = {
  id: string;
  pollId: string;
  author: PollAuthor;
  body: string;
  likesCount: number;
  viewerHasLiked: boolean;
  parentCommentId: string | null;
  repliesCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ListPollCommentsResponse = CursorPage<PollComment>;
export type ListPollCommentRepliesResponse = CursorPage<PollComment>;

export type CreatePollCommentRequest = {
  body: string;
  parentCommentId?: string;
};

export type CreatePollCommentResponse = {
  comment: PollComment;
  poll: Poll;
};

export type Poll = {
  id: string;
  authorId: string;
  author: PollAuthor;
  question: string;
  description: string | null;
  options: PollOption[];
  imageUrl: string | null;
  visibility: PollVisibility;
  optionsCount: number;
  votesCount: number;
  commentsCount: number;
  likesCount: number;
  allowVoteCancellation: boolean;
  viewerHasLiked: boolean;
  viewerVoteOptionId: string | null;
  stateRevisions: PollStateRevisions;
  createdAt: string;
  updatedAt: string;
  endsAt: string | null;
};

export type CreatePollRequest = {
  question: string;
  description?: string;
  options: string[];
  visibility?: PollVisibility;
  endsAt?: string;
  allowVoteCancellation?: boolean;
};

export type CreatePollResponse = {
  poll: Poll;
};

export type ListPollsResponse = CursorPage<Poll>;

export type CreatePollVoteRequest = {
  optionId: string;
};

export type CreatePollVoteResponse = {
  poll: Poll;
  vote: {
    pollId: string;
    optionId: string;
    votesCount: number;
  };
};

export type {
  NotificationItem,
  NotificationListResponse,
  NotificationRealtimeEventV1,
  NotificationTargetType,
  NotificationType,
  RealtimeEvent
} from './notifications.js';
