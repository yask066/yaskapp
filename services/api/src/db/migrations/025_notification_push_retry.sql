ALTER TABLE notification_push_jobs
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE notification_push_jobs
  DROP CONSTRAINT IF EXISTS notification_push_jobs_max_attempts_check;

ALTER TABLE notification_push_jobs
  ADD CONSTRAINT notification_push_jobs_max_attempts_check
  CHECK (max_attempts BETWEEN 1 AND 20);

UPDATE notification_push_jobs
SET claimed_at = now() - interval '2 minutes'
WHERE status = 'sending' AND claimed_at IS NULL;

CREATE INDEX IF NOT EXISTS notification_push_jobs_recovery_idx
  ON notification_push_jobs (claimed_at)
  WHERE status = 'sending';
