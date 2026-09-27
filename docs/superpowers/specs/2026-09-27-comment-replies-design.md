# Replies to Poll Comments Design

**Date:** 2026-09-27

## Goal

Add one-level replies to poll comments across the API, web, and Flutter clients. Creating a reply must produce the existing comment_reply notification for the author of the root comment so the notification type has a real end-to-end producer.

## Context

The comments MVP currently supports root comments only. The database already has comments.parent_comment_id, a same-poll foreign key, and an index for replies, but the API ignores the relationship and its list query returns only roots. The realtime notifications feature already recognizes comment_reply and can navigate to a comment, but clients do not create or display replies.

This design supersedes the replies non-goal in docs/prd-poll-comments.md. It keeps the existing comments API usable by old clients and does not require a database migration.

## Product Rules

- A reply may target a root comment only. Replies to replies are rejected; threads are at most one level deep.
- Replies are allowed only for an authenticated user and a visible, non-deleted comment in the same public poll.
- The existing polls.comments_count counts all non-deleted root comments and replies.
- Deleting a root comment soft-deletes its replies in the same transaction. Deleting a reply soft-deletes only that reply. The poll count is decremented by the number of rows newly hidden.
- A reply notification goes only to the author of the root comment. If that author wrote the reply, persist the reply and update counts but do not create or publish a notification.
- A reply by the poll author to another user's root comment still notifies the root comment's author; the poll author receives no additional comment notification for that reply.

## API and Persistence

### Create

Keep POST /polls/:pollId/comments and add an optional parentCommentId UUID.

    { "body": "I agree with this point.", "parentCommentId": "root-comment-uuid" }

Without parentCommentId, behavior stays the same and creates a root comment. With it, the API verifies that the parent is an active root comment belonging to the same visible public poll. Missing, deleted, cross-poll, or reply-level parents return the existing not-found response. The response comment includes parentCommentId (null for root comments).

Create the reply, increment polls.comments_count, and insert any comment_reply notification in one database transaction. Publish the notification after commit through the existing recipient-scoped realtime pipeline. Its pollId and commentId identify the poll and newly created reply. Do not put the reply body in notification payloads.

### Read

Keep GET /polls/:pollId/comments root-only and add repliesCount to each root item. This preserves existing list semantics.

Add GET /polls/:pollId/comments/:commentId/replies?limit=20&cursor=<opaque> returning replies for one root, ordered by (created_at ASC, id ASC), with a bounded page and nextCursor. Replies include their parentCommentId and viewer-specific like state. The endpoint uses the same public-poll visibility and authentication-optional rules as comment listing.

The existing single-comment endpoint returns parentCommentId. It remains the resolver used to distinguish a reply notification target from a root comment. If the reply or its root is soft-deleted, the reply is unavailable as a notification target.

### Delete

Deleting a root comment soft-deletes that root and all its active direct replies atomically. Deleting a reply affects only that reply. In both cases the comment count changes by exactly the number of active rows soft-deleted.

No database migration is needed because the parent column, same-poll constraint, and parent index already exist.

## Notification Semantics

- Root comments retain the current comment notification to the poll author.
- Replies create comment_reply for the root comment's author, unless the author is the reply actor.
- The notification deduplication key is unique per reply and recipient.
- Notification insertion is part of the reply transaction; realtime publication happens only after commit.
- The event targets the reply ID so both clients can open and focus the exact reply.
- The existing comment_reply in-app/push preference and delivery behavior remain unchanged (push defaults stay disabled); no push infrastructure or preference defaults change in this feature.

## Client Experience

### Web and Flutter

- Root comment cards display repliesCount, a reply action, and a show/hide replies action when replies exist.
- Replies render beneath their root; they are not mixed into the root comment list.
- Opening a reply thread fetches bounded pages and exposes loading, retryable error, and load-more states.
- The composer indicates the root author being replied to, allows cancellation, and sends parentCommentId.
- A successful reply is inserted into the open thread and updates the root's repliesCount plus the poll's commentsCount.
- Anonymous users can read replies but cannot create them.

### Notification Deep Links

Keep the canonical URL /polls/:pollId?comment=<commentId>. When the target is a reply, clients resolve its parentCommentId, load/expand that root's reply thread, then scroll/focus the reply. If the reply or its root is unavailable, keep the existing safe unavailable-target behavior.

## Compatibility and Scope

- Existing root-comment POST requests remain valid.
- Existing root-list responses retain their items shape; repliesCount is additive.
- Existing comment objects gain additive parentCommentId; clients parse missing values as null during rollout.
- No new notification type, database migration, nested reply flow, comment editing, or push infrastructure/default is introduced.
- comment_reply remains a first-class supported notification type and is now generated by this feature.

## Verification and Release Evidence

Automated coverage must include:

- Root comment requests without parentCommentId retain current behavior.
- Replies to valid roots succeed; cross-poll, missing, deleted, and reply-level parents are rejected.
- Root and reply reads return the correct parent and repliesCount; replies paginate in stable chronological order.
- Deleting a root hides its replies and decrements comments_count exactly; deleting a reply decrements it once.
- Self-replies do not create notifications; other replies notify only the root author.
- Notification rows commit with replies, events publish after commit, rollback publishes nothing, and recipients remain isolated.
- Web and Flutter render, create, expand, and paginate replies.
- A comment_reply deep link expands the correct thread and focuses the reply.
- Manual cross-client smoke creates a reply in one client, receives the notification in the other, opens the reply target, and verifies read-state and reconnect reconciliation.

Update docs/prd-poll-comments.md, the realtime notification plan, and the notification smoke/runbook so this feature replaces the old comment_reply producer blocker and the five-type smoke uses a real reply.
