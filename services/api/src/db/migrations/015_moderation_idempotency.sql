CREATE TABLE moderation_idempotency_keys (
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status_code INTEGER,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (actor_user_id, idempotency_key),
  CONSTRAINT moderation_idempotency_key_length_check CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CONSTRAINT moderation_idempotency_fingerprint_check CHECK (char_length(request_fingerprint) BETWEEN 1 AND 128)
);

CREATE INDEX moderation_idempotency_expiry_idx
  ON moderation_idempotency_keys (expires_at);
