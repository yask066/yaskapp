# PRD: Comments Integration Polish

## Introduction

Yaskapp now supports poll comments end to end: backend endpoints, Flutter API client, comments screen, comment composer, loading/empty/error states, and local comment list updates. The next step is to make the comments experience feel integrated with the rest of the app. When a user posts a comment from the comments screen, the updated poll state should propagate back to the feed and profile "My polls" views, and the MVP should be verified with a live smoke test.

## Goals

- Keep `commentsCount` consistent across the comments screen, feed, and profile after a comment is posted.
- Return updated poll data from `PollCommentsScreen` to the caller.
- Update parent poll lists when returning from the comments screen.
- Add test coverage for parent-screen poll replacement after comment creation.
- Document and verify the comments flow with a live smoke checklist.
- Add shared DTO types for poll comments and comment responses.

## Non-Goals

- Real-time comment updates across multiple clients.
- Push notifications for new comments.
- Editing or deleting comments.
- Nested replies.
- Comment likes.
- Full visual redesign of poll details.

## User Stories

- As a signed-in user, I can post a comment and see the poll's comment count update immediately.
- As a signed-in user, when I go back to the feed, the same poll card still shows the updated comment count.
- As a signed-in user, when I comment on one of my polls from profile, "My polls" reflects the updated count.
- As a developer, I can run a clear smoke checklist to verify comments on a live backend.

## Functional Requirements

1. `PollCommentsScreen` must track the latest updated `PollSummary`.
2. `PollCommentsScreen` must return the latest updated `PollSummary` through `Navigator.pop(...)` when leaving the screen.
3. Feed must await the comments screen result.
4. Feed must replace the matching poll in `_polls` when a newer poll is returned.
5. Feed must update `_pollsFuture` after replacing the poll.
6. Profile "My polls" must await the comments screen result.
7. Profile "My polls" must replace the matching poll in `_myPolls` when a newer poll is returned.
8. Profile "My polls" must update `_myPollsFuture` after replacing the poll.
9. Existing like/vote behavior must continue to work after comment-screen navigation changes.
10. Flutter tests must cover feed poll count update after returning from comments.
11. Flutter tests must cover profile "My polls" poll count update after returning from comments, if the profile test harness exists or can be added without broad refactor.
12. `packages/shared` must define `PollComment`.
13. `packages/shared` must define `ListPollCommentsResponse`.
14. `packages/shared` must define `CreatePollCommentRequest`.
15. `packages/shared` must define `CreatePollCommentResponse`.
16. Shared package build must pass after adding comment DTOs.
17. A live smoke checklist must be added to docs.
18. The smoke checklist must cover register/login, create poll, open comments, post comment, verify count, refresh, and error case.
19. Running comments smoke must not require keeping Docker infra up after verification.

## API Contract Notes

The existing backend comments contract remains the source of truth:

```http
GET /polls/:pollId/comments?limit=50
POST /polls/:pollId/comments
```

`POST /polls/:pollId/comments` already returns:

```json
{
  "comment": {},
  "poll": {}
}
```

This PRD does not require API behavior changes beyond shared DTO definitions.

## Flutter Implementation Notes

- Change `PollCommentsScreen` navigation result to `PollSummary?`.
- Maintain local `_poll` as the latest poll state.
- Use `WillPopScope` or equivalent back-navigation handling if needed, but prefer the simplest Navigator result path supported by Flutter.
- In feed/profile, factor small poll replacement helpers if it keeps code readable.
- Avoid optimistic parent updates; use the backend-returned poll from comment creation.
- Keep the comments screen usable even if no comment was posted; returning `null` or the unchanged poll is acceptable as long as callers handle it cleanly.

## Shared Package Notes

- Reuse existing `PollAuthor` and `Poll` types.
- `PollComment` should include:
  - `id`
  - `pollId`
  - `author`
  - `body`
  - `likesCount`
  - `createdAt`
  - `updatedAt`
- Response types should mirror backend JSON exactly.

## Acceptance Criteria

- Posting a comment updates the comments screen count.
- Returning to feed keeps the updated `commentsCount` visible on the poll card.
- Returning to profile "My polls" keeps the updated `commentsCount` visible on the poll card.
- Flutter tests pass.
- Backend tests still pass.
- Shared package build passes.
- Smoke checklist exists in docs and is specific enough to run manually.
- `npm run api:typecheck`, `npm run api:test`, `npm run shared:build`, `flutter analyze`, and `flutter test` pass.

## Open Questions

- Should `PollCommentsScreen` always return the latest poll on back, or only return when the poll changed?
- Should feed/profile also refresh from backend after returning, or is replacing from returned poll enough for MVP?
- Should the comments screen eventually become the canonical poll detail screen?
