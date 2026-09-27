# Poll Comment Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship one-level poll comment replies in the API, web, and Flutter, with a real post-commit comment_reply notification to the author of the root comment.

**Architecture:** Reuse comments.parent_comment_id and its same-poll constraint; add optional parentCommentId to the existing create route, plus a paginated reply-list endpoint while keeping the existing root list root-only. Persist reply, total comment count, and notification in one transaction; publish after commit through the existing recipient-scoped realtime pipeline. Web and Flutter display replies under their roots and resolve reply notification links to the exact reply.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Redis/ioredis, React, TanStack Query, Vitest/Testing Library/MSW, Flutter/Dart, Node test runner.

**Spec:** docs/superpowers/specs/2026-09-27-comment-replies-design.md

## Global Constraints

- A reply may target a root comment only. Replies to replies are rejected; threads are at most one level deep.
- Replies are allowed only for an authenticated user and a visible, non-deleted comment in the same public poll.
- The existing polls.comments_count counts all non-deleted root comments and replies.
- A reply notification goes only to the author of the root comment. If that author wrote the reply, persist the reply and update counts but do not create or publish a notification.
- Existing root-comment POST requests remain valid.
- No database migration is needed because the parent column, same-poll constraint, and parent index already exist.

## Review Focus

- A missing, deleted, cross-poll, or reply-level parent must never accept a reply; pin the 404 behavior in Task 1.
- Deleting a root with replies must hide the whole thread and decrement comments_count once per active row; pin it in Task 1.
- Self-replies and disabled in-app preferences must not create or publish a reply event; pin it in Task 2.
- Duplicate events and poll-author recipients must not leak replies to the wrong recipient; pin recipient isolation in Task 2.
- A notification for a reply must expand its parent thread and focus the reply on both clients; pin it in Tasks 3 and 4.

---

### Task 1: Poll reply API and durable comment model

**Files:**
- Modify: services/api/src/modules/polls/polls.routes.ts
- Modify: services/api/src/modules/polls/polls.service.ts
- Modify: services/api/src/modules/polls/polls.repository.ts
- Modify: services/api/src/modules/polls/polls.integration.test.ts

**Interfaces:**
- Consumes: the existing create/list/get/delete poll comment routes and the comments.parent_comment_id schema.
- Produces: createPollComment({ pollId, authorId, body, parentCommentId? }); listPollCommentReplies({ pollId, commentId, limit, cursor?, viewerId? }) returning { items, nextCursor }; comment DTOs with parentCommentId and roots with repliesCount.

- [ ] **Step 1: Write failing API integration tests.** In polls.integration.test.ts, create a root then POST a reply to the same poll; assert 201, reply.parentCommentId equals the root ID, and poll.commentsCount increases by one. Add tests for a reply-level parent, a parent from another poll, and a deleted parent; each must return the established 404 response. Add a root-list assertion for repliesCount and reply-page assertions for stable chronological order and nextCursor.

```ts
const response = await app.inject({
  method: 'POST',
  url: '/polls/' + poll.id + '/comments',
  headers: bearer(replier.accessToken),
  payload: { body: 'A reply.', parentCommentId: rootComment.id }
});
assert.equal(response.statusCode, 201);
assert.equal(response.json().comment.parentCommentId, rootComment.id);
assert.equal(response.json().poll.commentsCount, 2);
```

- [ ] **Step 2: Run the new tests and verify the expected failure.**

Run from the repository root: npm run test -w @yaskapp/api -- --test-name-pattern="poll comment replies"

Expected: FAIL because the strict create schema rejects parentCommentId and the replies endpoint is not implemented. If the test fails for a fixture or setup error, fix the test before changing production code.

- [ ] **Step 3: Implement the API and repository behavior.** Accept optional parentCommentId in the strict request schema. In the create transaction, lock and validate an active root in the same public poll before inserting the reply. Return parentCommentId for every comment. Keep the root list filtered to parent_comment_id IS NULL and add an active repliesCount. Add the cursor-paginated replies endpoint with an ascending (created_at, id) cursor, limit capped at 50, viewerHasLiked, and not-found handling for an unavailable root. When deleting a root, soft-delete active direct replies in the same transaction and decrement polls.comments_count by the number of rows newly soft-deleted; deleting a reply only changes that reply and decrements by one.

```sql
SELECT id, author_id
FROM comments
WHERE id = $1
  AND poll_id = $2
  AND parent_comment_id IS NULL
  AND deleted_at IS NULL
FOR UPDATE;
```

- [ ] **Step 4: Run focused tests and typecheck.**

Run: npm run test -w @yaskapp/api -- --test-name-pattern="poll comment replies|poll comments"

Run: npm run api:typecheck

Expected: all matching integration tests and API typecheck pass. Run git diff --check and resolve any reported whitespace errors.

