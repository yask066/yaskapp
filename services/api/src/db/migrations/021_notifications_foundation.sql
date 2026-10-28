ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS deduplication_key TEXT;

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_poll_id_fkey,
  DROP CONSTRAINT IF EXISTS notifications_comment_id_fkey;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_poll_id_fkey
    FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE SET NULL,
  ADD CONSTRAINT notifications_comment_id_fkey
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_deduplication_key_unique
  ON notifications (deduplication_key)
  WHERE deduplication_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_recipient_cursor_idx
  ON notifications (recipient_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread_cursor_idx
  ON notifications (recipient_user_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;
