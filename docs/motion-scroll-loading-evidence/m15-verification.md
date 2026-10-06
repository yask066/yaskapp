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