- [ ] **Step 5: Commit the backend API slice.**

```bash
git add services/api/src/modules/polls/polls.routes.ts services/api/src/modules/polls/polls.service.ts services/api/src/modules/polls/polls.repository.ts services/api/src/modules/polls/polls.integration.test.ts
git commit -m "feat(api): add one-level poll comment replies"
```

### Task 2: Transactional comment_reply producer and multi-node delivery

**Files:**
- Modify: services/api/src/modules/polls/polls.repository.ts
- Modify: services/api/src/modules/notifications/notifications.multinode.integration.test.ts
- Modify: services/api/src/modules/polls/polls.integration.test.ts

**Interfaces:**
- Consumes: Task 1 createPollComment with validated parentCommentId and existing createNotification/publishNotificationAfterCommit.
- Produces: a persisted comment_reply notification targeting the created reply, committed with the reply and published to the root comment author after commit.

- [ ] **Step 1: Write failing recipient and delivery integration tests.** Create a public poll by user P, a root comment by user A, then a reply by user B. Assert exactly one comment_reply row is created for A, its pollId and commentId point to the poll and reply, the event reaches A's socket on the other hub, and neither P nor an unrelated user receives it. Add self-reply and in-app-disabled cases that create the reply but create no notification. Assert the reply body is absent from the event and persisted notification payload.

- [ ] **Step 2: Run the focused tests and verify the expected failure.**

Run from the repository root: npm run test -w @yaskapp/api -- --test-name-pattern="comment_reply|poll comment replies"

Expected: FAIL because reply creation currently emits no comment_reply event or emits the root-comment notification to the poll author. Do not weaken assertions to make the test pass.

- [ ] **Step 3: Add notification creation to the reply transaction.** Keep root-comment behavior unchanged. For a reply, set recipientUserId to the root author, actorUserId to the replier, type to comment_reply, pollId to the poll, and commentId to the newly inserted reply. Use a deduplication key unique to reply ID and recipient. Skip createNotification when actorUserId equals recipientUserId. Save the recipient ID and publishNotificationAfterCommit only after COMMIT; do not serialize the comment body into the event.

```ts
await createNotification({
  recipientUserId: root.author_id,
  actorUserId: input.authorId,
  type: 'comment_reply',
  pollId: input.pollId,
  commentId: reply.id,
  deduplicationKey: 'comment_reply:' + reply.id + ':' + root.author_id
}, client);
```

- [ ] **Step 4: Run focused notification tests and the full API typecheck.**

Run: npm run test -w @yaskapp/api -- --test-name-pattern="comment_reply|realtime notification"

Run: npm run api:typecheck

Expected: multi-node recipient isolation, self-reply, disabled-preference, payload-safety, and typecheck assertions pass. Run git diff --check.

- [ ] **Step 5: Commit the notification producer.**

```bash
git add services/api/src/modules/polls/polls.repository.ts services/api/src/modules/polls/polls.integration.test.ts services/api/src/modules/notifications/notifications.multinode.integration.test.ts
git commit -m "feat(api): publish comment reply notifications"
```

### Task 3: Web reply API, thread UI, and notification deep links

**Files:**
- Modify: apps/web/src/api/models.ts
- Modify: apps/web/src/api/polls.ts
- Modify: apps/web/src/api/polls.test.ts
- Modify: apps/web/src/features/comments/PollDetailPage.tsx
- Modify: apps/web/src/features/comments/PollDetailPage.test.tsx
- Modify: apps/web/src/features/comments/CommentList.tsx
- Modify: apps/web/src/features/comments/CommentForm.tsx
- Create: apps/web/src/features/comments/CommentThread.tsx
- Create: apps/web/src/features/comments/CommentThread.test.tsx
- Modify: apps/web/src/styles/global.css

**Interfaces:**
- Consumes: Task 1 PollComment.parentCommentId, root repliesCount, cursor reply endpoint, and Task 2 comment_reply target ID.
- Produces: listCommentReplies(pollId, rootCommentId, { limit?, cursor? }), getComment(pollId, commentId), and createComment(pollId, body, parentCommentId?) API functions; accessible expandable reply threads and reply-target deep-link resolution.

- [ ] **Step 1: Write failing web decoder and API tests.** Extend polls.test.ts to decode missing parentCommentId/repliesCount as null/zero for rollout compatibility, and to assert exact GET reply path, limit/cursor query, authorization behavior, and POST JSON with parentCommentId.

```ts
expect(decodePollComment({ ...baseComment, parentCommentId: rootId, repliesCount: 2 }))
  .toMatchObject({ parentCommentId: rootId, repliesCount: 2 });
expect(await createComment(pollId, 'Reply text', rootId)).toMatchObject({
  comment: { parentCommentId: rootId }
});
```

