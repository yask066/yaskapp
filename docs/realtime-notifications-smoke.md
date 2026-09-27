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
| Cross-recipient isolation | Sign a separate unrelated account into a third client and keep it connected while creating an event for the recipient. Repeat with the recipient's web and Flutter connections on different API replicas when the staging routing controls allow it. | Only the intended recipient's clients receive the card or change their unread count; the unrelated account sees no event. |
| One-read convergence | Tap one unread card in web, then repeat with Flutter. | Only the selected item becomes read; both clients converge on the same read state and unread count. The target opens. |
| Read all | Create multiple unread items and explicitly choose “Read all” in one client. | All current items become read and the badge reaches zero in both clients. Merely opening the inbox does not change read state. |
| Reconnect | Disable network access for one client, create an event, restore access, and wait for reconnect. | The client reconciles from HTTP, restores the missed card and badge, and maintains a single active connection. |
| Foreground / visible | Background Flutter, create an event, then resume it. Hide the web tab, create another event, then return to the visible tab. | Both clients reconcile and show the authoritative unread count and missing cards. |
| Pagination | Create more notifications than one page, load the next page in both clients, and refresh. | Cursor pagination has no gaps or duplicate IDs; order remains newest first. |
| Duplicate delivery | Use a test publisher to publish the same versioned `{ recipientUserId, event }` envelope twice to `yaskapp:realtime:v1` for one seeded notification ID. | Each client renders one card and keeps the authoritative unread count. |
| Unavailable target | Remove or make a test poll/comment unavailable after creating its notification, then open the card. | The card remains in history, the client shows its safe unavailable-target message, and it does not navigate to a blank/error target. |

## `comment_reply` gate

`docs/prd-poll-comments.md` explicitly excludes nested replies, and the current code has no reply producer. Skip this row until the separate product dependency is closed; do not synthesize a reply by writing directly to `parent_comment_id` and call it a product smoke. Once the producer exists, verify a reply card deep-links to and highlights that reply in both clients.

## Release record

| Field | Value |
| --- | --- |
| Staging build / API image | |
| Smoke execution status | Not run / Passed / Failed |
| API replicas healthy | |
| Web browser/version | |
| Flutter device/OS/build | |
| Tester and UTC time | |
| Scenarios passed / failed, including cross-recipient isolation | |
| `comment_reply` dependency closed | |
| Notes / issue links | |

Release gate: all applicable scenarios pass on both clients, no duplicate cards or cross-recipient delivery occurs, read state converges, and the `comment_reply` dependency is closed before claiming all five notification types passed.
