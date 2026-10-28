-- Application-owned moderation retention. These snapshots deliberately have
-- no foreign key to users or deletion operations, which are physically purged.
CREATE FUNCTION normalize_account_ip(value INET) RETURNS INET
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE WHEN value <<= '::ffff:0.0.0.0/96'::inet
    THEN '0.0.0.0'::inet + (value - '::ffff:0.0.0.0'::inet)
    ELSE value END
$$;

CREATE TABLE account_ip_history (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip INET NOT NULL CHECK (masklen(ip) IN (32, 128)),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ip)
);
CREATE INDEX account_ip_history_expiry_idx ON account_ip_history (last_seen_at);

CREATE TABLE deleted_account_archives (
  user_id UUID PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('self_service', 'admin')),
  deleted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  profile JSONB NOT NULL,
  ips JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (expires_at > deleted_at)
);
CREATE INDEX deleted_account_archives_expiry_idx ON deleted_account_archives (expires_at);
CREATE INDEX deleted_account_archives_pagination_idx ON deleted_account_archives (deleted_at DESC, user_id DESC);

CREATE TABLE deleted_account_archive_access (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  archived_user_id UUID NOT NULL REFERENCES deleted_account_archives(user_id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'ip_ban')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bans intentionally outlive the archive. Do not retain profile snapshots,
-- archived account IDs or session credentials in this table or its audit log.
CREATE TABLE platform_ip_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip INET NOT NULL CHECK (masklen(ip) IN (32, 128)),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX platform_ip_bans_active_ip_idx ON platform_ip_bans (ip) WHERE revoked_at IS NULL;
CREATE TABLE platform_ip_ban_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ban_id UUID NOT NULL REFERENCES platform_ip_bans(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'revoked')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
