ALTER TABLE admin_audit_log
  DROP CONSTRAINT admin_audit_log_action_check;

ALTER TABLE admin_audit_log
  ADD CONSTRAINT admin_audit_log_action_check CHECK (
    action IN (
      'user.blocked',
      'user.unblocked',
      'user.role_changed',
      'user.deleted',
      'poll.deleted_by_admin',
      'comment.deleted_by_admin',
      'moderation.case_assigned',
      'moderation.case_taken_over',
      'moderation.note_added',
      'moderation.case_resolved',
      'moderation.case_dismissed',
      'moderation.case_escalated'
    )
  );

CREATE TABLE moderation_case_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT moderation_case_notes_body_length_check CHECK (char_length(body) BETWEEN 1 AND 4000)
);

CREATE INDEX moderation_case_notes_case_created_idx
  ON moderation_case_notes (case_id, created_at ASC, id ASC);
