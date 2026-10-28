-- Minimal case identifiers may remain linked to an accepted deletion for 30 days.
-- This table contains no user text or credentials and expires independently of
-- the 35-day operation receipt/journal.
CREATE TABLE IF NOT EXISTS account_deletion_moderation_identifiers (
  operation_id UUID NOT NULL REFERENCES account_deletion_operations(id) ON DELETE CASCADE,
  moderation_case_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, moderation_case_id)
);

CREATE INDEX IF NOT EXISTS account_deletion_moderation_identifiers_expiry_idx
  ON account_deletion_moderation_identifiers (expires_at);

CREATE INDEX IF NOT EXISTS account_deletion_completed_retention_idx
  ON account_deletion_operations (accepted_at)
  WHERE status = 'completed';

ALTER TABLE account_deletion_operations
  ADD COLUMN IF NOT EXISTS retry_started_at TIMESTAMPTZ;

UPDATE account_deletion_operations
SET retry_started_at = updated_at
WHERE status = 'retrying' AND retry_started_at IS NULL;

-- These are only polls/comments owned by the account and scheduled for deletion.
-- account_deletion_content_targets also contains surviving recount targets, so it
-- cannot safely be used to verify polymorphic references to deleted content.
CREATE TABLE IF NOT EXISTS account_deletion_deleted_content_targets (
  operation_id UUID NOT NULL REFERENCES account_deletion_operations(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('poll', 'comment')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS account_deletion_deleted_content_targets_lookup_idx
  ON account_deletion_deleted_content_targets (target_type, target_id);

CREATE TABLE IF NOT EXISTS account_deletion_counter_targets (
  operation_id UUID NOT NULL REFERENCES account_deletion_operations(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('poll', 'comment', 'profile')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS account_deletion_counter_targets_lookup_idx
  ON account_deletion_counter_targets (operation_id, target_type, target_id);

ALTER TABLE account_deletion_media_manifest
  ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ;
