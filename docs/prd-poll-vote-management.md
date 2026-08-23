# PRD: Vote Management

## Introduction

Yaskapp already supports one vote per authenticated user per public poll. The
current MVP allows a user to create a vote with `POST /polls/:pollId/votes`,
rejects a second vote with `409 already_voted`, and rejects new votes after
`endsAt` with `422 poll_closed`.

This task extends voting with vote cancellation and option changes. The
backend must also remain correct when a mobile client retries a request, a
user taps a control repeatedly, or two requests for the same poll arrive at
the same time.

## Decision

Votes are mutable only while a poll is active.

- A user can cancel their vote while the poll has not ended.
- A user can change their selected option while the poll has not ended.
- Once `endsAt` is reached, the poll's votes are immutable. Existing votes
  remain visible, but create, change, and cancel operations are rejected.
- A poll without `endsAt` remains active until another product rule closes it.
- The rule is enforced by the backend; the Flutter client only reflects the
  current state and must not be the source of truth.

This rule gives users the expected ability to correct a choice during an open
poll while preserving a stable result after closing.

## Goals

- Allow an authenticated user to cancel their vote from an active poll.
- Allow an authenticated user to change their selected option in an active
  poll.
- Expose the current viewer's selected option in poll responses.
- Keep poll and option vote counters correct for create, change, and cancel.
- Make repeated requests safe and prevent duplicate counter updates.
- Keep behavior consistent across feed, subscriptions, profile, poll detail,
  and realtime updates.
- Add backend and Flutter coverage for the complete vote lifecycle.

## Non-Goals

- Multiple choices per user in one poll.
- Anonymous voting.
- Changing a vote after a poll has closed.
- Reopening or extending a closed poll.
- Editing poll options after the first vote.
- Vote history, audit UI, or showing who selected an option.
- Vote notifications or analytics changes.
- Ranking or recommendation changes based on vote changes.

## User Stories

- As a signed-in user, I can see which option I selected in a poll.
- As a signed-in user, I can change my selection while the poll is active.
- As a signed-in user, I can remove my selection while the poll is active.
- As a signed-in user, I cannot change or remove a vote after the poll closes.
- As a user on an unreliable network, retrying a vote operation does not
  double-count or corrupt the result.
- As a poll author, I see accurate aggregate counts after users change or
  cancel their votes.

## Functional Requirements

1. Backend must continue to require JWT authentication for all vote mutation
   endpoints.
2. Poll responses must include the authenticated viewer's selected option as
   `viewerVoteOptionId`, or `null` when the viewer has not voted.
3. Unauthenticated poll responses must return `viewerVoteOptionId: null`.
4. Backend must expose an operation for creating or setting a vote on an
   active poll.
5. Backend must expose an operation for cancelling the authenticated user's
   vote on an active poll.
6. Backend must expose an operation for changing the authenticated user's
   vote to another valid option on an active poll.
7. A requested option must belong to the target poll and must be a valid,
   non-deleted poll option.
8. A create request for a user who has no vote must increment exactly one
   option counter and the poll total.
9. A change request must decrement the previous option counter, increment the
   new option counter, and leave the poll total unchanged.
10. A cancel request must decrement the selected option counter and the poll
    total exactly once.
11. Counter values must never become negative.
12. Repeating the same set/change request must be a no-op after the first
    successful state transition and must return the current vote state.
13. Repeating a cancel request after the vote is already absent must be a safe
    no-op and must return the current poll state.
14. Repeating a create request must not create a second `poll_votes` row or
    increment counters twice.
15. Concurrent mutations for the same poll must be serialized so that the
    final `poll_votes` row and all denormalized counters agree.
16. Mutations received after the poll's `endsAt` must be rejected, including
    requests that started before the closing time but acquire the database
    lock after it.
17. Failed mutations must not leave a partially updated vote or counters.
18. Flutter must show the selected option and distinguish an active poll from
    a closed poll.
19. Flutter must allow changing or cancelling a vote only while the poll is
    active.
20. Flutter must disable or coalesce repeated vote actions while a request is
    in flight and reconcile the UI with the server response.
21. Flutter must show a clear error when a mutation fails because the poll has
    closed or the option is invalid.
22. Existing vote creation behavior must remain compatible for clients that
    still use the current endpoint during the migration.

## Proposed API Contract

The exact route names may follow the existing API conventions, but the
preferred contract is to model the vote as a resource whose desired state can
be set, removed, and safely retried.

### Read current viewer vote

Every poll DTO includes:

```json
{
  "viewerVoteOptionId": "uuid"
}
```

The value is `null` when there is no vote or when the request is unauthenticated.

### Set or change vote

```http
PUT /polls/:pollId/votes
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "optionId": "uuid"
}
```

The operation is idempotent: sending the same `optionId` repeatedly produces
the same state and does not change counters after the first request. It may
create a vote when none exists or replace the existing vote when the option
differs.

Success:

```json
{
  "poll": {
    "id": "uuid",
    "viewerVoteOptionId": "uuid",
    "votesCount": 12,
    "options": [
      { "id": "uuid", "votesCount": 7 },
      { "id": "uuid", "votesCount": 5 }
    ]
  }
}
```

### Cancel vote

```http
DELETE /polls/:pollId/votes
Authorization: Bearer <accessToken>
```

The operation is idempotent: deleting an already absent vote is a successful
no-op and returns the current poll state.

### Compatibility for the existing POST endpoint

