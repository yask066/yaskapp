CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  poll_vote_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  poll_vote_push BOOLEAN NOT NULL DEFAULT FALSE,
  comment_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  comment_push BOOLEAN NOT NULL DEFAULT FALSE,
  comment_reply_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  comment_reply_push BOOLEAN NOT NULL DEFAULT FALSE,
  like_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  like_push BOOLEAN NOT NULL DEFAULT FALSE,
  follow_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  follow_push BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER notification_preferences_set_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
