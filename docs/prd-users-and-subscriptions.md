# PRD: Users and Subscriptions

## Summary

Yaskapp already has authentication, editable personal profiles, a `follows`
table, follow/unfollow API endpoints, and a placeholder Subscriptions tab.
This project completes the user graph and subscriptions experience across the
backend and Flutter client.

The feature must let users discover another user's public profile, follow or
unfollow that user, inspect relationship counters, and consume a feed of polls
from accounts they follow. Existing public feed, voting, likes, comments,
real-time updates, and authentication must remain unchanged.

## Goals

- Expose public profiles for other users.
- Allow authenticated users to follow and unfollow other users safely.
- Expose followers/following counters and relationship state.
- Provide a subscriptions feed containing polls from followed users.
- Make the Flutter Subscriptions tab usable with loading, empty, error, retry,
  and populated states.
- Preserve the existing poll card behavior and API response contracts.
- Keep counters and relationships correct under retries and concurrent calls.

## Non-goals

- Private accounts or follow approval workflows.
- Blocking, muting, reporting, or moderation tools.
- Recommendations or a discovery ranking algorithm.
- Push notifications for new followers or polls.
- Infinite scrolling beyond the first MVP page.
- Changing the existing public feed ordering.

## User Stories

- As an authenticated user, I can open another user's public profile.
- As an authenticated user, I can follow another user from their profile.
- As an authenticated user, I can unfollow a user I follow.
- As a user, I can see follower and following counters.
- As a user, I can see whether I currently follow the profile owner.
- As an authenticated user, I can open Subscriptions and see polls from users
  I follow.
- As a user with no followed accounts, I see a useful empty state.
- As a user whose followed accounts have no polls, I see a distinct empty-feed
  state.
- As an unauthenticated user, I can still use the public feed but cannot use
  follow actions or the subscriptions feed.

## Functional Requirements

### Public User Profiles

1. The API must expose a public profile by user UUID.
2. The profile response must include user ID, username, display name, bio,
   avatar object key, account status, polls count, followers count, and
   following count.
3. The profile response must include `viewerIsFollowing` when a valid bearer
   token is supplied and `false` or `null` for an unauthenticated viewer.
4. Deleted or blocked users must not be exposed as public profiles.
5. The current user's existing `/auth/me` and `/profiles/me` flows must remain
   compatible.

### Follow Graph

6. `POST /users/:userId/follow` must require bearer authentication.
7. `DELETE /users/:userId/follow` must require bearer authentication.
8. Users must not be able to follow or unfollow themselves.
9. Unknown, deleted, or blocked target users must return a consistent `404`.
10. Repeated follow requests must be idempotent.
11. Repeated unfollow requests must be idempotent.
12. The database must enforce one relationship per follower/followee pair.
13. Follow counters must update transactionally with relationship changes.
14. Concurrent follow/unfollow requests must not create duplicate rows or
    negative counters.
15. The API must expose a stable, newest-first following list for the current
    user.
16. The API must expose a stable, newest-first followers list for a public
    profile when needed by the client.

### Subscriptions Feed

17. `GET /polls/subscriptions` must require bearer authentication.
18. The feed must include only non-deleted polls authored by currently followed
    users.
19. The feed must use the existing poll response contract, including author,
    options, vote state, like state, counts, and timestamps.
20. The feed must order polls by `created_at DESC` with a deterministic ID
    tie-breaker.
21. The feed must support the existing safe limit range of 1 to 50.
22. No followed users or no published polls must return HTTP 200 with an empty
    `items` array.
23. A poll must disappear from the subscriptions feed after its author is
    unfollowed and the feed is refreshed.
24. Poll visibility rules must be explicit and consistent with the MVP:
    public polls are included; private/followers-only behavior is deferred
    unless separately implemented.

### Flutter Client

25. Add API client methods for public user profiles, follow, unfollow,
    followers/following lists, and the subscriptions feed.
26. Protected requests must use the persisted bearer token.
27. The Subscriptions tab must load the feed when opened.
28. The Subscriptions tab must support pull-to-refresh or an equivalent retry
    action.
