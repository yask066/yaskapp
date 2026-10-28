CREATE TABLE moderation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_code TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT moderation_cases_target_type_check CHECK (target_type IN ('user', 'poll', 'comment')),
  CONSTRAINT moderation_cases_status_check CHECK (status IN ('open', 'triaged', 'in_review', 'resolved', 'dismissed', 'escalated', 'duplicate')),
  CONSTRAINT moderation_cases_priority_check CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  CONSTRAINT moderation_cases_resolution_note_length_check CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 2000)
);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reports_target_type_check CHECK (target_type IN ('user', 'poll', 'comment')),
  CONSTRAINT reports_category_check CHECK (category IN ('spam', 'harassment', 'hate_or_discrimination', 'sexual_content', 'violence_or_threat', 'fraud_or_scam', 'impersonation', 'other')),
  CONSTRAINT reports_status_check CHECK (status IN ('open', 'triaged', 'in_review', 'resolved', 'dismissed', 'escalated', 'duplicate')),
  CONSTRAINT reports_description_length_check CHECK (char_length(description) BETWEEN 1 AND 2000)
);

CREATE TABLE moderation_case_reports (
  case_id UUID NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  report_id UUID PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reports_active_reporter_target_idx
  ON reports (reporter_user_id, target_type, target_id)
  WHERE status IN ('open', 'triaged', 'in_review', 'escalated');

CREATE UNIQUE INDEX moderation_cases_active_target_idx
  ON moderation_cases (target_type, target_id)
  WHERE status IN ('open', 'triaged', 'in_review', 'escalated');

CREATE INDEX reports_status_created_at_idx
  ON reports (status, created_at DESC, id DESC);

CREATE INDEX moderation_cases_queue_idx
  ON moderation_cases (status, priority, created_at DESC, id DESC);

CREATE INDEX moderation_cases_assignee_idx
  ON moderation_cases (assigned_to_user_id, status, created_at DESC, id DESC);

CREATE TRIGGER moderation_cases_updated_at_trigger
BEFORE UPDATE ON moderation_cases
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER reports_updated_at_trigger
BEFORE UPDATE ON reports
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
