import {
  getModerationPolicy as getModerationPolicyRecord,
  updateModerationPolicy as updateModerationPolicyRecord
} from './policy.repository.js';
import type { UserRole } from '../auth/auth.repository.js';

export function getModerationPolicy() {
  return getModerationPolicyRecord();
}

export function updateModerationPolicy(input: {
  actorUserId: string;
  actorRole: UserRole;
  reason: string;
  idempotencyKey: string;
  fingerprint: string;
  postingRestrictionStrikes: number;
  temporaryBanStrikes: number;
  strikeRetentionDays: number;
  defaultRestrictionHours: number;
  defaultTemporaryBanHours: number;
}) {
  return updateModerationPolicyRecord(input);
}
