CREATE TABLE IF NOT EXISTS account_deletion_content_targets (
  operation_id UUID NOT NULL REFERENCES account_deletion_operations(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('poll', 'comment')),
  target_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS account_deletion_content_targets_lookup_idx
  ON account_deletion_content_targets (operation_id, target_type, target_id);
