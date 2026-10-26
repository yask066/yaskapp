# T21 Web scroll, rendering, and accessibility evidence

Captured: 2026-10-26
Scope: web browser behavior and render-cost check for T21. The 100/1,000-item traces used the local development build and deterministic mock API; final production frame/memory budgets remain in T27.

## Browser behavior

| Scenario | Evidence |
|---|---|
| Restore a third-page anchor on POP | Loaded the feed and appended pages through poll 60. Scrolled to poll 50 and opened its comments with Enter. Before navigation the saved anchor was `t21-poll-50`, top `-197.7522 CSS px`; after browser Back it remained at `-197.7522 CSS px` (0 px delta), with the feed data still present. While positioning the test, the automatic sentinel later appended page four; the restored anchor remained the page-three poll. |
| Deleted anchor / neighbor | `apps/web/src/core/scroll/list-scroll-state.test.ts`: tests retain a surviving anchor after deletion and fall back to the nearest previous surviving item if later candidates are removed. |
| Late media | In the 8-second delayed-image fixture, poll 1 changed from `complete=false` to `complete=true` (`naturalWidth=1600`) while its card top stayed `394.9957 CSS px`; card height stayed `857.8957 px` and scroll position stayed 0. The media's 16:9 aspect ratio reserves its space. |
| Footer error and Retry | Mocked the first append as HTTP 503. The live feed retained 20 polls, exposed “Request failed.” as an alert, and kept keyboard focus on “Retry loading more”. Enter retried successfully, appended to 40, and left focus on the “Load more” button; it became active again (`aria-disabled=false`). |
| Explicit reply target | Opened `/polls/t21-poll-1?comment=t21-reply-145`. The target reply appeared in the “Linked reply” section, was identified as outside the loaded pages, and the matching comment was focused and marked `aria-current="location"`. |
| Enlarged text | The embedded browser did not expose a working zoom shortcut, so set the document root font size to 200% for the check. At 724 px viewport width, the document stayed 724 px wide, no poll card overflowed horizontally, all 20 initial cards were present, and “Load more” remained visible. |

The global page has `scroll-behavior: smooth`; browser measurements showed that `{ behavior: 'auto' }` inherited the smooth motion and could replace an in-progress anchor with an intermediate scroll event. Anchor restoration and missing-anchor fallback now use `behavior: 'instant'`, which restored the measured coordinate exactly.

## Rendering at 100 and 1,000 polls

Measured the actual feed with the deterministic mock API, appending 20 polls per page and retaining all cards in the DOM. The baseline showed repeat work across existing cards. The smallest useful bound was to memoize the feed item and stabilize mutation/navigation callbacks (including `PollCard`); appended pages still retain the existing data and DOM, while unchanged rows can bail out of React rendering. No windowing was added.

| Loaded polls | Last append commit (React Profiler) | Long tasks / frame sample | JS heap |
|---:|---:|---:|---:|
| 100 | 75.7 ms actual, 324 ms base | 5 long tasks, max 112 ms; 3,718 RAF intervals, p95 17 ms, max about 100 ms | 34.5 MB |
| 1,000 | Recent append commits ranged from 7 to 99 ms actual (up to 46.8 ms in a second commit); final commit 29.1 ms | 47 long tasks, max 131 ms; 5,000 RAF intervals, p95 17 ms, max about 100 ms | 91.5 MB heap / 110.4 MB total |

These development-build figures justify avoiding repeated React work, but are not a production performance pass: instrumentation, the local mock API and dev runtime affect the numbers. T27 owns the production profile and frame/memory thresholds.

## Keyboard, accessibility tree, and motion

- The browser accessibility tree exposed the append button by name, the append error with `role=alert`, and the focused button after retry. Keyboard Enter completed both append and Retry.
- A live screen-reader speech check was not available in this run: NVDA was not installed or running, and no screen-reader output channel was available. The AX tree is not claimed as spoken-output evidence; this part remains open in the T21 checklist.
- Existing web tests `EntryMotion.test.tsx` and `motion-settings.test.tsx` cover reduced motion, clearing the old entry-animation registry, and avoiding replay after remount. The final web suite below also passed.

## WEB-FINAL

Commands were run from the repository root after removing browser instrumentation and the temporary benchmark harness:

| Command | Result |
|---|---|
| `npm run typecheck -w @yaskapp/web` | Exit 0 |
| `npm run lint -w @yaskapp/web` | Exit 0 (`eslint src --max-warnings 0`) |
| `npm run test -w @yaskapp/web -- --run` | Exit 0; 43 files and 338 tests passed |
| `npm run build -w @yaskapp/web` | Exit 0; Vite production build completed |

The first full-suite run caught the updated scroll behavior in a public-profile assertion; its expected behavior was changed from `auto` to `instant`, then the full suite passed. Lint also exposed one unused `hasNextPage` destructure in `CommentThread` and dependency warnings in the new stable feed callbacks; both were cleaned up before the successful final run.
