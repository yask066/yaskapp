-- Deliberately no FK to users: receipts and unfinished cleanup survive identity removal.
CREATE TABLE IF NOT EXISTS account_deletion_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'pending', 'processing', 'retrying', 'completed')),
  accepted_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner UUID,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CHECK (
    (status = 'not_started' AND accepted_at IS NULL AND deadline_at IS NULL AND completed_at IS NULL)
    OR (status <> 'not_started' AND accepted_at IS NOT NULL AND deadline_at IS NOT NULL
        AND deadline_at >= accepted_at
        AND ((status = 'completed' AND completed_at IS NOT NULL AND completed_at >= accepted_at)
             OR (status <> 'completed' AND completed_at IS NULL)))
  ),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_one_prepared_per_user_idx
  ON account_deletion_operations (user_id) WHERE status = 'not_started';
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_one_unfinished_per_user_idx
  ON account_deletion_operations (user_id) WHERE status IN ('pending', 'processing', 'retrying');
CREATE INDEX IF NOT EXISTS account_deletion_operations_user_idx
  ON account_deletion_operations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_deletion_operations_work_idx
  ON account_deletion_operations (available_at, created_at)
  WHERE status IN ('pending', 'processing', 'retrying');

-- No raw credentials or arbitrary metadata. Scopes are independent bearer capabilities.
CREATE TABLE IF NOT EXISTS account_deletion_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES account_deletion_operations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('delete', 'status')),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operation_id, scope),
  CHECK (scope = 'delete' OR consumed_at IS NULL)
);

CREATE TABLE IF NOT EXISTS account_deletion_steps (
  operation_id UUID NOT NULL REFERENCES account_deletion_operations(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL CHECK (step_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  position INTEGER NOT NULL CHECK (position >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retrying', 'completed')),
  cursor_id UUID,
  processed_count BIGINT NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code TEXT CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, step_key),
  UNIQUE (operation_id, position),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

-- Private work list: the owner must match the operation, not a caller-provided user.
CREATE TABLE IF NOT EXISTS account_deletion_media_manifest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  object_key TEXT NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 1024),
  version_id TEXT CHECK (char_length(version_id) BETWEEN 1 AND 1024),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'completed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error_code TEXT CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, owner_user_id)
    REFERENCES account_deletion_operations(id, user_id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (operation_id, object_key, version_id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS account_deletion_manifest_work_idx
  ON account_deletion_media_manifest (operation_id, available_at) WHERE status <> 'completed';

-- Transactional outbox. Insert with acceptance; delivery is observable only after commit.
CREATE TABLE IF NOT EXISTS account_deletion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES account_deletion_operations(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL CHECK (event_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner UUID,
  lease_until TIMESTAMPTZ,
  last_error_code TEXT CHECK (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operation_id, event_key),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS account_deletion_events_work_idx
  ON account_deletion_events (available_at, created_at) WHERE delivered_at IS NULL;
