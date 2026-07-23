# PRD: Poll Likes

## Introduction

Yaskapp already supports authentication, poll creation, feed browsing, voting, real-time vote updates, profile editing, and "My polls". The next social interaction to add is liking polls. Likes let users quickly react to polls without voting or commenting, and make the existing `likes_count` field in poll cards meaningful.

## Goals

- Allow authenticated users to like and unlike public polls.
- Show each poll's current like count in Flutter poll cards.
- Reflect whether the current viewer has liked each poll.
- Keep poll like counts consistent in PostgreSQL.
- Add automated backend coverage for like/unlike behavior.

## Non-Goals

- Comment likes.
- Real-time like updates.
- Like notifications.
- A dedicated list of users who liked a poll.
- Trending/feed ranking based on likes.

## User Stories

- As a signed-in user, I can like a poll from the feed so I can quickly react to it.
- As a signed-in user, I can unlike a poll I previously liked.
- As a signed-in user, I can see whether I have already liked a poll.
- As a signed-in user, I can see the updated like count after liking or unliking.
- As a signed-out user, I cannot like or unlike polls.

## Functional Requirements

1. Backend must expose `POST /polls/:pollId/likes`.
2. Backend must expose `DELETE /polls/:pollId/likes`.
3. Both endpoints must require JWT authentication.
4. `POST /polls/:pollId/likes` must create a `likes` row for the authenticated user and target poll.
5. Duplicate likes by the same user on the same poll must not increment `polls.likes_count` more than once.
6. `DELETE /polls/:pollId/likes` must remove the authenticated user's like for the poll.
7. Unliking a poll that was not liked must be safe and must not decrement below zero.
8. Like and unlike operations must update `polls.likes_count` transactionally.
9. Like and unlike responses should return the updated poll, including `likesCount`.
10. Feed/list poll responses should include viewer-specific like state when a request is authenticated.
11. Flutter `PollCard` must display a filled heart when the current viewer has liked the poll.
12. Flutter `PollCard` must call the like/unlike API when the heart control is tapped.
13. Flutter must update the card after the API response.
14. Flutter must show a user-facing error if like/unlike fails.

## API Contract

### Like Poll

```http
POST /polls/:pollId/likes
Authorization: Bearer <accessToken>
```

Success:

```json
{
  "poll": {
    "id": "uuid",
    "likesCount": 12,
    "viewerHasLiked": true
  }
}
```

### Unlike Poll

```http
DELETE /polls/:pollId/likes
Authorization: Bearer <accessToken>
```

Success:

```json
{
  "poll": {
    "id": "uuid",
    "likesCount": 11,
    "viewerHasLiked": false
  }
}
```

## Data Model Notes

- Existing `likes` table supports poll likes via `poll_id`.
- Existing partial unique index `likes_user_poll_unique` enforces one like per user per poll.
- Existing `polls.likes_count` should remain the denormalized source used by API responses.
- Poll DTOs should add `viewerHasLiked: boolean` when returned to an authenticated viewer. For unauthenticated public feed responses, this should default to `false`.

## Backend Implementation Notes

- Add repository methods for:
  - `likePollRecord({ pollId, userId })`
  - `unlikePollRecord({ pollId, userId })`
- Use transactions for insert/delete plus counter update.
- Prefer `ON CONFLICT DO NOTHING` for duplicate likes.
- Return `404` if the poll does not exist or is deleted.
- Return `401` for unauthenticated requests.
- Keep counter updates guarded by whether a row was actually inserted/deleted.
- Extend poll hydration so it can optionally compute `viewerHasLiked`.

## Flutter Implementation Notes

- Extend `PollSummary` with `viewerHasLiked`.
- Add `PollsApiClient.likePoll(...)` and `PollsApiClient.unlikePoll(...)`.
- Update `PollCard` metric row to make the heart tappable.
- Disable repeated like/unlike taps while a request is in flight.
- Use the updated poll returned by backend to replace the current card.

## Acceptance Criteria

- Authenticated user can like a poll from Flutter.
- Authenticated user can unlike a poll from Flutter.
- Like count changes correctly after like/unlike.
- Heart icon reflects liked/unliked state.
- Duplicate like does not double-increment `likesCount`.
- Unliking without a prior like does not make `likesCount` negative.
- Backend tests cover like, duplicate like, unlike, unauthenticated access, and missing poll.
- `npm run api:test`, `npm run api:typecheck`, `flutter analyze`, and `flutter test` pass.

## Open Questions

- Should likes update other connected clients via WebSocket now, or wait until later?
- Should liking your own poll be allowed in MVP?
- Should public unauthenticated feed responses omit `viewerHasLiked` or return `false`?
- Should profile "My polls" support liking from that section immediately?
