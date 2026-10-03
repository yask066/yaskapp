ALTER TABLE polls
  ADD COLUMN votes_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN likes_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN comments_revision BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT polls_votes_revision_nonnegative CHECK (votes_revision >= 0),
  ADD CONSTRAINT polls_likes_revision_nonnegative CHECK (likes_revision >= 0),
  ADD CONSTRAINT polls_comments_revision_nonnegative CHECK (comments_revision >= 0);
