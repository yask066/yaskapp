ALTER TABLE sanctions
  DROP CONSTRAINT sanctions_type_check;

ALTER TABLE sanctions
  ADD CONSTRAINT sanctions_type_check CHECK (type IN (
    'warning', 'strike', 'posting_restriction', 'comment_restriction', 'temporary_ban', 'permanent_ban'
  ));

CREATE TABLE appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sanction_id UUID NOT NULL REFERENCES sanctions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  reason TEXT NOT NULL,
  decision_note TEXT,
  resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT appeals_status_check CHECK (status IN ('open', 'upheld', 'reduced', 'revoked', 'request_more_info')),
  CONSTRAINT appeals_reason_length_check CHECK (char_length(reason) BETWEEN 1 AND 4000),
  CONSTRAINT appeals_decision_note_length_check CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 1 AND 4000),
  CONSTRAINT appeals_resolution_check CHECK (
    (status = 'open' AND resolved_at IS NULL AND resolved_by_user_id IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX appeals_one_open_per_sanction_idx
  ON appeals (sanction_id)
  WHERE status = 'open';
CREATE INDEX appeals_status_created_idx ON appeals (status, created_at DESC, id DESC);
CREATE INDEX appeals_user_idx ON appeals (user_id, created_at DESC, id DESC);
CREATE INDEX appeals_sanction_idx ON appeals (sanction_id, created_at DESC, id DESC);
