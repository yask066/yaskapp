# M08 verification — Flutter deadlines, retry, and lifecycle

**Date:** 5 October 2026
**Base:** `a45ca82` (`fix(web): bound reads and guard session lifecycle`)
**Scope:** Flutter read deadlines, stale-response handling, ambiguous Poll mutations, and existing lifecycle reconciliation.

## Changes

- Added a shared 10-second read scope using `http.AbortableRequest`. Timeout and API-client close signal transport cancellation, settle the caller, and discard late completions.
- Applied the scope to Polls, Search, Profiles, and Notifications reads. Poll ingress still checks its captured session epoch; Search still checks query/filter request identity before applying a result.
- Ambiguous vote, like, delete, and comment-create outcomes request a Poll reconciliation. Confirmed 4xx responses release pending state without reconciliation or automatic mutation retry.
- Foreground resume and the existing realtime `ready` event request reconciliation for loaded Polls through the existing client and store.
- Captured delete session context before dispatch so a response from an older account cannot add a deletion tombstone to the current account.

## Verification

| Check | Result |
|---|---|
| `flutter test --no-pub --reporter expanded test/m08_api_lifecycle_test.dart test/realtime_session_test.dart test/polls_api_client_test.dart test/poll_state_store_test.dart` | 62 passed |
| Affected widget suites: Feed, Subscriptions, Profile, Public Profile, Search, Poll Comments, Notifications, Notification Store | 85 passed, 10 failed, 1 skipped; all 10 failures reproduce in the pre-change suite |
| Full `flutter test --no-pub --reporter expanded` after change | 194 passed, 15 failed, 1 skipped |
| Same full suite at base `a45ca82` | 169 passed, the same 15 failed, 1 skipped; failing test names match exactly |
| `dart analyze` on all changed Dart source and test files | No issues found |
| `flutter analyze --no-pub` for the whole project | Exit 1 with 13 existing project diagnostics outside the changed files (infos/warnings) |
| `git diff --check` | Passed |

The 15 full-suite failures are existing test/UI mismatches recorded before M08; no new full-suite failure was introduced. The suite included the 25 new M08 checks. Device profiling and frame-time measurements were not part of this task.

## Review

Author self-review against M08 and the PRD checked captured session epochs, query guards, abort/cleanup behavior, pending release, ambiguous-result reconciliation, and the existing realtime ownership boundary. No Critical or Important issues were found. This was not an independent review.
