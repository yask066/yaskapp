CREATE OR REPLACE FUNCTION public.prune_completed_account_deletion_journal(operation_ids TEXT[])
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  deleted_prepared BIGINT;
  deleted_accepted BIGINT;
BEGIN
  IF operation_ids IS NULL OR cardinality(operation_ids) = 0 THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_journal_entries AS accepted
    WHERE accepted.state = 'accepted'
      AND accepted.operation_id = ANY(operation_ids)
      AND accepted.accepted_at <= now() - interval '35 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.account_deletion_journal_entries AS prepared
        WHERE prepared.operation_id = accepted.operation_id
          AND prepared.intent_id = accepted.intent_id
          AND prepared.state = 'prepared'
      )
  ) THEN
    RAISE EXCEPTION 'account_deletion_journal_incomplete';
  END IF;

  DELETE FROM public.account_deletion_journal_entries AS prepared
  USING public.account_deletion_journal_entries AS accepted
  WHERE prepared.operation_id = accepted.operation_id
    AND prepared.intent_id = accepted.intent_id
    AND prepared.state = 'prepared'
    AND accepted.state = 'accepted'
    AND accepted.operation_id = ANY(operation_ids)
    AND accepted.accepted_at <= now() - interval '35 days';
  GET DIAGNOSTICS deleted_prepared = ROW_COUNT;

  DELETE FROM public.account_deletion_journal_entries
  WHERE state = 'accepted'
    AND operation_id = ANY(operation_ids)
    AND accepted_at <= now() - interval '35 days';
  GET DIAGNOSTICS deleted_accepted = ROW_COUNT;

  RETURN deleted_prepared + deleted_accepted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_completed_account_deletion_journal(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_completed_account_deletion_journal(TEXT[]) FROM account_deletion_journal_runtime;
GRANT EXECUTE ON FUNCTION public.prune_completed_account_deletion_journal(TEXT[]) TO account_deletion_journal_retention;
