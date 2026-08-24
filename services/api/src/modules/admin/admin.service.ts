import { blockUser as blockUserRecord } from './admin.repository.js';

export class AdminUserNotFoundError extends Error {}
export class AdminSelfActionError extends Error {}
export class AdminProtectedUserError extends Error {}

export async function blockUser(actorId: string, targetUserId: string) {
  const result = await blockUserRecord(actorId, targetUserId);

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
