import {
  createPollCommentRecord,
  createPollRecord,
  cancelVoteRecord,
  createVoteRecord,
  setVoteRecord,
  likePollRecord,
  listPollCommentRecords,
  listPublicPollRecords,
  listSubscriptionPollRecords,
  unlikePollRecord
} from './polls.repository.js';
import type { PollVisibility } from './polls.repository.js';

export class PollNotFoundError extends Error {}

export class PollClosedError extends Error {}

export class PollAlreadyVotedError extends Error {}

export class PollCancellationNotAllowedError extends Error {}

export type CreatePollInput = {
  authorId: string;
  question: string;
  description?: string;
  options: string[];
  imageObjectKey?: string;
  visibility?: PollVisibility;
  endsAt?: string;
  allowVoteCancellation?: boolean;
};

export type CreateVoteInput = {
  pollId: string;
  optionId: string;
  voterId: string;
};

export type CancelVoteInput = {
  pollId: string;
  voterId: string;
};

export type LikePollInput = {
  pollId: string;
  userId: string;
};

export type UnlikePollInput = {
  pollId: string;
  userId: string;
};

export type ListPollCommentsInput = {
  pollId: string;
  limit: number;
};

export type CreatePollCommentInput = {
  pollId: string;
  authorId: string;
  body: string;
};

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}

export async function createPoll(input: CreatePollInput) {
  return createPollRecord({
    authorId: input.authorId,
    question: input.question.trim(),
    description: normalizeOptionalText(input.description),
    options: input.options.map((option) => option.trim()),
    imageObjectKey: normalizeOptionalText(input.imageObjectKey),
    visibility: input.visibility ?? 'public',
    allowVoteCancellation: input.allowVoteCancellation ?? false,
    endsAt: input.endsAt ? new Date(input.endsAt) : undefined
  });
}

export async function listPublicPolls(limit: number, viewerId?: string) {
  return listPublicPollRecords(limit, viewerId);
}

export async function listSubscriptionPolls(followerId: string, limit: number) {
  return listSubscriptionPollRecords(followerId, limit);
}

export async function listPollComments(input: ListPollCommentsInput) {
  const result = await listPollCommentRecords(input);

  if (result.status === 'not_found') {
    throw new PollNotFoundError('Poll was not found.');
  }

  return {
    items: result.items
  };
}

export async function createPollComment(input: CreatePollCommentInput) {
  const result = await createPollCommentRecord({
    pollId: input.pollId,
    authorId: input.authorId,
    body: input.body.trim()
  });

  if (result.status === 'not_found') {
    throw new PollNotFoundError('Poll was not found.');
  }

  if (!result.poll) {
    throw new Error('Updated poll could not be loaded.');
  }

  return {
    comment: result.comment,
    poll: result.poll
  };
}

export async function voteOnPoll(input: CreateVoteInput) {
  const result = await createVoteRecord(input);

  if (result.status === 'not_found') {
    throw new PollNotFoundError('Poll or option was not found.');
  }

  if (result.status === 'closed') {
    throw new PollClosedError('Poll is closed.');
  }

  if (result.status === 'already_voted') {
    throw new PollAlreadyVotedError('You have already voted in this poll.');
  }

  if (!result.poll) {
    throw new Error('Updated poll could not be loaded.');
  }

  return {
    poll: result.poll,
    vote: {
      pollId: input.pollId,
      optionId: input.optionId,
      votesCount: result.optionVotesCount
    }
  };
}

export async function cancelVote(input: CancelVoteInput) {
  const result = await cancelVoteRecord(input);

  if (result.status === 'not_found') {
    throw new PollNotFoundError('Poll was not found.');
  }

  if (result.status === 'closed') {
    throw new PollClosedError('Poll is closed.');
  }

  if (result.status === 'cancellation_not_allowed') {
    throw new PollCancellationNotAllowedError(
      'The poll author does not allow vote cancellation.'
    );
  }

  if (!result.poll) {
    throw new Error('Updated poll could not be loaded.');
  }

  return {
    poll: result.poll
  };
}

export async function setVote(input: CreateVoteInput) {
  const result = await setVoteRecord(input);

  if (result.status === 'not_found') {
    throw new PollNotFoundError('Poll or option was not found.');
  }

  if (result.status === 'closed') {
    throw new PollClosedError('Poll is closed.');
  }

  if (!result.poll) {
    throw new Error('Updated poll could not be loaded.');
  }

  return {
    poll: result.poll,
    operation: result.operation,
    vote: {
      pollId: input.pollId,
      optionId: input.optionId,
      votesCount: result.optionVotesCount
    }
  };
}

export async function likePoll(input: LikePollInput) {
  const result = await likePollRecord(input);

  if (result.status === 'not_found') {
    throw new PollNotFoundError('Poll was not found.');
  }

  if (!result.poll) {
    throw new Error('Updated poll could not be loaded.');
  }

  return {
    poll: result.poll
  };
}

export async function unlikePoll(input: UnlikePollInput) {
  const result = await unlikePollRecord(input);

  if (result.status === 'not_found') {
    throw new PollNotFoundError('Poll was not found.');
  }

  if (!result.poll) {
    throw new Error('Updated poll could not be loaded.');
  }

  return {
    poll: result.poll
  };
}
