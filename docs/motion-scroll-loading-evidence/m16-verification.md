# M16 verification — Flutter static skeleton/loading

**Date:** 6 October 2026 (UTC+3)

**Base:** `637bb8d877eaf2e8f26aa8ad9a710c102f805e24`

## Changes

- Added shared `ContentSkeleton` row templates for polls, users, comments, and notifications. Decorative shapes are excluded from semantics and each region exposes one loading status.
- Added `DelayedContentSkeleton`: it reserves its layout immediately, becomes visible after 150 ms, cancels when data is ready, and has no minimum visible duration.
- Replaced Flutter initial loading indicators across feed, subscriptions, profile/public profile, search/discovery, comments/replies, and notifications. Existing loaded content remains mounted during refresh; public profile poll data is retained on refresh failure.
- Search load-more errors now keep existing results, show a footer Retry action, and do not automatically retry while the list remains near its end.

## Verification

| Check | Result |
|---|---|
| `content_skeleton_test.dart` | 3/3 passed: 149/150 ms clock boundary, ready-data cancellation, one semantics label per kind, 200% text scale, 16:9 media slot |
| Search pagination error + manual Retry | 1/1 passed; loaded poll rows remain visible while the footer offers Retry |
| Feed refresh error retains loaded poll | 1/1 passed |
| Comments delayed loading semantics | 1/1 passed |
| Notifications loading semantics + Retry | 1/1 passed |
| Targeted `flutter analyze lib/src/core/widgets/content_skeleton.dart test/content_skeleton_test.dart` | Passed; no issues found |
| `git diff --check` | Passed |
| Full `flutter analyze` | Exit 1 with 13 diagnostics already present in unrelated/previously modified code; no diagnostics point to `content_skeleton.dart` or `content_skeleton_test.dart`. Existing diagnostic locations include `feed_screen.dart:698–699`, outside this change. |

The broader Profile/Search widget sweep still reproduces the 10 failures already recorded by M02/M08/M14 in [the M14 verification](m14-verification.md); the task-specific tests above pass. The semantics tree is verified in widget tests; a physical-device TalkBack/VoiceOver session was not available.
