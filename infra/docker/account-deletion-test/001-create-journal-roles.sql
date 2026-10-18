\getenv runtime_password JOURNAL_RUNTIME_PASSWORD
\getenv retention_password JOURNAL_RETENTION_PASSWORD

CREATE ROLE account_deletion_journal_runtime LOGIN PASSWORD :'runtime_password';
CREATE ROLE account_deletion_journal_retention LOGIN PASSWORD :'retention_password';
