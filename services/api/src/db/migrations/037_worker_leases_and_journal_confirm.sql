ALTER TABLE notification_push_jobs
  ADD COLUMN IF NOT EXISTS lease_owner UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_push_jobs_attempts_nonnegative'
  ) THEN
    ALTER TABLE notification_push_jobs
      ADD CONSTRAINT notification_push_jobs_attempts_nonnegative CHECK (attempts >= 0);
  END IF;
END $$;

ALTER TABLE account_deletion_operations
  ADD COLUMN IF NOT EXISTS journal_confirmed_at TIMESTAMPTZ;
