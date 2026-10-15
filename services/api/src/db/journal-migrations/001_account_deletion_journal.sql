CREATE TABLE account_deletion_journal_meta (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  journal_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE account_deletion_journal_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'accepted')),
  accepted_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  hmac TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_deletion_journal_entries_state_operation_intent_key
    UNIQUE (state, operation_id, intent_id)
);

CREATE UNIQUE INDEX account_deletion_journal_one_accepted_per_operation
  ON account_deletion_journal_entries (operation_id)
  WHERE state = 'accepted';

CREATE INDEX account_deletion_journal_entries_operation_state_idx
  ON account_deletion_journal_entries (operation_id, state);

REVOKE ALL ON account_deletion_journal_meta FROM PUBLIC;
REVOKE ALL ON account_deletion_journal_entries FROM PUBLIC;

-- These roles are created by the journal host operator before migrations run.
GRANT SELECT ON account_deletion_journal_meta TO account_deletion_journal_runtime;
GRANT SELECT, INSERT ON account_deletion_journal_entries TO account_deletion_journal_runtime;
GRANT USAGE ON SEQUENCE account_deletion_journal_entries_id_seq TO account_deletion_journal_runtime;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON account_deletion_journal_meta FROM account_deletion_journal_runtime;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON account_deletion_journal_entries FROM account_deletion_journal_runtime;
REVOKE ALL ON account_deletion_journal_meta FROM account_deletion_journal_retention;
REVOKE ALL ON account_deletion_journal_entries FROM account_deletion_journal_retention;
