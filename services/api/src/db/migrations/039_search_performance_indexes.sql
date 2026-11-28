CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS polls_public_question_trgm_idx
  ON polls USING GIN (question gin_trgm_ops)
  WHERE visibility = 'public' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_popularity_score_idx
  ON profiles ((followers_count * 2 + polls_count) DESC, user_id DESC);
