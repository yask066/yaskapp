import {
  addModerationNote as addModerationNoteRecord,
  assignModerationCase as assignModerationCaseRecord,
  createReport as createReportRecord,
  getModerationCase as getModerationCaseRecord,
  listModerationCases as listModerationCasesRecord,
  takeoverModerationCase as takeoverModerationCaseRecord,
  transitionModerationCase as transitionModerationCaseRecord,
  type ModerationCasePriority,
  type ModerationCaseStatus,
  type ReportCategory,
  type ReportTargetType
} from './moderation.repository.js';
import type { UserRole } from '../auth/auth.repository.js';

export async function createReport(input: {
  reporterUserId: string;
  targetType: ReportTargetType;
  targetId: string;
  category: ReportCategory;
  description: string;
}) {
  return createReportRecord(input);
}

export async function listModerationCases(input: {
  status?: ModerationCaseStatus;
  category?: ReportCategory;
  priority?: ModerationCasePriority;
  assigneeId?: string;
  targetType?: ReportTargetType;
  limit: number;
  cursor?: string;
}) {
  return listModerationCasesRecord(input);
}

export function getModerationCase(caseId: string) {
  return getModerationCaseRecord(caseId);
}

export function assignModerationCase(caseId: string, actorUserId: string, actorRole: UserRole) {
  return assignModerationCaseRecord(caseId, actorUserId, actorRole);
}

export function takeoverModerationCase(caseId: string, actorUserId: string, actorRole: UserRole) {
  return takeoverModerationCaseRecord(caseId, actorUserId, actorRole);
}

export function transitionModerationCase(caseId: string, actorUserId: string, actorRole: UserRole, action: 'resolve' | 'dismiss' | 'escalate', input: { resolutionCode?: string; note?: string }) {
  return transitionModerationCaseRecord(caseId, actorUserId, actorRole, action, input);
}

export function addModerationNote(caseId: string, authorUserId: string, actorRole: UserRole, body: string) {
  return addModerationNoteRecord(caseId, authorUserId, actorRole, body);
}
