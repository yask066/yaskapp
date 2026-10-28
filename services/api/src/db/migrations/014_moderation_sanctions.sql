ALTER TABLE users
  ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE sanctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  case_id UUID REFERENCES moderation_cases(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sanctions_type_check CHECK (type IN (
    'warning', 'strike', 'posting_restriction', 'comment_restriction', 'temporary_ban'
  )),
  CONSTRAINT sanctions_status_check CHECK (status IN ('active', 'expired', 'revoked')),
  CONSTRAINT sanctions_reason_length_check CHECK (char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT sanctions_dates_check CHECK (expires_at IS NULL OR expires_at > starts_at),
  CONSTRAINT sanctions_revoked_check CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL) OR status <> 'revoked'
  )
);

CREATE INDEX sanctions_active_user_idx
  ON sanctions (user_id, type, expires_at)
  WHERE status = 'active';
CREATE INDEX sanctions_case_idx ON sanctions (case_id, created_at DESC);

CREATE TABLE user_strikes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  case_id UUID REFERENCES moderation_cases(id) ON DELETE SET NULL,
  sanction_id UUID NOT NULL UNIQUE REFERENCES sanctions(id) ON DELETE RESTRICT,
  severity SMALLINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_strikes_severity_check CHECK (severity BETWEEN 1 AND 3),
  CONSTRAINT user_strikes_status_check CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE INDEX user_strikes_active_user_idx
  ON user_strikes (user_id, status, expires_at)
  WHERE status = 'active';

CREATE TABLE moderation_policies (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  posting_restriction_strikes SMALLINT NOT NULL DEFAULT 2,
  temporary_ban_strikes SMALLINT NOT NULL DEFAULT 3,
  strike_retention_days INTEGER NOT NULL DEFAULT 90,
  default_restriction_hours INTEGER NOT NULL DEFAULT 24,
  default_temporary_ban_hours INTEGER NOT NULL DEFAULT 72,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT moderation_policy_thresholds_check CHECK (
    posting_restriction_strikes BETWEEN 1 AND 100
    AND temporary_ban_strikes >= posting_restriction_strikes
    AND strike_retention_days BETWEEN 1 AND 3650
    AND default_restriction_hours BETWEEN 1 AND 8760
    AND default_temporary_ban_hours BETWEEN 1 AND 8760
  )
);

INSERT INTO moderation_policies (id) VALUES (TRUE);
