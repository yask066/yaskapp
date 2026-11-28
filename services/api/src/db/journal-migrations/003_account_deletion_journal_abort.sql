ALTER TABLE account_deletion_journal_entries
  DROP CONSTRAINT IF EXISTS account_deletion_journal_entries_state_check;

ALTER TABLE account_deletion_journal_entries
  ADD CONSTRAINT account_deletion_journal_entries_state_check
  CHECK (state IN ('prepared', 'accepted', 'aborted'));

CREATE OR REPLACE FUNCTION public.prune_completed_account_deletion_journal_ids(operation_ids TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  pruned_ids TEXT[];
BEGIN
  IF operation_ids IS NULL OR cardinality(operation_ids) = 0 THEN
    RETURN ARRAY[]::TEXT[];
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

  SELECT COALESCE(array_agg(DISTINCT accepted.operation_id), ARRAY[]::TEXT[])
  INTO pruned_ids
  FROM public.account_deletion_journal_entries AS accepted
  WHERE accepted.state = 'accepted'
    AND accepted.operation_id = ANY(operation_ids)
    AND accepted.accepted_at <= now() - interval '35 days';

  IF cardinality(pruned_ids) > 0 THEN
    DELETE FROM public.account_deletion_journal_entries
    WHERE operation_id = ANY(pruned_ids)
      AND state IN ('prepared', 'accepted', 'aborted');
  END IF;

  -- Also prune expired aborted intents (and their prepared rows) past 35 days.
  DELETE FROM public.account_deletion_journal_entries AS entry
  WHERE entry.state IN ('prepared', 'aborted')
    AND entry.created_at <= now() - interval '35 days'
    AND EXISTS (
      SELECT 1
      FROM public.account_deletion_journal_entries AS aborted
      WHERE aborted.operation_id = entry.operation_id
        AND aborted.intent_id = entry.intent_id
        AND aborted.state = 'aborted'
    );

  RETURN pruned_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_completed_account_deletion_journal_ids(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_completed_account_deletion_journal_ids(TEXT[]) FROM account_deletion_journal_runtime;
GRANT EXECUTE ON FUNCTION public.prune_completed_account_deletion_journal_ids(TEXT[]) TO account_deletion_journal_retention;
