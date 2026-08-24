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

export type PollComment = {
  id: string;
  pollId: string;
  author: PollAuthor;
  body: string;
  likesCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ListPollCommentsResponse = {
  items: PollComment[];
};

export type CreatePollCommentRequest = {
  body: string;
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
  imageObjectKey: string | null;
  visibility: PollVisibility;
  optionsCount: number;
  votesCount: number;
  commentsCount: number;
  likesCount: number;
  allowVoteCancellation: boolean;
  viewerHasLiked: boolean;
  viewerVoteOptionId: string | null;
  createdAt: string;
  updatedAt: string;
  endsAt: string | null;
};

export type CreatePollRequest = {
  question: string;
  description?: string;
  options: string[];
  imageObjectKey?: string;
  visibility?: PollVisibility;
  endsAt?: string;
  allowVoteCancellation?: boolean;
};

export type CreatePollResponse = {
  poll: Poll;
};

export type ListPollsResponse = {
  items: Poll[];
};

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

export type RealtimeEvent =
  | {
      type: 'poll.vote.created';
      payload: {
        poll: Omit<Poll, 'viewerVoteOptionId'>;
        vote: {
          pollId: string;
          optionId: string;
          votesCount: number;
        };
      };
    }
  | {
      type: 'poll.vote.updated';
      payload: {
        poll: Omit<Poll, 'viewerVoteOptionId'>;
      };
    }
  | {
      type: 'connection.ready';
    }
  | {
      type: 'poll.deleted';
      payload: {
        pollId: string;
      };
    };
