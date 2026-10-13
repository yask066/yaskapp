ALTER TABLE reports
  ALTER COLUMN target_id DROP NOT NULL;

ALTER TABLE moderation_cases
  ALTER COLUMN target_id DROP NOT NULL;

ALTER TABLE admin_audit_log
  ALTER COLUMN target_id DROP NOT NULL;
