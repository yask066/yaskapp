CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX polls_public_question_search_idx
  ON polls
  USING gin (to_tsvector('simple', question))
  WHERE visibility = 'public' AND deleted_at IS NULL;

CREATE INDEX users_username_search_idx
  ON users
  USING gin ((username::text) gin_trgm_ops)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX profiles_display_name_search_idx
  ON profiles
  USING gin (display_name gin_trgm_ops);
