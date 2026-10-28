CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role user_role NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_log_reason_length_check CHECK (
    char_length(reason) BETWEEN 1 AND 500
  ),
  CONSTRAINT admin_audit_log_action_check CHECK (
    action IN (
      'user.blocked',
      'user.unblocked',
      'user.role_changed',
      'user.deleted',
      'poll.deleted_by_admin',
      'comment.deleted_by_admin'
    )
  ),
  CONSTRAINT admin_audit_log_target_type_check CHECK (
    target_type IN ('user', 'poll', 'comment')
  )
);

CREATE INDEX admin_audit_log_created_at_idx
  ON admin_audit_log (created_at DESC, id DESC);

CREATE INDEX admin_audit_log_actor_idx
  ON admin_audit_log (actor_user_id, created_at DESC, id DESC);

CREATE INDEX admin_audit_log_target_idx
  ON admin_audit_log (target_type, target_id, created_at DESC, id DESC);

CREATE INDEX admin_audit_log_action_idx
  ON admin_audit_log (action, created_at DESC, id DESC);
