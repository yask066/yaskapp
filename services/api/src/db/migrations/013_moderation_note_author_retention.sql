ALTER TABLE moderation_case_notes
  ALTER COLUMN author_user_id DROP NOT NULL;

ALTER TABLE moderation_case_notes
  DROP CONSTRAINT moderation_case_notes_author_user_id_fkey;

ALTER TABLE moderation_case_notes
  ADD CONSTRAINT moderation_case_notes_author_user_id_fkey
  FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL;
