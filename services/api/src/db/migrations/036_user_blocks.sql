CREATE TABLE user_blocks (
  blocker_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX user_blocks_blocked_user_idx
  ON user_blocks (blocked_user_id, blocker_user_id);

CREATE INDEX user_blocks_owner_list_idx
  ON user_blocks (blocker_user_id, created_at DESC, blocked_user_id);

CREATE TABLE user_visibility_revisions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_suppressions (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, recipient_user_id)
);

CREATE INDEX notification_suppressions_recipient_idx
  ON notification_suppressions (recipient_user_id, notification_id);

CREATE TABLE user_blocks_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('user_blocks.changed', 'viewer.visibility_invalidated')
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_owner UUID,
  lease_until TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);

CREATE INDEX user_blocks_outbox_work_idx
  ON user_blocks_outbox (available_at, created_at)
  WHERE delivered_at IS NULL;
