import {
  listAdminAudit as listAdminAuditRecords
} from './audit.repository.js';
import type {
  AdminAuditAction,
  AdminAuditTargetType
} from './audit.repository.js';

export async function listAdminAudit(input: {
  action?: AdminAuditAction;
  actorId?: string;
  targetType?: AdminAuditTargetType;
  targetId?: string;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}) {
  return listAdminAuditRecords(input);
}
