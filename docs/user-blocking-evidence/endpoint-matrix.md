# User blocking endpoint and delivery matrix

**Audit date:** 2026-10-29

**Scope:** block-sensitive API reads, writes, and deliveries owned by UB-08–UB-19. This records the current route surface and assigns the future negative/control assertion to the implementation task; it does not claim those guards or tests already exist.
**Source:** `services/api/src/modules/{profiles,polls,search,notifications,moderation,account-deletion}/*.routes.ts`, `services/api/src/realtime/realtime.routes.ts`, `services/api/src/jobs/notification-push-worker.ts`, and the UB-08–UB-19 cards in `docs/superpowers/plans/2026-10-29-user-blocking-task-breakdown.md`.

## Regression-suite ownership

The route rows below name the owner; this table maps each owner to its planned API-target suite. Each route's last column states the blocked-pair negative assertion or an intentional allow/control assertion. These suites are future work in their owning cards, not tests claimed by UB-03.

| Owner | Planned negative/control suite |
| --- | --- |
| UB-08 | `services/api/src/modules/profiles/user-blocks.integration.test.ts`; `follows.repository.test.ts` |
| UB-09 | `services/api/src/modules/polls/poll-user-blocks.integration.test.ts`; `polls.integration.test.ts` |
| UB-10 | `services/api/src/modules/search/search.user-blocks.integration.test.ts`; `search.repository.test.ts` |
| UB-11 | `services/api/src/modules/polls/poll-pagination.user-blocks.integration.test.ts`; `poll-feed-snapshots.test.ts` |
| UB-12 | `services/api/src/modules/polls/comment-user-blocks.integration.test.ts` |
| UB-13 | `services/api/src/modules/polls/comment-interactions.user-blocks.integration.test.ts` |
| UB-14 | `services/api/src/modules/polls/poll-media.user-blocks.integration.test.ts` |
| UB-15 | `services/api/src/modules/user-blocks/user-blocks.lifecycle.integration.test.ts` |
| UB-16 | `services/api/src/modules/notifications/notifications.user-blocks.integration.test.ts` |
| UB-17 | `services/api/src/jobs/notification-push-user-blocks.integration.test.ts`; `notification-push-worker.test.ts` |
| UB-18 | `services/api/src/realtime/realtime.user-blocks.integration.test.ts`; realtime hub/bus tests |
| UB-19 | `services/api/src/jobs/user-blocks-outbox-worker.integration.test.ts` |

## HTTP surface