- [ ] **Step 2: Run the web API tests and verify the expected failure.**

Run: npm run test -w @yaskapp/web -- --run src/api/polls.test.ts

Expected: FAIL because the decoder and API client do not expose reply fields or functions.

- [ ] **Step 3: Implement the web API contract.** Add parentCommentId and repliesCount to PollComment decoding with backwards-compatible defaults. Implement listCommentReplies with limit/cursor parsing, getComment for notification target resolution, and createComment with optional parentCommentId while preserving the existing two-argument call.

- [ ] **Step 4: Write failing UI and deep-link tests.** In PollDetailPage.test.tsx and CommentThread.test.tsx, cover root repliesCount, expanding/collapsing, cursor load-more, retry after reply-list failure, submitting/canceling a reply, updating parent and poll counts, and resolving ?comment=<replyId> to expand the root and focus the reply. Preserve tests proving root comments still render and the existing root composer still works.

- [ ] **Step 5: Implement the web thread flow.** Keep CommentList root-only. Render a CommentThread beneath each expanded root; load reply pages under a distinct TanStack Query key per poll/root. Reuse CommentForm with an explicit reply-to label and cancel action. On submit, call createComment with the root ID and update/invalidate the matching reply query, root repliesCount, and poll cache. When focusedCommentId identifies a reply, fetch that comment, resolve parentCommentId, expand that root's thread, and focus the reply after it renders. Add responsive styles and visible keyboard focus.

- [ ] **Step 6: Run focused and full web verification, then commit.**

Run: npm run test -w @yaskapp/web -- --run src/api/polls.test.ts src/features/comments/PollDetailPage.test.tsx src/features/comments/CommentThread.test.tsx

Run: npm run build -w @yaskapp/web

Expected: all focused tests and the web build pass. Also run git diff --check.

```bash
git add apps/web/src/api/models.ts apps/web/src/api/polls.ts apps/web/src/api/polls.test.ts apps/web/src/features/comments/PollDetailPage.tsx apps/web/src/features/comments/PollDetailPage.test.tsx apps/web/src/features/comments/CommentList.tsx apps/web/src/features/comments/CommentForm.tsx apps/web/src/features/comments/CommentThread.tsx apps/web/src/features/comments/CommentThread.test.tsx apps/web/src/styles/global.css
git commit -m "feat(web): support poll comment replies"
```

### Task 4: Flutter reply API, thread UI, and notification deep links

**Files:**
- Modify: apps/mobile/lib/src/features/polls/poll_summary.dart
- Modify: apps/mobile/lib/src/features/polls/polls_api_client.dart
- Modify: apps/mobile/lib/src/features/polls/poll_comments_screen.dart
- Modify: apps/mobile/lib/src/features/notifications/notification_navigator.dart
- Modify: apps/mobile/test/poll_summary_test.dart
- Modify: apps/mobile/test/polls_api_client_test.dart
- Modify: apps/mobile/test/poll_comments_screen_test.dart
- Modify: apps/mobile/test/notification_navigation_test.dart

**Interfaces:**
- Consumes: Task 1 parentCommentId/repliesCount and paginated reply endpoint; Task 2 notifications targeting the reply ID.
- Produces: typed listCommentReplies and createComment(parentCommentId?) methods; an accessible one-level thread UI that resolves initialCommentId to its root and scrolls to the reply.

- [ ] **Step 1: Write failing model and API client tests.** Assert that PollCommentSummary parses parentCommentId and repliesCount, defaults absent values for old-server compatibility, and that PollsApiClient sends parentCommentId in JSON and uses the reply endpoint's limit/cursor query.

- [ ] **Step 2: Run the focused Flutter tests and verify the expected failure.**

Run from apps/mobile: flutter test test/poll_summary_test.dart test/polls_api_client_test.dart

Expected: FAIL because reply fields and request methods are not implemented.

- [ ] **Step 3: Implement typed model and API methods.** Add nullable parentCommentId and a default-zero repliesCount to PollCommentSummary. Add a reply page model with items and nextCursor. Implement listCommentReplies and extend createComment with optional parentCommentId while keeping existing root calls unchanged.

- [ ] **Step 4: Write failing widget and notification-navigation tests.** Cover opening a root's replies, loading more, retrying a failed page, replying/canceling, no composer for anonymous viewers, updating repliesCount and poll.commentsCount, and opening a notification whose initialCommentId is a reply by resolving and expanding the root thread.

- [ ] **Step 5: Implement the Flutter thread UI and target resolution.** Keep root comments as the primary list. Add an expand/reply control and render reply items under their root with paged loading/error/retry states. Add an inline reply composer that submits the selected root ID and can be canceled. For a deep link, fetch the target comment; when parentCommentId is non-null, fetch the parent thread, expand it, and focus the exact reply. Preserve the existing behavior for root-comment notification targets.

