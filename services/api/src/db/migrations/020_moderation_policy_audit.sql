ALTER TABLE admin_audit_log
  DROP CONSTRAINT admin_audit_log_action_check;

ALTER TABLE admin_audit_log
  ADD CONSTRAINT admin_audit_log_action_check CHECK (action IN (
    'user.blocked', 'user.unblocked', 'user.role_changed', 'user.deleted',
    'poll.deleted_by_admin', 'comment.deleted_by_admin',
    'moderation.case_assigned', 'moderation.case_taken_over', 'moderation.note_added',
    'moderation.case_resolved', 'moderation.case_dismissed', 'moderation.case_escalated',
    'moderation.sanction_issued', 'moderation.sanction_revoked', 'moderation.policy_evaluated',
    'moderation.policy_updated', 'moderation.permanent_ban_issued',
    'moderation.appeal_created', 'moderation.appeal_resolved'
  ));
