export type PollVisibility = 'public' | 'followers' | 'private';

export type PollAuthor = {
  id: string;
  username: string;
  displayName: string;
  avatarObjectKey: string | null;
};

export type PollOption = {
  id: string;
  text: string;
  position: number;
  votesCount: number;
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
        pollId: string;
        optionId: string;
        votesCount: number;
      };
    }
  | {
      type: 'connection.ready';
    };
