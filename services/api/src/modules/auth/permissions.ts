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

export function permissionsForRole(role: string) {
  return permissionsByRole[role as UserRole] ?? [];
}

export function hasPermission(role: string, permission: string) {
  return permissionsForRole(role).includes(permission as AdminPermission);
}

export function requirePermission(permission: AdminPermission) {
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