| Method and path | Owner | Block-sensitive behavior | Negative or control assertion to implement with owner |
| --- | --- | --- | --- |
| `GET /users` | UB-10 | Popular-user candidates are filtered before limit/cursor. | B is absent for A; visible C remains and the page is filled from later candidates. |
| `GET /users/:userId` | UB-08 | Full profile lookup. | A↔B returns the shared `404 not_found`; third-party C retains normal access. |
| `GET /users/:userId/followers` | UB-08 | Filter the list for the requesting viewer before pagination. | A cannot see B in C's list; C's other visible followers still paginate. |
| `GET /profiles/me/following` | UB-08 | Filter the viewer's outgoing list; block cleanup removes both A/B edges. | A/B are absent after either block direction; unrelated follows and counters remain correct. |
| `POST /users/:userId/follow` | UB-08 | Check the effective relation in the serialized follow mutation. | A cannot follow B after either direction blocks; no edge or counter is added. |
| `DELETE /users/:userId/follow` | UB-08 | Unfollow remains idempotent and does not restore an edge after unblock. | Retry after block/unblock creates no follow; other edges/counters are unchanged. |
| `GET /profiles/me/polls` | UB-08 | Own-poll listing is a control for profile hydration and viewer state. | The viewer can still read their own list; no hidden peer data is introduced by hydration. |
| `GET /users/:userId/polls` | UB-08 (route); UB-09 (poll hydration) | Hide the blocked owner's list, and guard each hydrated poll by current visibility. | A↔B list is `404`; a stale poll ID cannot be exposed through a later page. |
| `POST /polls` | UB-09 | Poll creation remains an ordinary author-owned write. | Control: creating a poll does not read or mutate a blocked account's content. |
| `DELETE /polls/:pollId` | UB-09 | Preserve owner deletion; do not let block state strand the author's own content controls. | Control: owner deletion still works after a peer block; non-owner deletion remains denied. |
| `GET /polls/:pollId` | UB-09 | Direct poll read and result hydration. | A↔B returns `404 not_found` for public, followers, and private polls; C remains readable where ordinary visibility permits. |
| `GET /polls` | UB-11 (pagination); UB-09 (hydration) | Newest/popular pages filter against current viewer policy before returning items. | B never appears from a stale cursor/snapshot; an accessible C behind B is reached without a loop. |
| `GET /polls/subscriptions` | UB-11 (pagination); UB-09 (hydration) | Subscription feed uses current follow and block relations. | A receives no B poll after block; the page still reaches visible C items. |
| `POST /polls/:pollId/votes` | UB-09 | New vote requires an accessible poll and author. | A cannot vote on B's poll after either direction blocks; stored vote and aggregates do not change. |
| `PUT /polls/:pollId/votes` | UB-09 | Vote change has the same in-transaction access check. | A cannot change a vote on B's hidden poll; historical votes/counts remain unchanged. |
| `DELETE /polls/:pollId/votes` | UB-09 | Cancellation follows the approved UB-01 access rules for a hidden poll. | A cannot use a hidden B poll ID to bypass the rule; C's allowed cancellation still works. |
| `POST /polls/:pollId/likes` | UB-09 | Like requires an accessible poll. | A cannot like B's hidden poll; no like or count is created. |
| `DELETE /polls/:pollId/likes` | UB-09 | Unlike follows the approved hidden-object rule. | A cannot use a hidden B poll ID to inspect or mutate its state. |
| `GET /polls/:pollId/comments` | UB-12 | Filter roots and return unavailable-root placeholders only per UB-02 capability. | B's author/body/excerpt is absent; A/C replies remain reachable, including after page one. |
| `GET /polls/:pollId/comments/:commentId` | UB-12 | Addressed comment lookup and any parent preview apply the same viewer policy. | A cannot fetch B's root by ID or learn its author/body from the response. |
| `GET /polls/:pollId/comments/:commentId/replies` | UB-12 | Reply lookup does not require returning the hidden parent. | B-authored replies are hidden; available A/C replies on the second page remain readable. |
| `POST /polls/:pollId/comments` | UB-13 | New comment/reply checks poll author and parent author inside the mutation boundary. | A cannot reply to B; a separate comment/reply in C's poll remains available. |
| `DELETE /polls/:pollId/comments/:commentId` | UB-13 | Preserve deletion of the viewer's own comment without hydrating a hidden poll. | Self-delete still returns `204`; deleting another user's comment remains denied. |
| `POST /polls/:pollId/comments/:commentId/likes` | UB-13 | Comment like checks the poll and comment owners. | A cannot like B's hidden comment; C's accessible comment remains actionable. |
| `DELETE /polls/:pollId/comments/:commentId/likes` | UB-13 | Unlike uses the same owner checks and does not reveal hidden state. | A cannot inspect/mutate B's hidden comment by ID; allowed C interaction is unchanged. |
| `GET /search` | UB-10 | Filter users and polls before limit/cursor calculation. | B is absent for username/display-name and poll searches; C remains reachable after hidden-only candidates. |
| `GET /media/polls/:pollId` | UB-14 | Check viewer before body or conditional `304`; separate guest/auth cache contexts. | After A↔B, no B image body or `304` is served to A, including after a guest cache hit. |
| `GET /media/avatars/:userId` | Public boundary; no block owner | Public avatars remain public under PRD §4.1. | Control: block does not change the existing public-avatar contract. |
| `GET /notifications` | UB-16 | Filter inbox by actor, target owners, and persistent suppression. | Old B-related rows and payloads are absent for either affected recipient; C control rows remain. |
| `GET /notifications/unread-count` | UB-16 | Count only currently available, unsuppressed rows. | Count excludes old unread B events immediately at block commit and after unblock. |
| `POST /notifications/:id/read` | UB-16 | Addressed mutation applies the same visibility/suppression check as list. | A cannot address a suppressed B event by ID; unrelated C event can still be marked read. |
| `POST /notifications/read-all` | UB-16 | Read-all touches only the viewer's available rows. | Suppressed rows do not reappear or affect the available unread count. |
| `POST /reports` | UB-15 | Reporting a known blocked content ID remains possible; response does not reveal hidden content. | Control: A can report B after block without an auto-report or hidden payload. |
| `GET /reports/mine` | UB-15 | Report ownership and evidence retention remain independent of personal blocks. | A can read their own report status; hidden B content is not added to the response. |
| `POST /auth/account-deletion/verification` | UB-15 | Verification stays available regardless of personal block state. | Deletion preparation succeeds; it does not retain extra block PII in the verification response. |
| `GET /auth/account-deletion/status` | UB-15 | Status is private to the deleting account. | A cannot obtain B's status by any block or username-reuse path. |
| `DELETE /auth/me` | UB-15 | Deletion clears block lifecycle data and does not transfer it to a reused username. | After delete/re-registration with the same username, the new UUID has no old relationship. |
| `GET /realtime` (WebSocket upgrade) | UB-18 | Connection setup remains authenticated/guest-aware; outbound events are checked per viewer. | A receives no full B poll/notification payload; C safe aggregate events are preserved. |
| `POST /profiles/me/avatar`, `DELETE /profiles/me/avatar`, `PATCH /profiles/me` | No block owner; profile controls | Own profile/media writes do not target another account. | Control: ordinary profile updates and avatar upload/removal are unchanged by A↔B. |
| `POST /notification-devices`, `DELETE /notification-devices`, `GET /notification-preferences`, `PATCH /notification-preferences` | UB-17 control | Device registration and user preferences remain independent of a personal block. | Control: blocking B does not remove A's devices/preferences or prevent changing them. |

