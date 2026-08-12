# PRD: Subscriptions Feed

## Summary

Yaskapp currently has a second navigation tab reserved for discovery, but the
product direction is to show polls from people a user follows. The mobile app
already contains a `Subscriptions` tab placeholder. This project will make
following users and consuming a subscriptions feed a complete end-to-end
feature across the API, PostgreSQL, and Flutter client.

## Goals

- Allow an authenticated user to follow and unfollow other users.
- Expose the current user's following list and subscription state.
- Provide a feed containing polls authored by followed users.
- Keep follow counters consistent and prevent duplicate or self-follows.
- Make the Flutter Subscriptions tab usable on loading, empty, error, and
  populated states.
- Preserve the existing public feed, profile, poll, comment, like, and vote
  flows.
- Cover the new behavior with backend integration tests and focused Flutter
  tests.

## Non-goals

- Push notifications for new polls or new followers.
- Recommendations, trending users, or a discovery/search algorithm.
- Private accounts, follow requests, blocking, or approval workflows.
- Pagination beyond the first practical MVP page.
- Replacing the existing public feed ordering.

## User Stories

- As an authenticated user, I can follow another user from their profile.
- As an authenticated user, I can unfollow a user I currently follow.
- As an authenticated user, I can see whether I follow a user.
- As an authenticated user, I can open Subscriptions and see polls from users
  I follow.
- As a user with no subscriptions, I see a clear empty state and a path back
  to the public feed.
- As a user whose followed users have not published polls, I see a distinct
  empty-feed state rather than an error.
- As an unauthenticated client, I cannot access follow actions or the
  subscriptions feed.

## Functional Requirements

1. The API must support following an existing user by user ID.
2. The API must support unfollowing an existing followed user safely and
   idempotently.
3. The API must reject attempts to follow the current user.
4. The API must reject follow and unfollow requests for unknown users with a
   consistent `404` response.
5. Follow and unfollow endpoints must require bearer authentication.
6. The database must enforce one follow row per follower/followee pair.
7. The database must maintain `profiles.following_count` and
   `profiles.followers_count` transactionally with follow changes.
8. Follow operations must be safe under repeated requests and concurrent
   requests without negative counters or duplicate rows.
9. The API must expose the current user's following list with stable ordering
   and enough profile data for the client to render it.
10. Poll responses must expose whether the viewer follows the poll author when
    that information is needed by the client.
11. The API must expose a subscriptions poll feed restricted to authors the
    current user follows.
12. The subscriptions feed must return the existing poll summary contract,
    including author, options, vote state, like state, counts, and timestamps.
13. The subscriptions feed must order polls newest first, with a deterministic
    tie-breaker.
14. The subscriptions feed must return an empty list with a successful response
    when the user follows nobody or followed users have no polls.
15. The subscriptions feed must not return polls from unfollowed users after a
    successful unfollow and subsequent fetch.
16. The Flutter client must add API methods for follow, unfollow, following
    list, and subscriptions feed requests.
17. The Flutter client must send the persisted access token with all protected
    subscription requests.
18. The Subscriptions tab must load data when opened and support pull-to-refresh
    or an equivalent retry action.
19. The Subscriptions tab must show loading, populated, empty, and error
    states without crashing or showing stale data as current data.
20. Poll cards in the Subscriptions tab must retain existing vote, like,
    comments, and real-time vote update behavior.
21. Follow/unfollow controls must show a pending state and prevent duplicate
    submissions while a request is in progress.
22. A failed follow or unfollow request must restore the previous UI state and
    show a user-readable error.
23. Profile views must expose a follow/unfollow action for another user and
    must not show a follow action for the current user's own profile.
24. Existing profile counters and session data must remain compatible with the
    new follow behavior.
25. The public feed and existing navigation tabs must continue to work when
    the subscriptions endpoint is unavailable.

## Proposed API Contract

The exact route naming must follow the existing Fastify module conventions.
The MVP should provide equivalent endpoints to the following:

```text
POST   /users/:userId/follow
DELETE /users/:userId/follow
GET    /profiles/me/following
GET    /polls/subscriptions
```

Successful follow and unfollow responses should return the target profile or a
small relationship object containing:

```json
{
  "userId": "uuid",
  "following": true,
  "followersCount": 12,
  "followingCount": 4
}
```

The subscriptions feed should return the same envelope used by the public
poll list, for example `{ "polls": [] }`, so the Flutter poll model and card
behavior can be reused.

## Data and Transaction Direction

Use the existing `follows` table and profile counters. Follow and unfollow
must run in a database transaction. The implementation should use a unique
constraint for the relationship and either a conditional counter update or a
transactionally guarded insert/delete so retries do not double-count.

The subscriptions query should join polls to follows through the poll author,
exclude deleted polls, and apply the same visibility rules as the existing
public poll list. The query must be indexed for follower ID and poll creation
time.

## Flutter UX Direction

- Keep the existing bottom navigation icon and hidden labels.
- Replace the current Subscriptions placeholder with the feed.
- Use the existing poll card to avoid divergent vote and like behavior.
- Show a compact empty state when no followed users exist, with a clear action
  to return to Home.
- Show a separate empty state when subscriptions exist but have no polls.
- Preserve the current app theme and brand color `#0018A3`.

## Testing Requirements

- Backend integration tests for authenticated follow, unfollow, duplicate
  requests, self-follow rejection, missing users, and counter correctness.
- Backend integration tests proving feed filtering, ordering, empty results,
  and exclusion after unfollow.
- Flutter client tests for request paths, authorization headers, and response
  parsing.
- Flutter widget tests for loading, populated, empty, error, retry, and
  pending follow states.
- Run existing API tests, `flutter analyze`, and `flutter test` without
  regressions.

## Acceptance Criteria

1. A user can follow another user and the relationship is persisted after an
   API restart.
2. Repeating follow or unfollow does not create errors, duplicate rows, or
   incorrect counters.
3. The Subscriptions tab displays only polls from currently followed users.
4. Vote, like, comment, and real-time update interactions work on subscription
   polls exactly as they do on the public feed.
5. Empty and error states are understandable and recoverable.
6. The implementation has automated coverage for the behavior listed above.
7. Existing MVP flows continue to pass their current automated tests.

## Implementation Order

1. Add or verify database indexes and follow repository transaction helpers.
2. Add follow/unfollow routes and current-user following queries.
3. Add the subscriptions poll repository query and route.
4. Add backend integration tests and run migrations if required.
5. Add Flutter API client models and methods.
6. Implement follow controls in profile views.
7. Replace the Subscriptions placeholder with the feed and its states.
8. Add Flutter widget/client tests and run the full verification suite.
