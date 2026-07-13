import {
  createPollRecord,
  createVoteRecord,
  listPublicPollRecords
} from './polls.repository.js';
import type { PollVisibility } from './polls.repository.js';

export class PollNotFoundError extends Error {}

export class PollClosedError extends Error {}

export class PollAlreadyVotedError extends Error {}

export type CreatePollInput = {
  authorId: string;
  question: string;
  description?: string;
  options: string[];
  imageObjectKey?: string;
  visibility?: PollVisibility;
  endsAt?: string;
};

export type CreateVoteInput = {
  pollId: string;
  optionId: string;
  voterId: string;
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
    endsAt: input.endsAt ? new Date(input.endsAt) : undefined
  });
}

export async function listPublicPolls(limit: number) {
  return listPublicPollRecords(limit);
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
