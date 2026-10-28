ALTER TABLE appeals
  DROP CONSTRAINT appeals_resolution_check;

ALTER TABLE appeals
  ADD CONSTRAINT appeals_resolution_check CHECK (
    (status = 'open' AND resolved_at IS NULL)
    OR (status <> 'open' AND resolved_at IS NOT NULL)
  );
