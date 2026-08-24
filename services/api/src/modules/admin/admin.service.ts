import {
  blockUser as blockUserRecord,
  deleteAdminComment as deleteAdminCommentRecord,
  deleteAdminPoll as deleteAdminPollRecord,
  getAdminPoll as getAdminPollRecord,
  listAdminPolls as listAdminPollsRecord
} from './admin.repository.js';

export class AdminUserNotFoundError extends Error {}
export class AdminSelfActionError extends Error {}
export class AdminProtectedUserError extends Error {}
export class AdminPollNotFoundError extends Error {}
export class AdminCommentNotFoundError extends Error {}

export async function blockUser(
  actorId: string,
  targetUserId: string,
  audit: { actorRole: 'user' | 'moderator' | 'superadmin'; reason: string; requestId?: string }
) {
  const result = await blockUserRecord(actorId, targetUserId, audit);

  if (result.status === 'not_found') {
    throw new AdminUserNotFoundError('User was not found.');
  }

  if (result.status === 'self') {
    throw new AdminSelfActionError('You cannot block your own account.');
  }

  if (result.status === 'protected') {
    throw new AdminProtectedUserError('This user cannot be blocked.');
  }

  return {
    status: result.status,
    userId: targetUserId
  };
}

export async function listAdminPolls(input: {
  limit: number;
  offset: number;
  query?: string;
  status?: 'active' | 'deleted' | 'all';
  authorId?: string;
}) {
  return listAdminPollsRecord(input);
}

export async function getAdminPoll(pollId: string) {
  const poll = await getAdminPollRecord(pollId);

  if (!poll) {
    throw new AdminPollNotFoundError('Poll was not found.');
  }

  return poll;
}

export async function deleteAdminPoll(input: {
  pollId: string;
  actorUserId: string;
  actorRole: 'user' | 'moderator' | 'superadmin';
  reason: string;
  requestId?: string;
}) {
  const { pollId, ...audit } = input;
  const result = await deleteAdminPollRecord(pollId, audit);

  if (result.status === 'not_found') {
    throw new AdminPollNotFoundError('Poll was not found.');
  }

  return result.status;
}

export async function deleteAdminComment(input: {
  commentId: string;
  actorUserId: string;
  actorRole: 'user' | 'moderator' | 'superadmin';
  reason: string;
  requestId?: string;
}) {
  const { commentId, ...audit } = input;
  const result = await deleteAdminCommentRecord(commentId, audit);

  if (result.status === 'not_found') {
    throw new AdminCommentNotFoundError('Comment was not found.');
  }

  return result;
}
