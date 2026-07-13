CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TYPE user_status AS ENUM ('active', 'blocked', 'deleted');
CREATE TYPE poll_visibility AS ENUM ('public', 'followers', 'private');
CREATE TYPE notification_type AS ENUM (
  'poll_vote',
  'comment',
  'comment_reply',
  'like',
  'follow'
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  username CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT users_email_format_check CHECK (
    email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  ),
  CONSTRAINT users_username_format_check CHECK (
    username ~* '^[a-z0-9_][a-z0-9_.]{2,29}$'
  )
);

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_object_key TEXT,
  cover_object_key TEXT,
  location TEXT,
  website_url TEXT,
  polls_count INTEGER NOT NULL DEFAULT 0,
  followers_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profiles_display_name_length_check CHECK (
    char_length(display_name) BETWEEN 1 AND 80
  ),
  CONSTRAINT profiles_bio_length_check CHECK (
    bio IS NULL OR char_length(bio) <= 500
  ),
  CONSTRAINT profiles_website_url_format_check CHECK (
    website_url IS NULL OR website_url ~* '^https?://'
  )
);

CREATE TABLE polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  description TEXT,
  image_object_key TEXT,
  visibility poll_visibility NOT NULL DEFAULT 'public',
  options_count INTEGER NOT NULL DEFAULT 0,
  votes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  likes_count INTEGER NOT NULL DEFAULT 0,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT polls_question_length_check CHECK (
    char_length(question) BETWEEN 1 AND 280
  ),
  CONSTRAINT polls_description_length_check CHECK (
    description IS NULL OR char_length(description) <= 2000
  ),
  CONSTRAINT polls_options_count_check CHECK (options_count >= 0),
  CONSTRAINT polls_votes_count_check CHECK (votes_count >= 0),
  CONSTRAINT polls_comments_count_check CHECK (comments_count >= 0),
  CONSTRAINT polls_likes_count_check CHECK (likes_count >= 0),
  CONSTRAINT polls_ends_at_check CHECK (ends_at IS NULL OR ends_at > created_at)
);

CREATE TABLE poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  position SMALLINT NOT NULL,
  votes_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT poll_options_text_length_check CHECK (
    char_length(text) BETWEEN 1 AND 160
  ),
  CONSTRAINT poll_options_position_check CHECK (position >= 0),
  CONSTRAINT poll_options_votes_count_check CHECK (votes_count >= 0),
  CONSTRAINT poll_options_poll_position_unique UNIQUE (poll_id, position),
  CONSTRAINT poll_options_poll_id_id_unique UNIQUE (poll_id, id)
);

CREATE TABLE poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL,
  voter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT poll_votes_option_belongs_to_poll_fk FOREIGN KEY (poll_id, option_id)
    REFERENCES poll_options(poll_id, id)
    ON DELETE CASCADE,
  CONSTRAINT poll_votes_one_vote_per_poll_unique UNIQUE (poll_id, voter_id),
  CONSTRAINT poll_votes_one_vote_per_option_unique UNIQUE (option_id, voter_id)
);

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  likes_count INTEGER NOT NULL DEFAULT 0,
  replies_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT comments_body_length_check CHECK (
    char_length(body) BETWEEN 1 AND 2000
  ),
  CONSTRAINT comments_likes_count_check CHECK (likes_count >= 0),
  CONSTRAINT comments_replies_count_check CHECK (replies_count >= 0)
);

ALTER TABLE comments
  ADD CONSTRAINT comments_poll_id_id_unique UNIQUE (poll_id, id);

ALTER TABLE comments
  ADD CONSTRAINT comments_parent_belongs_to_poll_fk FOREIGN KEY (poll_id, parent_comment_id)
    REFERENCES comments(poll_id, id)
    ON DELETE CASCADE;

CREATE TABLE likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT likes_single_target_check CHECK (
    (poll_id IS NOT NULL AND comment_id IS NULL)
    OR (poll_id IS NULL AND comment_id IS NOT NULL)
  )
);

CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT follows_no_self_follow_check CHECK (follower_id <> followee_id),
  CONSTRAINT follows_pair_unique UNIQUE (follower_id, followee_id)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type notification_type NOT NULL,
  poll_id UUID REFERENCES polls(id) ON DELETE CASCADE,
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_no_self_actor_check CHECK (
    actor_user_id IS NULL OR actor_user_id <> recipient_user_id
  )
);

CREATE UNIQUE INDEX likes_user_poll_unique
  ON likes (user_id, poll_id)
  WHERE poll_id IS NOT NULL;

CREATE UNIQUE INDEX likes_user_comment_unique
  ON likes (user_id, comment_id)
  WHERE comment_id IS NOT NULL;

CREATE INDEX users_status_created_at_idx ON users (status, created_at DESC);
CREATE INDEX profiles_display_name_idx ON profiles (display_name);

CREATE INDEX polls_author_created_at_idx ON polls (author_id, created_at DESC);
CREATE INDEX polls_public_created_at_idx
  ON polls (created_at DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;
CREATE INDEX polls_active_ends_at_idx
  ON polls (ends_at)
  WHERE ends_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX poll_options_poll_position_idx ON poll_options (poll_id, position);
CREATE INDEX poll_votes_poll_created_at_idx ON poll_votes (poll_id, created_at DESC);
CREATE INDEX poll_votes_voter_created_at_idx ON poll_votes (voter_id, created_at DESC);

CREATE INDEX comments_poll_created_at_idx ON comments (poll_id, created_at DESC);
CREATE INDEX comments_parent_created_at_idx
  ON comments (parent_comment_id, created_at ASC)
  WHERE parent_comment_id IS NOT NULL;
CREATE INDEX comments_author_created_at_idx ON comments (author_id, created_at DESC);

CREATE INDEX likes_poll_created_at_idx
  ON likes (poll_id, created_at DESC)
  WHERE poll_id IS NOT NULL;
CREATE INDEX likes_comment_created_at_idx
  ON likes (comment_id, created_at DESC)
  WHERE comment_id IS NOT NULL;
CREATE INDEX likes_user_created_at_idx ON likes (user_id, created_at DESC);

CREATE INDEX follows_follower_created_at_idx ON follows (follower_id, created_at DESC);
CREATE INDEX follows_followee_created_at_idx ON follows (followee_id, created_at DESC);

CREATE INDEX notifications_recipient_created_at_idx
  ON notifications (recipient_user_id, created_at DESC);
CREATE INDEX notifications_recipient_unread_idx
  ON notifications (recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER polls_set_updated_at
  BEFORE UPDATE ON polls
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER poll_options_set_updated_at
  BEFORE UPDATE ON poll_options
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER comments_set_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