29. The Subscriptions tab must render loading, populated, empty, and error
    states without showing stale content as current data.
30. Other-user profiles must render a pending follow/unfollow state and prevent
    duplicate taps while a request is in flight.
31. Failed follow/unfollow requests must restore the previous state and show a
    user-readable error.
32. The current user's profile must not show a self-follow action.
33. Subscription poll cards must retain vote, like, comment, and real-time vote
    update behavior from the public feed.

## Proposed API Contract

```text
GET    /users/:userId
POST   /users/:userId/follow
DELETE /users/:userId/follow
GET    /users/:userId/followers?limit=50
GET    /profiles/me/following?limit=50
GET    /polls/subscriptions?limit=20
```

Example public profile:

```json
{
  "user": {
    "id": "uuid",
    "username": "yask066",
    "status": "active",
    "profile": {
      "displayName": "Yask",
      "bio": "Polls and conversations.",
      "avatarObjectKey": null,
      "pollsCount": 3,
      "followersCount": 12,
      "followingCount": 4
    },
    "viewerIsFollowing": true
  }
}
```

Example relationship response:

```json
{
  "following": true,
  "followerFollowingCount": 4,
  "followeeFollowersCount": 13
}
```

The subscriptions response must reuse the public poll list envelope:

```json
{
  "items": []
}
```

## Data and Backend Direction

- Reuse the existing `users`, `profiles`, and `follows` tables.
- Keep the unique `(follower_id, followee_id)` constraint.
- Keep follow and counter updates inside one database transaction.
- Add a migration only for genuinely missing indexes or relationship data;
  do not recreate existing tables or reset VPS volumes.
- Add indexes supporting `follows.follower_id`,
  `follows.followee_id`, and subscriptions ordering by poll author and date.
- Reuse the existing poll repository hydration so vote and like state remain
  consistent between public and subscriptions feeds.
- Do not expose password hashes, private storage credentials, or internal
  database errors in profile responses.

## UX Direction

- Keep the existing Yask visual language, spacing, icons, and theme color.
- Keep the current bottom navigation structure.
- Replace the Subscriptions placeholder with the real feed.
- Add a compact follow/unfollow control on other-user profiles.
- Show separate empty states for “following nobody” and “no polls yet”.
- Preserve the existing poll card design and animations.

## Testing Requirements

### Backend

- Public profile success, missing user, blocked/deleted user.
- Follow and unfollow authentication errors.
- Follow success, duplicate follow, self-follow, and missing target.
- Counter correctness after follow/unfollow and repeated requests.
- Following/followers list ordering and limits.
- Subscription feed filtering, ordering, empty results, and unfollow removal.
- SQL/integration coverage for concurrent or repeated relationship operations.

### Flutter

- API paths, authorization headers, and response parsing.
- Profile loading, missing profile, follow success, follow failure, and
  pending state.
- Subscriptions loading, populated, empty, error, retry, and refresh states.
- Poll card interactions inside the subscriptions feed.

## Acceptance Criteria

1. A user can open another active user's public profile.
2. Follow and unfollow persist after API restart.
3. Repeated operations do not duplicate relationships or corrupt counters.
4. The subscriptions feed contains only polls from currently followed users.
5. The feed supports loading, populated, empty, error, and retry states.
6. Existing home feed, auth, profile editing, voting, likes, comments, and
   realtime updates pass without regressions.
7. Backend and Flutter automated tests cover the new behavior.
8. No secrets or internal error details are returned to clients.

## Implementation Order

1. Audit and add database indexes/migration only where needed.
2. Add public user profile repository, route, and response model.
3. Harden follow/unfollow transactions and expose relationship state.
4. Add following/followers list endpoints.
5. Add subscriptions feed query and route.
6. Add backend integration tests and run migrations on staging.
7. Add Flutter API models and client methods.
8. Implement other-user profile and follow controls.
9. Replace the Subscriptions placeholder with the feed and all states.
10. Add Flutter widget/client tests and run the full verification suite.
