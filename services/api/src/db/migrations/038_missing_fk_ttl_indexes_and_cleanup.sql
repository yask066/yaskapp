-- Missing FK and retention/cleanup indexes
CREATE INDEX IF NOT EXISTS notifications_read_at_idx
  ON notifications (read_at)
  WHERE read_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_actor_user_id_idx
  ON notifications (actor_user_id)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_poll_id_idx
  ON notifications (poll_id)
  WHERE poll_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_comment_id_idx
  ON notifications (comment_id)
  WHERE comment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notification_push_jobs_recipient_user_id_idx
  ON notification_push_jobs (recipient_user_id);

CREATE INDEX IF NOT EXISTS moderation_case_reports_case_id_idx
  ON moderation_case_reports (case_id);

CREATE INDEX IF NOT EXISTS moderation_case_notes_author_user_id_idx
  ON moderation_case_notes (author_user_id)
  WHERE author_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sanctions_created_by_user_id_idx
  ON sanctions (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sanctions_revoked_by_user_id_idx
  ON sanctions (revoked_by_user_id)
  WHERE revoked_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_strikes_case_id_idx
  ON user_strikes (case_id);

CREATE INDEX IF NOT EXISTS appeals_resolved_by_user_id_idx
  ON appeals (resolved_by_user_id)
  WHERE resolved_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS account_deletion_permissions_expires_at_idx
  ON account_deletion_permissions (expires_at);

CREATE INDEX IF NOT EXISTS deleted_account_archive_access_archived_user_id_idx
  ON deleted_account_archive_access (archived_user_id);

CREATE INDEX IF NOT EXISTS deleted_account_archive_access_actor_user_id_idx
  ON deleted_account_archive_access (actor_user_id);

CREATE INDEX IF NOT EXISTS platform_ip_bans_created_by_user_id_idx
  ON platform_ip_bans (created_by_user_id);

CREATE INDEX IF NOT EXISTS platform_ip_ban_events_ban_id_idx
  ON platform_ip_ban_events (ban_id);

CREATE INDEX IF NOT EXISTS user_blocks_outbox_recipient_user_id_idx
  ON user_blocks_outbox (recipient_user_id);

-- Drop redundant duplicate indexes
DROP INDEX IF EXISTS poll_options_poll_position_idx;
DROP INDEX IF EXISTS notifications_recipient_created_at_idx;
DROP INDEX IF EXISTS notifications_recipient_unread_idx;
DROP INDEX IF EXISTS account_deletion_content_targets_lookup_idx;
DROP INDEX IF EXISTS account_deletion_counter_targets_lookup_idx;
