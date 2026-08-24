import {
  blockUser as blockUserRecord,
  deleteAdminComment as deleteAdminCommentRecord,
  deleteAdminPoll as deleteAdminPollRecord,
  getAdminPoll as getAdminPollRecord,
  listAdminPolls as listAdminPollsRecord
} from './admin.repository.js';
import {
  changeUserRole as changeUserRoleRecord,
  deleteAdminUser as deleteAdminUserRecord,
  getAdminUser as getAdminUserRecord,
  listAdminUsers as listAdminUsersRecord,
  unblockUser as unblockUserRecord
} from './admin.users.repository.js';
import type { UserRole, UserStatus } from '../auth/auth.repository.js';

export class AdminUserNotFoundError extends Error {}
export class AdminSelfActionError extends Error {}
export class AdminProtectedUserError extends Error {}
export class AdminLastSuperadminError extends Error {}
export class AdminPollNotFoundError extends Error {}
export class AdminCommentNotFoundError extends Error {}

type UserAudit = {
  actorRole: UserRole;
  reason: string;
  requestId?: string;
};

function userMutationError(status: string): never | undefined {
  if (status === 'not_found') throw new AdminUserNotFoundError('User was not found.');
  if (status === 'self') throw new AdminSelfActionError('You cannot modify your own account.');
  if (status === 'protected') throw new AdminProtectedUserError('This user cannot be modified.');
  if (status === 'last_superadmin') throw new AdminLastSuperadminError('At least one active superadmin must remain.');
}

export async function listAdminUsers(input: {
  limit: number;
  offset: number;
  query?: string;
  status?: UserStatus | 'all';
  role?: UserRole | 'all';
}) {
  return listAdminUsersRecord(input);
}

export async function getAdminUser(userId: string) {
  const user = await getAdminUserRecord(userId);
  if (!user) throw new AdminUserNotFoundError('User was not found.');
  return user;
}

export async function unblockUser(actorId: string, targetUserId: string, audit: UserAudit) {
  const result = await unblockUserRecord(actorId, targetUserId, { actorUserId: actorId, ...audit });
  userMutationError(result.status);
  return { status: result.status, userId: targetUserId };
}

export async function deleteAdminUser(actorId: string, targetUserId: string, audit: UserAudit) {
  const result = await deleteAdminUserRecord(actorId, targetUserId, { actorUserId: actorId, ...audit });
  userMutationError(result.status);
  return { status: result.status, userId: targetUserId };
}

export async function changeUserRole(actorId: string, targetUserId: string, role: UserRole, audit: UserAudit) {
  const result = await changeUserRoleRecord(actorId, targetUserId, role, { actorUserId: actorId, ...audit });
  userMutationError(result.status);
  return { status: result.status, userId: targetUserId, role };
}

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
