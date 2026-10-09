# M23 web verification

**Date:** 9 October 2026
**Scope:** M23 — web card entry motion. `entryMotion` remains off by default; the browser preview explicitly enabled it for this check.

## Automated checks

- Web suite: 236 passed, 0 failed across 36 test files.
- Web typecheck: passed.
- Web lint: passed with `--max-warnings 0`.
- Web production build: passed.
- Feed, search, public-profile, poll-detail/comments, reply, notification, `EntryMotion`, and `ContentEntryTransition` tests passed. StrictMode observer cleanup, one-time entry, offscreen IDs, session reset, reduced motion, and the 120 ms skeleton crossfade have direct coverage.

The sandbox blocks Node's native `realpathSync`; Vitest and Vite were run with a task-local preload that maps that call to the supported Node implementation. This does not alter product source or dependencies.

## Browser anchor check

A local preview used the shared T02 poll fixture through a temporary mock API. It did not use a live backend. Entry motion was enabled only in the temporary local preview.

- Viewport: 1280×720 CSS px; no user scroll during the measurement.
- The first visible poll entered with `data-entry-motion="active"`; the remaining offscreen polls stayed idle.
- After the 200 ms entry animation and its stagger window, the visible poll's transform was `matrix(1, 0, 0, 1, 0, 0)` and its layout height remained stable.
- Across six cards, `getBoundingClientRect().top - offsetTop` ranged from 408.905 to 409.639 CSS px: 0.735 CSS px spread.

The browser check covers the current fixture and viewport. Device and frame-time profiling remain part of M26; this evidence does not change G0.
