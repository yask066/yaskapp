# Realtime notifications manual smoke

Run this checklist against a staging build with two healthy API replicas sharing the same PostgreSQL and Redis services. Use a test recipient account signed in to both web and Flutter, a separate actor account, and an unrelated account connected through a third client. Record the build, API image, browser, device/OS, tester, and UTC time with the result.

## Setup

1. Confirm both API replicas are healthy and connected to the same Redis service. Verify `/health/ready` on each replica.
2. Open the recipient's account in web and Flutter. Confirm the same initial unread count in both clients.
3. Ensure the recipient has notification preferences enabled for the types under test. Use test users and non-private content only.
4. Keep one client on the inbox and the other on a different screen so badge and card updates are both observable.

## Scenarios

| Scenario | Steps | Expected result |
| --- | --- | --- |
| Realtime badge and card | Create one supported event for the recipient while both clients are connected. Repeat with `poll_vote`, `comment`, `like` on a comment, `like` on a poll, and `follow`. | The badge updates without refresh; the inbox shows one complete card with the correct actor and target. An event received by either API replica reaches both connected clients. |
| Real `comment_reply` producer and deep link | Keep recipient A's web and Flutter sessions connected to the inbox. As A, create a root comment on a public poll. As B, create a reply through `POST /polls/:pollId/comments` with that root id as `parentCommentId`. Do not seed the notification or write directly to the database. | A's badge/card updates in both clients with type `comment_reply`, poll id, reply id, and no reply body in payload. Opening it expands the root thread and focuses the exact reply. The comment and total `commentsCount` update once. |
| Reply recipient and self-reply | Reply to A's root as B and observe delivery; then, as A, reply to A's own root. | Only the root author receives the first notification; the poll author and unrelated account do not receive it unless they are also that root author. A self-reply is stored and increments the total comments count but creates no `comment_reply` notification. |
| Cross-recipient isolation | Sign a separate unrelated account into a third client and keep it connected while creating an event for the recipient. Repeat with the recipient's web and Flutter connections on different API replicas when the staging routing controls allow it. | Only the intended recipient's clients receive the card or change their unread count; the unrelated account sees no event. |
| One-read convergence | Tap one unread card in web, then repeat with Flutter. | Only the selected item becomes read; both clients converge on the same read state and unread count. The target opens. |
| Read all | Create multiple unread items and explicitly choose “Read all” in one client. | All current items become read and the badge reaches zero in both clients. Merely opening the inbox does not change read state. |
| Reconnect | Disable network access for one client, create an event, restore access, and wait for reconnect. | The client reconciles from HTTP, restores the missed card and badge, and maintains a single active connection. |
| Foreground / visible | Background Flutter, create an event, then resume it. Hide the web tab, create another event, then return to the visible tab. | Both clients reconcile and show the authoritative unread count and missing cards. |
| Pagination | Create more notifications than one page, load the next page in both clients, and refresh. | Cursor pagination has no gaps or duplicate IDs; order remains newest first. |
| Duplicate delivery | Use a test publisher to publish the same versioned `{ recipientUserId, event }` envelope twice to `yaskapp:realtime:v1` for one seeded notification ID. | Each client renders one card and keeps the authoritative unread count. |
| Unavailable reply target after thread deletion | Create a real reply notification for A, then have A soft-delete the root comment. Open the existing reply notification. | Root and direct replies are soft-deleted and removed from comment/reply lists; the total comment count decrements for all removed rows. The notification remains in history, its target is unavailable, and both clients show a safe fallback instead of an empty thread. |

## `comment_reply` checks across the session

In addition to the creation/deep-link scenario above, verify the real reply notification through one-read convergence, duplicate delivery, reconnect/foreground reconciliation, and inbox pagination. After A marks it read in one client, both clients converge and replay creates no duplicate card. Disconnect one client after creating the reply, reconnect/resume it, and confirm HTTP reconciliation restores the notification and unread count. Load inbox and reply pages beyond their first page and confirm stable ordering with no duplicate ids. Do not write directly to `parent_comment_id` or synthesize an event as release evidence.

## Release record

| Field | Value |
| --- | --- |
| Staging build / API image | Not available for this execution |
| Smoke execution status | Not run — staging and connected test clients were unavailable (confirmed 2026-09-27) |
| API replicas healthy | Not available |
| Web browser/version | Not run |
| Flutter device/OS/build | Not run |
| Tester and UTC time | Not run |
| Scenarios passed / failed, including cross-recipient isolation | No manual scenarios run; automated results are recorded below |
| `comment_reply` implementation dependency closed | Yes — one-level API, producer, web and Flutter are implemented |
| Real API-created `comment_reply` smoke | Not run — staging and connected test clients were unavailable |
| Notes / issue links | |

## Automated verification record

Release checks run on 2026-09-27 from the implementation worktree:

| Check | Result |
| --- | --- |
| `npm run shared:build` | Passed |
| `npm run api:typecheck` | Passed |
| `npm run api:test` | Could not start: the worktree has no test `DATABASE_URL`, `REDIS_URL`, or S3 settings, and Docker Engine was unavailable. The command stopped in `db:migrate` before executing API tests. |
| `npm run build -w @yaskapp/web` | Passed |
| `npm run test -w @yaskapp/web -- --run` | Passed: 24 files, 120 tests. MSW emitted unrelated unhandled-request warnings in feed/profile/comment tests. |
| `flutter analyze` | Non-zero with 13 existing info/warning diagnostics in unrelated auth, feed, home, profile, poll-card, and search/report files; no diagnostics in the changed replies files. |
| `flutter test` | Feature-focused set passed (56 tests). The full run exposed unrelated failures including `auth_api_client_avatar_test.dart` — “uploads avatar as multipart field avatar”; `auth_screen_test.dart` — “does not select a country by default” and “keeps selected country after registration error”; `poll_card_report_test.dart` — “renders the poll actions with hierarchy and optional edit”; and `search_screen_test.dart` — “shows the latest successful searches in reverse chronological order”, “clears the query from the search bar”, “shows empty and retryable error states”, and “filter changes preserve query and reset pagination”. The runner then stalled on the existing `report_dialog_test.dart` — “renders the reference-style report dialog” — and was stopped. |
| `git diff --check` | Passed |

The previous baseline's `/auth/logout` bearer-token revocation failure could not be rechecked because the API integration suite did not start. The manual five-type release gate remains open until a staging run with a real API-created reply succeeds on web and Flutter.

Release gate: all applicable scenarios pass on both clients, no duplicate cards or cross-recipient delivery occurs, read state converges, and the `comment_reply` dependency is closed before claiming all five notification types passed.
