import { apiClient } from './client';
import { decodePoll, decodePollComment, responseField, responseItems, type Poll, type PollComment } from './models';

export function listPolls(input: { sort?: 'newest' | 'popular'; limit?: number } = {}): Promise<Poll[]> {
  const params = new URLSearchParams({ limit: String(input.limit ?? 20) });
  if (input.sort && input.sort !== 'newest') params.set('sort', input.sort);
  return apiClient.get(`/polls?${params}`, (body) => responseItems(body, decodePoll));
}

export function createPoll(input: { question: string; options: string[]; allowVoteCancellation: boolean; image?: File }): Promise<Poll> {
  const body = input.image ? createPollFormData(input) : JSON.stringify(input);
  return apiClient.send('/polls', { method: 'POST', ...(input.image ? {} : { headers: { 'content-type': 'application/json' } }), body }, (value) => responseField(value, 'poll', decodePoll));
}

function createPollFormData(input: { question: string; options: string[]; allowVoteCancellation: boolean; image?: File }): FormData {
  const formData = new FormData();
  formData.set('question', input.question);
  formData.set('options', JSON.stringify(input.options));
  formData.set('allowVoteCancellation', String(input.allowVoteCancellation));
  if (input.image) formData.set('image', input.image);
  return formData;
}

export function vote(pollId: string, optionId: string): Promise<Poll> {
  return apiClient.send(`/polls/${pollId}/votes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId }) }, (value) => responseField(value, 'poll', decodePoll));
}

export function cancelVote(pollId: string): Promise<Poll> {
  return apiClient.send(`/polls/${pollId}/votes`, { method: 'DELETE' }, (value) => responseField(value, 'poll', decodePoll));
}

export function likePoll(pollId: string): Promise<Poll> {
  return apiClient.send(`/polls/${pollId}/likes`, { method: 'POST' }, (value) => responseField(value, 'poll', decodePoll));
}

export function unlikePoll(pollId: string): Promise<Poll> {
  return apiClient.send(`/polls/${pollId}/likes`, { method: 'DELETE' }, (value) => responseField(value, 'poll', decodePoll));
}

export function deletePoll(pollId: string): Promise<void> {
  return apiClient.send(`/polls/${pollId}`, { method: 'DELETE' }, () => undefined);
}

export function listComments(pollId: string): Promise<PollComment[]> {
  return apiClient.get(`/polls/${pollId}/comments?limit=50`, (body) => responseItems(body, decodePollComment));
}
