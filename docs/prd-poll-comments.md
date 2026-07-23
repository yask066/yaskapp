# PRD: Poll Comments

## Introduction

Yaskapp already supports authentication, poll creation, feed browsing, voting, real-time vote updates, profile editing, "My polls", and poll likes. The next social interaction to add is comments on polls. Comments let users discuss poll context, ask follow-up questions, and make the existing `comments_count` field in poll cards meaningful.

## Goals

- Allow authenticated users to create comments on public polls.
- Allow users to view comments for a poll.
- Show each poll's current comment count in Flutter poll cards.
- Provide a Flutter poll detail screen where comments can be read and added.
- Keep poll comment counts consistent in PostgreSQL.
- Add automated backend and Flutter coverage for the comments MVP.

## Non-Goals

- Nested comment threads or replies.
- Editing or deleting comments.
- Comment likes.
- Real-time comment updates.
- Comment moderation, reporting, or blocking.
- Rich text, mentions, hashtags, or media attachments in comments.
- Push notifications for new comments.

## User Stories

- As a signed-in user, I can open a poll and read its comments.
- As a signed-in user, I can add a short comment to a public poll.
- As a signed-in user, I can see the poll comment count update after posting a comment.
- As a signed-out user, I can read public poll comments if public browsing is supported, but I cannot post a comment.
- As a poll author, I can see discussion on my own polls from the profile "My polls" section.

## Functional Requirements

1. Backend must expose `GET /polls/:pollId/comments`.
2. `GET /polls/:pollId/comments` must return comments for an existing, non-deleted public poll.
3. `GET /polls/:pollId/comments` must support a bounded `limit` query parameter.
4. `GET /polls/:pollId/comments` must return comments ordered by `createdAt` ascending for MVP readability.
5. Backend must expose `POST /polls/:pollId/comments`.
6. `POST /polls/:pollId/comments` must require JWT authentication.
7. `POST /polls/:pollId/comments` must validate comment body text as trimmed, non-empty, and at most 1000 characters.
8. `POST /polls/:pollId/comments` must create a `comments` row for the authenticated user and target poll.
9. `POST /polls/:pollId/comments` must increment `polls.comments_count` transactionally with comment creation.
10. `POST /polls/:pollId/comments` response must return the created comment and the updated poll summary.
11. Backend must return `404` when commenting on or listing comments for a missing, deleted, or non-public poll.
12. Backend must return `401` when posting a comment without authentication.
13. Feed/list poll responses must continue to include `commentsCount`.
14. Flutter must add a `PollCommentSummary` model and JSON parsing.
15. Flutter `PollsApiClient` must add `listComments(...)` and `createComment(...)`.
16. Flutter `PollCard` comment metric must be tappable and open a poll detail/comments screen.
17. Flutter poll detail screen must display the poll card content and its comments.
18. Flutter poll detail screen must show loading, empty, and error states for comments.
19. Flutter poll detail screen must provide a text input and submit control for authenticated commenting.
20. Flutter must disable repeated comment submissions while a request is in flight.
21. Flutter must update the visible comment list after a successful comment response.
22. Flutter must update the visible poll `commentsCount` after a successful comment response.
23. Flutter must show a user-facing error if loading or posting comments fails.

## API Contract

### List Poll Comments

```http
GET /polls/:pollId/comments?limit=50
```

Success:

```json
{
  "items": [
    {
      "id": "uuid",
      "pollId": "uuid",
      "author": {
        "id": "uuid",
        "username": "ada",
        "displayName": "Ada Lovelace",
        "avatarObjectKey": null
      },
      "body": "I would choose the second option.",
      "likesCount": 0,
      "createdAt": "2026-07-21T10:00:00.000Z",
      "updatedAt": "2026-07-21T10:00:00.000Z"
    }
  ]
}
```

### Create Poll Comment

```http
POST /polls/:pollId/comments
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "body": "I would choose the second option."
}
```

Success:

```json
{
  "comment": {
    "id": "uuid",
    "pollId": "uuid",
    "author": {
      "id": "uuid",
      "username": "ada",
      "displayName": "Ada Lovelace",
      "avatarObjectKey": null
    },
    "body": "I would choose the second option.",
    "likesCount": 0,
    "createdAt": "2026-07-21T10:00:00.000Z",
    "updatedAt": "2026-07-21T10:00:00.000Z"
  },
  "poll": {
    "id": "uuid",
    "commentsCount": 4
  }
}
```

## Data Model Notes

- Existing `comments` table supports poll comments via `poll_id`.
- Existing `comments.parent_comment_id` should remain unused for MVP.
- Existing `comments.likes_count` should be returned as `likesCount`, even though comment likes are outside this MVP.
- Existing `polls.comments_count` should remain the denormalized source used by poll card and API responses.
- Comments should not be hard-deleted in MVP; list queries should exclude rows where `deleted_at IS NOT NULL`.

## Backend Implementation Notes

- Add repository methods for:
  - `listPollCommentRecords({ pollId, limit })`
  - `createPollCommentRecord({ pollId, authorId, body })`
- Reuse poll visibility and deletion checks from poll vote/like flows.
- Use a transaction for comment insert plus `polls.comments_count` increment.
- Hydrate comment author from `users` and `profiles`.
- Return the updated poll summary from `createPollCommentRecord` so Flutter can update `commentsCount`.
- Keep validation in routes with `zod`.
- Add integration tests for list, create, auth, validation, missing poll, and counter update behavior.

## Flutter Implementation Notes

- Add `PollCommentSummary` with author, body, likes count, and timestamps.
- Add `PollsApiClient.listComments(...)`.
- Add `PollsApiClient.createComment(...)`.
- Add `PollDetailScreen` or `PollCommentsScreen`.
- Open the detail/comments screen from the comment metric in `PollCard`.
- Pass the current session access token into the detail screen for posting.
- Render comments as compact list items with author, timestamp, and body.
- Keep the comment composer fixed near the bottom when practical, with mobile-safe keyboard behavior.
- After successful create, append the returned comment and replace the poll summary with the returned updated poll.
- Surface API errors through snackbar or inline error text.
- Add widget tests for opening comments, successful create, and failed create.

## Acceptance Criteria

- User can open comments from a poll card in the Flutter feed.
- User can see existing comments for a poll.
- Authenticated user can post a comment from Flutter.
- Empty or too-long comments are rejected before or by the API.
- Comment count increments after a successful post.
- Newly posted comment appears in the visible comment list.
- Posting without authentication returns `401`.
- Listing comments for a missing poll returns `404`.
- Backend tests cover list, create, validation, unauthenticated create, missing poll, and counter update.
- Flutter tests cover comment screen loading, successful post, and failed post.
- `npm run api:test`, `npm run api:typecheck`, `npm run shared:build`, `flutter analyze`, and `flutter test` pass.

## Open Questions

- Should comments be readable without authentication in the mobile app immediately?
- Should the detail screen allow voting and liking from the same poll card instance?
- Should comments order newest-first instead of oldest-first?
- Should comment count update in other screens when returning from the detail screen?
- Should real-time comment updates wait until after MVP?
