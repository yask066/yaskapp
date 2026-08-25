# Moderation Phase 5 Flutter Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove moderation administration from the Flutter app while preserving a user-facing Report action backed by `POST /reports`.

**Architecture:** Flutter will contain no admin capability probe, admin API client, admin screen, or admin navigation item. A small reports client and reusable report dialog will submit only user-created reports; all moderation queue, sanctions, appeals, and audit operations remain in the separate web panel/backend.

**Tech Stack:** Flutter/Dart, existing `http` client, Flutter widget/unit tests.

**Spec:** `docs/prd-moderation-web-panel.md`, Phase 5.

## Global Constraints

- No `/admin/*` or `/moderation/*` calls from Flutter.
- No `role`, `capabilities`, or client-side admin probing in mobile navigation.
- Keep poll voting, cancellation, deletion, profile, subscriptions, and realtime behavior unchanged.
- Report submission requires authentication, target type/id, category, and description.
- Report errors are shown as safe user-facing messages.

---

### Task 1: Remove embedded Admin UI

**Files:**
- Modify: `apps/mobile/lib/src/features/home/home_screen.dart`
- Delete: `apps/mobile/lib/src/features/admin/admin_api_client.dart`
- Delete: `apps/mobile/lib/src/features/admin/admin_reload_gate.dart`
- Delete: `apps/mobile/lib/src/features/admin/admin_screen.dart`
- Delete: `apps/mobile/test/admin_api_client_test.dart`
- Delete: `apps/mobile/test/admin_reload_gate_test.dart`
- Delete: `apps/mobile/test/admin_screen_test.dart`
- Test: `apps/mobile/test/home_screen_test.dart`

- [ ] Write a widget test proving the mobile navigation has no `Admin` item and still has Home, Subscriptions, Notifications, and Profile.
- [ ] Remove admin imports, capability state/probe, client lifecycle, AdminScreen stack entry, and Admin bottom-nav item.
- [ ] Delete obsolete admin-only implementation and tests.
- [ ] Run the focused Flutter tests and verify the new navigation test fails before cleanup and passes after cleanup.

### Task 2: Add user report client and dialog

**Files:**
- Create: `apps/mobile/lib/src/features/reports/reports_api_client.dart`
- Create: `apps/mobile/lib/src/features/reports/report_dialog.dart`
- Test: `apps/mobile/test/reports_api_client_test.dart`
- Test: `apps/mobile/test/report_dialog_test.dart`

- [ ] Implement `ReportsApiClient.submitReport` for `POST /reports` with strict JSON fields and safe error mapping.
- [ ] Support `poll`, `comment`, and `user` target types and the existing report categories.
- [ ] Build a compact dialog with category selector, required description, loading state, and success/error result.
- [ ] Write tests for request path/body/auth header, validation, success, and server errors.

### Task 3: Expose Report only in user content surfaces

**Files:**
- Modify: `apps/mobile/lib/src/features/polls/poll_card.dart`
- Modify: `apps/mobile/lib/src/features/feed/feed_screen.dart`
- Modify: `apps/mobile/lib/src/features/subscriptions/subscriptions_screen.dart`
- Modify: `apps/mobile/lib/src/features/profile/profile_screen.dart`
- Modify: `apps/mobile/lib/src/features/polls/poll_comments_screen.dart`

- [ ] Add an optional `onReport` callback to poll cards and show `Report` in the existing overflow menu for non-owners.
- [ ] Wire feed, subscriptions, profile, and poll comments to open the shared dialog for poll reports.
- [ ] Keep owner-only Delete poll and voter-only Cancel vote behavior unchanged.
- [ ] Report comments/users through their existing visible surfaces where callbacks exist; do not add moderation controls.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/prd-moderation-web-panel.md`
- Create: `docs/flutter-moderation-cleanup.md`

- [ ] Document that Flutter has only user report submission and no moderation administration.
- [ ] Run `flutter analyze`.
- [ ] Run `flutter test`.
- [ ] Run `git diff --check` and search Flutter sources for forbidden admin/moderation API references.
