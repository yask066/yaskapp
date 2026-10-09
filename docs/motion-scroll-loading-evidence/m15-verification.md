# M15 verification — Web static loading

Date: 6 October 2026 (UTC+3).

## Automated checks

- `npm run test -w @yaskapp/web -- --run`: 210/210 tests passed across 32 files.
- Targeted loading, feed, notification, profile, search, poll detail, comments and reply suites passed.
- `npm run typecheck -w @yaskapp/web`: passed.
- `npm run lint -w @yaskapp/web`: passed.
- `npm run build -w @yaskapp/web`: passed; Vite transformed 125 modules.
- `git diff --check`: clean.

Clock tests cover the 149/150 ms boundary, immediate resolution, static/decorative semantics and the four skeleton kinds. Feed tests cover cached refetch and a failed refetch retaining the existing card. Notification tests cover initial loading, cursor loading, and retrying a load-more failure with the same operation.

## Manual checks not measured

- Browser geometry and keyboard focus were not measured. The local Vite server started on `0.0.0.0:5173`, but the Codex in-app browser could not connect to the preview (`net::ERR_CONNECTION_TIMED_OUT`).
- A real screen reader was not available in this run. Automated DOM checks confirm decorative skeletons are hidden, loading regions have one status, and Retry is a keyboard-operable button; these checks do not replace a screen-reader pass.

No frame-time, device, or real screen-reader result is claimed by this evidence.

## M15 close-out — 9 October 2026

### Automated checks

- Current web suite: 238/238 tests passed across 36 files, including the new Retry focus regression.
- Vitest emitted existing MSW warnings for unhandled `/auth/me` and `/polls?limit=20` requests in unrelated fixture cases; the suite exited 0 and all assertions passed.
- `npm run typecheck -w @yaskapp/web`: passed after `npm run shared:build`.
- `npm run lint -w @yaskapp/web`: passed.
- `npm run build -w @yaskapp/web`: passed; Vite transformed 133 modules.
- Loading tests assert the 149/150 ms boundary, immediate area reservation, exactly one `role=status`, and decorative skeleton exclusion from the accessibility tree.
- Feed integration test activates Retry with Enter, verifies focus moves to the persistent main landmark without scrolling, then verifies focus remains there after data arrives.

### Browser geometry and keyboard/accessibility check

- Environment: Codex in-app browser, visible viewport 724×612 screen pixels, local Vite app and T02 fixture API; no user scroll during the measured transitions.
- On initial feed load the poll skeleton occupied the reserved first-card area below the filters. After the fixture response, the first poll card began at the same visible y-position (about 445 px); the feed heading, composer, and filters stayed in place. This was a screenshot comparison, not a programmatic `DOMRect` capture.
- In the T02 `timeout` scenario the API fixture waited 15 seconds; the client showed its retryable timeout after the 10-second read deadline. Tab navigation reached the named Retry button and Enter activated it.
- During Retry → loading, browser accessibility state showed one `Loading polls` status. The skeleton rows were absent from the tree; after the fix, focus stayed on `main-content` through the transition and the page did not jump vertically.
- The browser accessibility tree and keyboard path were checked. Spoken output on a standalone screen reader was not measured; no claim about announcement timing or pronunciation is made.

M15's two verification items are closed against the plan's observable acceptance criteria: focus remains in the affected page, one status is exposed, and Retry is keyboard accessible after timeout; loading geometry and the affected page checks are recorded above. Spoken screen-reader output remains explicitly unmeasured.