- [ ] **Step 6: Run focused tests and analyzer, then commit.**

Run from apps/mobile: flutter test test/poll_summary_test.dart test/polls_api_client_test.dart test/poll_comments_screen_test.dart test/notification_navigation_test.dart

Run from apps/mobile: flutter analyze lib/src/features/polls/poll_summary.dart lib/src/features/polls/polls_api_client.dart lib/src/features/polls/poll_comments_screen.dart lib/src/features/notifications/notification_navigator.dart

Expected: all focused tests and targeted analysis pass. Run git diff --check from the repository root.

```bash
git add apps/mobile/lib/src/features/polls/poll_summary.dart apps/mobile/lib/src/features/polls/polls_api_client.dart apps/mobile/lib/src/features/polls/poll_comments_screen.dart apps/mobile/lib/src/features/notifications/notification_navigator.dart apps/mobile/test/poll_summary_test.dart apps/mobile/test/polls_api_client_test.dart apps/mobile/test/poll_comments_screen_test.dart apps/mobile/test/notification_navigation_test.dart
git commit -m "feat(flutter): support poll comment replies"
```

### Task 5: Product documentation and five-type release evidence

**Files:**
- Modify: docs/prd-poll-comments.md
- Modify: docs/superpowers/plans/2026-09-19-realtime-notifications-ui.md
- Modify: docs/realtime-notifications.md
- Modify: docs/realtime-notifications-smoke.md

**Interfaces:**
- Consumes: the API and client behavior from Tasks 1–4.
- Produces: updated product scope, explicit plan dependency, and a manual smoke that creates a real reply and observes its comment_reply notification.

- [ ] **Step 1: Update the comments PRD.** Replace the nested-replies non-goal and unused-parent-column note with the approved one-level rule. Document optional parentCommentId, root-only listing with repliesCount, the paginated replies endpoint, total comment-count semantics, thread soft deletion, and notification recipient rules.

- [ ] **Step 2: Update the realtime notification plan.** Replace the vague Blocking Product Dependency paragraph with a link to this plan and the completion condition: Task 15's five-type gate is satisfied only after replies are implemented and the real comment_reply smoke passes. Preserve the existing notification contract and do not mark unrelated task checkboxes complete.

- [ ] **Step 3: Update the runbook and smoke procedure.** Add the reply endpoint and parent validation to the HTTP contract. Add a two-client procedure: A creates a root comment, B replies, A receives comment_reply, A opens the notification and lands on the expanded thread with the reply focused, then verify read-state, duplicate delivery, reconnect reconciliation, self-reply suppression, and unavailable target after thread deletion.

- [ ] **Step 4: Run the release verification set.**

Run from the repository root:
npm run shared:build
npm run api:typecheck
npm run api:test
npm run build -w @yaskapp/web
npm run test -w @yaskapp/web -- --run
Run from apps/mobile: flutter analyze
Run from apps/mobile: flutter test
git diff --check

Expected: all feature-focused tests pass. Report any pre-existing suite failure by exact test name; do not change unrelated auth/session behavior as part of this feature. The current main baseline had one known API logout-token revocation failure in auth.cookie.integration.test.ts, so confirm whether it still reproduces and keep it separately scoped if unchanged.

- [ ] **Step 5: Perform and record manual cross-client smoke.** Use docs/realtime-notifications-smoke.md with a connected web client, Flutter client, API, PostgreSQL, and Redis. Record badge/card delivery, parent-thread expansion, exact reply focus, one-read/read-all, duplicate event handling, reconnect/foreground reconciliation, pagination, and unavailable-target behavior. The five-type check must use a real reply created through the API; a synthetic comment_reply fixture is insufficient.

- [ ] **Step 6: Commit the documentation and release evidence updates.**

```bash
git add docs/prd-poll-comments.md docs/superpowers/plans/2026-09-19-realtime-notifications-ui.md docs/realtime-notifications.md docs/realtime-notifications-smoke.md
git commit -m "docs: close comment_reply notification dependency"
```

## Dependency Order

1. Task 1 builds the reply API and durable comment model.
2. Task 2 adds the transactional producer and cross-hub delivery.
3. Tasks 3 and 4 consume the stable API and can be implemented independently after Task 1; each also depends on Task 2 for end-to-end notification verification.
4. Task 5 follows Tasks 1–4 and closes the five-type release gate.

## Baseline Note

The implementation worktree starts at main commit 5a5f4b8. Previous verification recorded API typecheck, web tests/build, focused API notification tests, focused Flutter tests, and targeted Dart analysis passing. The full API suite had one known failure in auth.cookie.integration.test.ts; the full Flutter suite also had unrelated failures/warnings. Re-run the release set and report exact current results rather than treating this plan as proof that the baseline is green.