The block-management paths `PUT/DELETE/GET /users/:userId/block`, `GET /profiles/me/blocks`, and `GET /profiles/me/visibility` belong to UB-07 and are listed here only as cross-cutting dependencies, outside the UB-08–UB-19 ownership range.

## Internal reads and deliveries

| Internal path | Owner | Required negative/control assertion |
| --- | --- | --- |
| Poll list hydration (`hydratePolls`, direct poll hydration, profile/search result hydration) | UB-09; UB-11 for page traversal; UB-08/10 for source list | A stale snapshot or result ID for B never returns the poll body; visible C is not lost behind it. |
| Comment root, parent preview, and addressed reply lookup | UB-12 | A hidden B root contributes no author/body/excerpt; allowed A/C replies beyond the first page remain reachable. |
| Comment creation parent lookup | UB-13 | Reply to B fails at the mutation boundary even if the poll is C's and the parent ID is known. |
| Poll image owner lookup, ETag/conditional response | UB-14 | An authenticated A does not receive the B image or a matching `304` after block. |
| Notification creation, actor/target-owner resolution, inbox/read/unread repository paths | UB-16 | Actor B and target-owner B history is suppressed at commit; C control notification stays available. |
| Push claim/retry/claimed-job provider send in `notification-push-worker` | UB-17 | If authorization occurs after block commit, provider `send` is not called and the job is terminally suppressed. |
| Poll and notification socket broadcasts, recipient filtering in realtime hub/bus | UB-18 | No hidden B payload reaches A; failure to check is closed by default; neutral revision contains no opposite-party ID. |
| Block outbox claim/publish/ack/recovery across Redis outage or restart | UB-19 | Replayed/out-of-order events do not revert a revision or resurrect inbox/push history. |
| Account deletion finalization and relationship cleanup | UB-15 | Removing either account removes its block-owned rows; username reuse creates a fresh UUID with no inherited relation. |

The current API has no `GET /notifications/:id` route. UB-16's direct-read requirement is covered by the existing addressed `POST /notifications/:id/read`; if a standalone addressed GET is introduced, add it here before release and give it the same suppression assertion.

## Explicitly unchanged surfaces

Auth/session routes and moderation-only policy/case routes do not themselves act on another user's readable content. Their ordinary ownership, authentication, authorization, and deletion checks remain in force. In particular, UB-15 verifies moderator permissions separately; moderator role does not bypass user-block policy on ordinary profile, poll, or comment APIs.