`POST /polls/:pollId/votes` remains supported during the migration. Its
successful behavior must become safe for retries: repeating the same request
must not duplicate the vote or counters. A request for a different option
should return the current state with a conflict response and direct clients
to the idempotent `PUT` operation, or be handled as an equivalent set operation
if backward compatibility requires it. The implementation phase must choose
one behavior and document it in the API tests.

### Error behavior

- `400 validation_error` — malformed UUID or invalid request body.
- `401 unauthorized` — missing or invalid JWT.
- `404 not_found` — missing, deleted, non-public poll, or option outside the
  poll.
- `409` — only for a deliberately retained legacy `POST` conflict behavior.
- `422 poll_closed` — any create, change, or cancel attempt after closing.

## Data Model and Consistency Rules

- Keep one row per `(poll_id, voter_id)` in `poll_votes`.
- Keep the existing foreign-key constraint that guarantees the option belongs
  to the same poll.
- Keep the unique constraints that prevent duplicate votes.
- Add viewer-specific hydration for `viewerVoteOptionId` to all poll lists and
  individual poll responses.
- Execute each mutation in one PostgreSQL transaction.
- Lock the poll row with `FOR UPDATE` before checking `ends_at`, reading the
  current vote, modifying rows, and updating counters.
- For a change, update both option counters only when the old and new option
  differ.
- For a cancel, update counters only when a row was actually deleted.
- Prefer deriving the returned poll and viewer state from the transaction's
  committed view.
- Add database checks or a consistency query to detect negative counters and
  mismatches between `poll_votes`, option counters, and `polls.votes_count`.

No idempotency-key table is required for the core vote operations if `PUT` and
`DELETE` are implemented as the idempotent desired-state operations above.
If a future endpoint performs a non-idempotent side effect, it must introduce
an explicit idempotency key and request-result storage rather than relying on
client de-duplication.

## Backend Implementation Notes

- Extend the shared `Poll` contract with `viewerVoteOptionId: string | null`.
- Add repository methods for reading a viewer's vote and for transactional
  set/change/cancel operations.
- Replace the current insert-only repository flow with a transaction that
  locks the poll before checking its active state.
- Preserve the existing `PollClosedError` for all post-close mutations.
- Return the full updated poll so clients can replace stale option and total
  counters in one operation.
- Keep the realtime event payload aligned with the updated poll contract. The
  event should represent the aggregate change; viewer-specific state must not
  be broadcast as another user's private state.
- Add structured logs/metrics for rejected post-close operations and detected
  consistency failures without logging access tokens or request secrets.

## Flutter Implementation Notes

- Extend the poll model and JSON parsing with `viewerVoteOptionId`.
- Add API client methods for set/change and cancel operations.
- Render the current selection in the poll card or poll detail screen.
- Use `endsAt` to disable controls optimistically, but always handle the
  backend `422 poll_closed` response because the client may be stale.
- While a vote request is in flight, prevent duplicate submissions for the
  same poll and avoid applying an older response over a newer local state.
- After success, replace the whole poll summary from the response rather than
  adjusting counters locally.
- On failure, reload or restore the last server-confirmed poll state.

## Test Plan

### Backend

- Create a vote for an active poll.
- Read a poll with a selected `viewerVoteOptionId`.
- Read a poll without a vote and verify `null`.
- Repeat the same set request and verify one vote and unchanged counters.
- Change from option A to option B and verify both option counters and the
  unchanged poll total.
- Repeat the same change request and verify it is a no-op.
- Cancel a vote and verify both counters decrease once.
- Repeat cancel and verify it is a safe no-op.
- Reject invalid or foreign options.
- Reject create, change, and cancel after `endsAt`.
- Verify concurrent mutations do not produce duplicate rows, negative
  counters, or mismatched totals.
- Verify rollback behavior when an intermediate database operation fails.
- Verify legacy `POST` retry behavior according to the selected compatibility
  policy.

### Flutter

- Parse `viewerVoteOptionId` including `null`.
- Display the selected option for the current user.
- Change a selection and update all visible counters from the response.
- Cancel a selection and show the unselected state.
- Disable controls for a closed poll.
- Prevent repeated taps while a request is pending.
- Handle `422 poll_closed`, validation errors, and network failures without
  corrupting the visible state.
- Verify an older response cannot overwrite a newer server-confirmed state.

## Acceptance Criteria

- A user can set, change, and cancel a vote from Flutter while a poll is active.
- A user cannot mutate a vote after the poll closes.
- Poll responses expose the viewer's current selected option.
- Repeated set and cancel requests are safe and do not double-count.
- Concurrent requests preserve one vote per user and consistent counters.
- Changing an option transfers exactly one count between options without
  changing the poll total.
- Cancelling removes exactly one vote from both the option and poll totals.
- API and Flutter tests cover successful, repeated, concurrent, invalid, and
  post-close operations.
- `npm run api:test`, `npm run api:typecheck`, `npm run shared:build`,
  `flutter analyze`, and `flutter test` pass.
- No unrelated product features or vote history are introduced.

## Open Questions

- Should the legacy `POST /polls/:pollId/votes` treat a different option as a
  `409` conflict or become an alias for `PUT` immediately?
- Should the UI expose cancellation as a separate button, or as a third
  "remove selection" state in the option selector?
- Should realtime aggregate vote changes update cards that are open for other
  users in the first implementation, or remain limited to the existing vote
  event behavior?
- Should the product show a confirmation before cancelling a vote?
