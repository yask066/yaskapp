export type AccountDeletionStatus =
  | 'not_started'
  | 'pending'
  | 'processing'
  | 'retrying'
  | 'completed';

export type AccountDeletionStatusResponse = {
  operationId: string;
  status: AccountDeletionStatus;
  acceptedAt: string | null;
  deadlineAt: string | null;
  completedAt: string | null;
};

export type AccountDeletionVerificationResponse = {
  operationId: string;
  status: 'not_started';
  deletionToken: string;
  statusToken: string;
  deletionTokenExpiresAt: string;
  statusTokenExpiresAt: string;
};
