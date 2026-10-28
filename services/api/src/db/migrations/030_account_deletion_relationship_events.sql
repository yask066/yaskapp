CREATE TABLE IF NOT EXISTS account_deletion_relationship_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES account_deletion_operations(id) ON DELETE CASCADE,
  poll_id UUID NOT NULL,
  event_payload JSONB NOT NULL,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner UUID,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operation_id, poll_id),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);

CREATE INDEX IF NOT EXISTS account_deletion_relationship_events_work_idx
  ON account_deletion_relationship_events (available_at, created_at)
  WHERE delivered_at IS NULL;
