import {
  createReport as createReportRecord,
  listModerationCases as listModerationCasesRecord,
  type ModerationCasePriority,
  type ModerationCaseStatus,
  type ReportCategory,
  type ReportTargetType
} from './moderation.repository.js';

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
