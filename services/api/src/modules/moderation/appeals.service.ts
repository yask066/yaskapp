import {
  createAppeal as createAppealRecord,
  listAppeals as listAppealsRecord,
  resolveAppeal as resolveAppealRecord,
  type AppealStatus
} from './appeals.repository.js';
import type { UserRole } from '../auth/auth.repository.js';

export function createAppeal(input: { sanctionId: string; userId: string; reason: string; idempotencyKey: string; fingerprint: string }) {
  return createAppealRecord(input);
}

export function listAppeals(input: { status?: AppealStatus; limit: number; cursor?: string }) {
  return listAppealsRecord(input);
}

export function resolveAppeal(input: {
  appealId: string;
  actorUserId: string;
  actorRole: UserRole;
  status: Exclude<AppealStatus, 'open'>;
  decisionNote: string;
  idempotencyKey: string;
  fingerprint: string;
}) {
  return resolveAppealRecord(input);
}
