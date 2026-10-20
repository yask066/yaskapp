-- Keep keyset tuple ordering in the index. The public feed index replaces the
-- older created_at-only index; comment indexes stay partial to avoid indexing
-- deleted rows and the opposite comment level.
DROP INDEX IF EXISTS polls_public_created_at_idx;

CREATE INDEX polls_public_created_at_id_idx
  ON polls (created_at DESC, id DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;

CREATE INDEX comments_poll_root_created_at_id_idx
  ON comments (poll_id, created_at DESC, id DESC)
  WHERE parent_comment_id IS NULL AND deleted_at IS NULL;

CREATE INDEX comments_parent_reply_created_at_id_idx
  ON comments (parent_comment_id, created_at ASC, id ASC)
  WHERE parent_comment_id IS NOT NULL AND deleted_at IS NULL;
