ALTER TABLE admin_audit_log
  DROP CONSTRAINT admin_audit_log_target_type_check;

ALTER TABLE admin_audit_log
  ADD CONSTRAINT admin_audit_log_target_type_check CHECK (
    target_type IN ('user', 'poll', 'comment', 'case')
  );
