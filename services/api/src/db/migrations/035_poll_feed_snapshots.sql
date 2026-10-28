CREATE TABLE poll_feed_snapshots (
  id UUID PRIMARY KEY,
  owner_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT poll_feed_snapshots_owner_key_format_check
    CHECK (owner_key ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT poll_feed_snapshots_fixed_ttl_check
    CHECK (expires_at = created_at + INTERVAL '30 minutes'),
  CONSTRAINT poll_feed_snapshots_created_before_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX poll_feed_snapshots_owner_created_idx
  ON poll_feed_snapshots (owner_key, created_at DESC, id DESC);

CREATE INDEX poll_feed_snapshots_expiry_idx
  ON poll_feed_snapshots (expires_at);

CREATE TABLE poll_feed_snapshot_items (
  snapshot_id UUID NOT NULL REFERENCES poll_feed_snapshots(id) ON DELETE CASCADE,
  position BIGINT NOT NULL CHECK (position >= 0),
  -- No poll foreign key: soft-deleted or purged polls keep their saved rank position.
  poll_id UUID NOT NULL,
  PRIMARY KEY (snapshot_id, position),
  CONSTRAINT poll_feed_snapshot_items_poll_unique UNIQUE (snapshot_id, poll_id)
);
