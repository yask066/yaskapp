-- Supports the subscriptions feed: followed author, public visibility, newest first.
CREATE INDEX IF NOT EXISTS polls_author_public_created_at_idx
  ON polls (author_id, created_at DESC, id DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;
