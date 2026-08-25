import type { FastifyReply, FastifyRequest } from 'fastify';

import type { UserRole } from './auth.repository.js';

export const ADMIN_PERMISSIONS = [
  'admin.users.read',
  'admin.users.block',
  'admin.users.unblock',
  'admin.users.delete',
  'admin.users.roles.read',
  'admin.users.roles.update',
  'admin.polls.read',
  'admin.polls.delete',
  'admin.comments.delete',
  'admin.audit.read'
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const MODERATION_PERMISSIONS = [
  'moderation.queue.read',
  'moderation.case.read',
  'moderation.case.assign',
  'moderation.case.resolve',
  'moderation.content.delete',
  'moderation.warning.issue',
  'moderation.strike.issue',
  'moderation.restriction.issue',
  'moderation.user.ban',
  'moderation.permanent_ban.issue',
  'moderation.appeal.read',
  'moderation.appeal.resolve',
  'moderation.audit.read',
  'moderation.policy.read',
  'moderation.policy.update',
  'moderation.sanction.revoke'
] as const;

export type ModerationPermission = (typeof MODERATION_PERMISSIONS)[number];
export type Permission = AdminPermission | ModerationPermission;

const permissionsByRole: Record<UserRole, readonly AdminPermission[]> = {
  user: [],
  moderator: [
    'admin.users.read',
    'admin.users.block',
    'admin.users.unblock',
    'admin.polls.read',
    'admin.polls.delete',
    'admin.comments.delete'
  ],
  superadmin: ADMIN_PERMISSIONS
};

const moderationPermissionsByRole: Record<UserRole, readonly ModerationPermission[]> = {
  user: [],
  moderator: [
    'moderation.queue.read',
    'moderation.case.read',
    'moderation.case.assign',
    'moderation.case.resolve',
    'moderation.content.delete',
    'moderation.warning.issue',
    'moderation.strike.issue',
    'moderation.restriction.issue',
    'moderation.user.ban',
    'moderation.appeal.read',
    'moderation.sanction.revoke'
  ],
  superadmin: MODERATION_PERMISSIONS
};

export function permissionsForRole(role: string) {
  return permissionsByRole[role as UserRole] ?? [];
}

export function moderationPermissionsForRole(role: string) {
  return moderationPermissionsByRole[role as UserRole] ?? [];
}

export function hasPermission(role: string, permission: string) {
  return permissionsForRole(role).includes(permission as AdminPermission) ||
    moderationPermissionsForRole(role).includes(permission as ModerationPermission);
}

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await request.getCurrentUser();

    if (!user) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'Authentication is required.'
      });
    }

    if (!hasPermission(user.role, permission)) {
      return reply.status(403).send({
        error: 'forbidden',
        message: 'You do not have permission to perform this action.'
      });
    }
  };
}
