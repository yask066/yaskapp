# Phase 5 — Flutter moderation cleanup

The mobile application no longer contains an embedded administrator panel or
client-side administrator capability probing. Ordinary users cannot reach
`/admin/*` through the Flutter navigation and `AuthUser` remains unchanged.

User reporting is available from the three-dot menu on another user's poll.
The client submits a report to `POST /reports` with the backend-supported
target, category, and description fields. Server-side authentication,
authorization, deduplication, and moderation processing remain the source of
truth.

The administrative workflow is intended to be served by the separate closed
web panel from the moderation phases, not by the public mobile application.
