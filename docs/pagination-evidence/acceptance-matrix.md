# T27 acceptance matrix

**Captured:** 2026-10-28 12:13 UTC

**Revision:** `4c3835b` plus the T27 web changes in this worktree
**Disposition:** **CLOSED BY USER DECISION — PARTIAL EVIDENCE.** T27 was closed on 2026-10-28 at the user's request without running the AC matrix, TalkBack speech checks, or API checks. Headless browser traces and physical Android profile workloads ran. Feed100, feed1000 and roots1000 exceeded the frame budget; roots100 narrowly met it and the three-branch workload met it. Android synthetic lifecycle and physical anchor probes ran. Closure records the user's acceptance of the remaining gaps; it does not mark them as passed.

## Environment and evidence

- Web capture: Windows 11 x64, Node 24.7.0, npm 11.5.1, headless Chrome 156.0.8078.48, Intel Core i7-10870H (16 logical CPUs), 16 GB RAM, 1440×1000 CSS px, device scale factor 1. GPU acceleration was disabled. The production Vite build used a local deterministic mock API, 20 items per page and 12 ms response delay. It exercised feed and roots at 100 and 1,000 items, plus three expanded branches with 65 replies each. Exact Chrome flags and captured host details are in the summary JSON.
- The PRD web criterion is fewer than 5% of animation-frame intervals above 16.7 ms. In this headless capture the measured RAF ratios are 25.45–36.82%, so the acceptance criterion remains **unverified** and this run is not a pass. Samples cluster around 16.6–16.8 ms in the headless scheduler; this run cannot establish physical-display frame timing. CDP `DroppedFrame` / `BeginFrame` ratios are supplementary diagnostics, not the PRD criterion. Raw RAF samples are included in each final run's `frameMetrics` in the summary JSON.
- Android capture: physical Samsung SM-A325F, Android 13/API 33, 1080×2400 at 420 dpi. The active display mode was 90 Hz (the phone also supports 60 Hz). A profile-only entry point rendered the production Flutter feed/comments screens with deterministic in-process fixtures and a no-op realtime client; it made no account, HTTP, or WebSocket requests. The run scrolled to poll 1,000 and root 1,000, then expanded and traversed three 65-reply branches using repeated 60 ms ADB swipe gestures. `FrameTiming.totalSpan` was compared with the T27 60 Hz budget of 16.67 ms while the display remained at 90 Hz; no display settings were changed. Each sample window covers screen entry, the scripted scroll workload and return to the fixture home screen.
- Android profile measurements (all samples are in [the raw profile JSON](t27-android-sm-a325f-profile.json); reproduce with [the profile fixture](../../apps/mobile/tool/t27_profile_main.dart)):

  | Workload | Frames | >16.67 ms | p95 total span | Max total span | Result vs <5% |
  |---|---:|---:|---:|---:|---|
  | Feed, 100 polls | 585 | 210 (35.90%) | 26.59 ms | 62.20 ms | FAIL |
  | Feed, 1,000 polls | 4,489 | 486 (10.83%) | 22.24 ms | 255.05 ms | FAIL |
  | Comments, 100 roots | 377 | 18 (4.77%) | 16.665 ms | 192.529 ms | PASS, narrowly |
  | Comments, 1,000 roots | 3,182 | 163 (5.12%) | 16.81 ms | 319.09 ms | FAIL |
  | Comments, 3 branches × 65 replies | 1,232 | 55 (4.46%) | 16.03 ms | 99.24 ms | PASS |

  These are real-device frame callback samples, not API latency measurements. Feed100 used 50 scripted ADB swipes of 60 ms each; both 100-item screens reached their final item. Roots100 was only 5 μs below the 16.67 ms p95 cutoff and had a 192.529 ms maximum outlier. The physical anchor probe measured 0 px drift after the unanchored sliver above the list grew 96 logical px. Three Android fixture lifecycle cycles each loaded ten pages / 200 items, then exited with 0 active requests, 0 listeners after removal and 0 retained controller items. PSS after ten idle seconds was 176.177, 176.004 and 177.308 MB against a 175.461 MB idle baseline. These fixture cycles do not verify the production screen cache or its five-minute TTL; full AC-01–18 and screen-reader speech remain unverified.
- Reproduce the production capture from the repository root with `npm run build -w @yaskapp/web` followed by `node scripts/t27-web-profile.mjs`. The harness launches Chrome with the recorded flags, creates the deterministic local fixture server, captures the traces and writes the summary. Set `CHROME_PATH` if Chrome is installed elsewhere; `T27_TEMP_DIR` optionally selects a profile directory. The harness defaults to the Windows Chrome install path and a temporary directory.
- Raw browser traces and per-run measurements: [profile results](t27-web-profile-results.json), [capture harness](../../scripts/t27-web-profile.mjs), [feed 100](t27-web-100-trace.json.gz), [feed 1,000](t27-web-1000-trace.json.gz), [roots 100](t27-web-comments-100-trace.json.gz), [roots 1,000](t27-web-comments-1000-trace.json.gz), [three reply branches](t27-web-comments-100-3branches-trace.json.gz). The earlier feed capture is preserved in [before results](t27-web-profile-before-results.json) and [raw before traces](t27-web-100-before-trace.json.gz), [t27-web-1000-before-trace.json.gz](t27-web-1000-before-trace.json.gz).
- Shared fixture: [`test/fixtures/feed-comments-pagination.json`](../../test/fixtures/feed-comments-pagination.json). Existing API, Flutter and web evidence is linked from the rows below and from [the evidence README](README.md), [T14 Flutter evidence](t14-flutter-scroll-accessibility.md), [T21 web evidence](t21-web-scroll-accessibility.md), [T22 snapshot lifecycle](t22-snapshot-lifecycle.md), and [T26 runbook](t26-runbook.md).

## AC-01–AC-18

"Automated evidence" refers to committed tests and prior evidence, not a claim that the full Android/web/API acceptance run completed. `PARTIAL` means that evidence exists but at least one required runtime or integration condition remains unverified. `BLOCKED` means the required environment was unavailable.

| AC | Automated and existing evidence | Android runtime | Web runtime | Overall |
|---|---|---|---|---|
| AC-01 | The fixture encodes the ordered poll/root/reply sets. Web `PollDetailPage.test.tsx` traverses 125 roots; Flutter `poll_comments_screen_test.dart` verifies root cursor continuation. API route/integration traversal was not run in T27. | PARTIAL — profile workloads only | PARTIAL — component tests only; no live API fixture | PARTIAL |
| AC-02 | Client tests cover empty/exhausted lists and cursor boundaries; Flutter `feed_pagination_test.dart`, web `FeedPage.test.tsx`, and web comments pagination tests. Full 0/1/19/20/21/40 API matrix not run against a database. | PARTIAL — profile workloads only | PARTIAL — automated component tests only | PARTIAL |
| AC-03 | Cursor codec tests round-trip tuple timestamps at microsecond precision and their ID fields in `services/api/src/modules/polls/poll-pagination.test.ts`; database ordering integration was not run. | PARTIAL — profile workloads only | PARTIAL — no live API ordering run | PARTIAL |
| AC-04 | Web and Flutter client tests cover stale/deleted rows and cache reconciliation. Mutation-between-pages, visibility and boundary deletion require the unavailable API integration environment. | PARTIAL — profile workloads only | PARTIAL — client tests only | PARTIAL |
| AC-05 | Flutter cursor controller tests cover repeated append and scroll storms; web `FeedPage.test.tsx` covers duplicate click and a single append request. No device/browser acceptance run for all surfaces. | PARTIAL — profile workloads only | PARTIAL — component tests only | PARTIAL |
| AC-06 | Flutter controller and web feed/comments tests cover append retry, refresh failure, retained pages and cursor reuse. | PARTIAL — profile workloads only | PARTIAL — component tests only | PARTIAL |
| AC-07 | Flutter and web lifecycle tests cover stale responses, refresh/append races and account/query identity isolation. Two-account live runtime validation remains open. | PARTIAL — profile workloads only | PARTIAL — automated lifecycle tests only | PARTIAL |
| AC-08 | Flutter/web tests cover reactions, deletion, stale snapshots and tombstones; no live reordered HTTP/realtime acceptance run. | PARTIAL — profile workloads only | PARTIAL — automated tests only | PARTIAL |
| AC-09 | Flutter `poll_comments_screen_test.dart` and web `PollDetailPage.test.tsx` cover created root/reply overlays, cursor preservation and deduplication. Live ambiguous-write/API reconciliation not run in T27. | PARTIAL — profile workloads only | PARTIAL — component tests only | PARTIAL |
| AC-10 | Web `CommentThread.test.tsx` verifies failures and Retry remain isolated to their expanded reply branch; Flutter reply-screen tests cover branch behavior. No concurrent live-service run. | PARTIAL — profile workloads only | PARTIAL — component tests only | PARTIAL |
| AC-11 | Web T21 captured an explicit reply target in linked context. T13 Flutter target flow is closed with 51 targeted tests passed; the target latency budget was not measured. | PARTIAL — profile workloads only; target latency not measured | PARTIAL — prior browser evidence, no T27 live API run | PARTIAL |
| AC-12 | Flutter and final Android-targeted tests assert ≤8 logical px for resize during user scroll and for a second media growth immediately after host correction; an end-boundary viewport-clamp regression verifies a single rebase without retries. Web T21 browser anchor restoration measured 0 CSS px and covered late media/200% text. | PARTIAL — physical profile probe restored the captured anchor with 0 logical px drift after 96 px header growth; cache TTL/keyboard lifecycle is not fully exercised here | PARTIAL — prior browser check; no physical display | PARTIAL |
| AC-13 | Flutter/web Popular tests cover stable order across reaction and empty-page continuation. T22 records PostgreSQL snapshot lifecycle evidence; T27's full API suite was unavailable. | PARTIAL — profile workloads only | PARTIAL — automated tests, no T27 live API | PARTIAL |
| AC-14 | Flutter/web expiry and repeated-cursor tests cover retained pages and explicit refresh; T22 documents deletion/expiry cleanup against PostgreSQL. Current T27 API integration was not run. | PARTIAL — profile workloads only | PARTIAL — automated tests, no T27 live API | PARTIAL |
| AC-15 | Client tests cover guest feed/Following, account-scoped caches and subscription invalidation; API cursor scope unit tests pass. Foreign-cursor and subscription changes were not exercised against a live service in T27. | PARTIAL — profile workloads only | PARTIAL — automated tests only | PARTIAL |
| AC-16 | Flutter/web API tests cover legacy decoders, defaults and unsupported pagination metadata. Cross-version deployment compatibility was not exercised against a running API. | PARTIAL — profile workloads only | PARTIAL — automated tests only | PARTIAL |
| AC-17 | Flutter widget tests cover keyboard focus, 200% text and reduced motion; web tests and T21 AX tree cover keyboard and focus. NVDA was unavailable in T21, TalkBack/device speech was not run, so spoken screen-reader output is unverified. | PARTIAL — device profile only; TalkBack speech not run | PARTIAL — keyboard/AX tree only; no NVDA speech run | PARTIAL |
| AC-18 | Flutter/web tests cover short and empty pages, automatic-load bounds, repeated cursors and manual recovery. API route behavior under live repeated/short responses was not run in T27. | PARTIAL — profile workloads only | PARTIAL — component tests only | PARTIAL |

## Production browser performance

The summary JSON contains the raw RAF samples, aggregate metrics, trace event counts, SHA-256 digests, Chrome launch flags and host details. The table reports the PRD frame-duration measurement and keeps compositor dropped frames as a separate diagnostic.

| Workload | Rendered | RAF intervals >16.7 ms | CDP Dropped / BeginFrame (supplementary) | Long tasks | JS heap |
|---|---:|---:|---:|---:|---:|
| Feed | 100 cards | 56 / 220 (25.45%) | 3 / 221 (1.36%) | 1 | 6.73 MB |
| Feed | 1,000 cards | 99 / 366 (27.05%) | 20 / 386 (5.18%) | 1 | 34.96 MB |
| Comment roots | 100 roots | 81 / 220 (36.82%) | 0 / 221 (0.00%) | 0 | 6.23 MB |
| Comment roots | 1,000 roots | 106 / 364 (29.12%) | 13 / 364 (3.57%) | 0 | 28.68 MB |
| Comment branches | 100 roots + 3 × 65 replies | 76 / 249 (30.52%) | 0 / 249 (0.00%) | 0 | 9.82 MB |

Every headless workload is above the 5% RAF threshold, so none is recorded as passing the web performance gate. The 1,000-card workload has one long task and a 216.7 ms maximum RAF interval. In the pre-change 1,000-card capture, 113 / 389 RAF intervals (29.05%) exceeded 16.7 ms; the current run recorded 99 / 366 (27.05%). Both exceed the criterion. Its supplementary compositor count is 63 / 404 (15.59%) before and 20 / 386 (5.18%) now; this does not replace the required measurement. The feed containment and comment-row memoization/containment changes have regression tests in `FeedPage.test.tsx`, `PollDetailPage.test.tsx` and `CommentThread.test.tsx`. A normal visible-browser/display capture remains necessary to determine real frame pacing.

## Android profile performance

The physical profile run used a Samsung SM-A325F on Android 13/API 33, at its active 90 Hz refresh rate. The acceptance threshold remains 16.67 ms per frame to match the 60 Hz T27 budget. Data is synthetic and served by the in-process fixture; the app made no HTTP or WebSocket requests. Raw Android `FrameTiming` samples and summaries are in [the Android profile JSON](t27-android-sm-a325f-profile.json).

| Workload | Items | Frames | Over 16.67 ms | p95 | Maximum | Result |
|---|---:|---:|---:|---:|---:|---|
| Feed | 100 polls | 585 | 210 / 585 (35.90%) | 26.589 ms | 62.199 ms | FAIL |
| Feed | 1,000 polls | 4,489 | 486 / 4,489 (10.83%) | 22.239 ms | 255.054 ms | FAIL |
| Comment roots | 100 | 377 | 18 / 377 (4.77%) | 16.665 ms | 192.529 ms | PASS, narrowly |
| Comment roots | 1,000 | 3,182 | 163 / 3,182 (5.12%) | 16.813 ms | 319.089 ms | FAIL |
| Comment replies | 3 branches × 65 replies | 1,232 | 55 / 1,232 (4.46%) | 16.028 ms | 99.244 ms | PASS |

Feed100 was driven with 50 scripted ADB swipes of 60 ms each; both 100-item screens reached their final item. This fast scripted input is part of the measured workload and makes the feed100 result unusually high, so it should not be read as ordinary user scroll pacing. Roots100 met the percentage threshold by 0.23 percentage points and its p95 was only 5 μs below the frame cutoff, despite a 192.529 ms maximum outlier. The 1,000-item feed and roots continue to exceed the 5% budget.

## Browser lifecycle and anchors

The production browser harness ran three open → load ten feed pages (200 cards) → unload cycles. Baseline heap after GC was 584,464 bytes. Post-unload heap was 584,464; 584,464; and 585,436 bytes; it did not rise monotonically. Each cycle returned to 1 document, 4 DOM nodes and 0 JS event listeners, with 0 active mock API requests. This checks document disposal; it does not prove in-app cache expiry, retained screen release or the five-minute cache policy.

On the Android profile fixture, three additional open → load ten synthetic pages (200 items) → Home cycles completed. Each loaded 10 pages with 10 completed requests in 93–101 ms; at exit active requests were 0, the listener count was 0 after removal, and controller items fell from 200 to 0. Process PSS was 175,461 KB after a 10-second idle baseline, then 176,177, 176,004 and 177,308 KB after each corresponding 10-second Home idle period. PSS varied by up to 1,847 KB over the baseline and is a process-wide diagnostic; the slight drift does not prove release to an exact memory baseline. The harness exercises a synthetic `CursorListController`, not the production `FeedScreen`, real API, five-minute cache TTL or retained-route cache.

The physical Android anchor probe captured `anchor-item-0` at 200 logical px in the viewport, grew an unanchored sliver header by 96 logical px, and measured 0 logical px drift (≤8 px criterion). The profile's separate 18-frame diagnostic sequence had 5 frames over 16.67 ms; this short anchor probe is not included in feed/comments workload budgets. `ListScrollAnchorHost` now handles `ScrollMetricsNotification` and restores from the current post-layout item IDs. The final Android-targeted Flutter run passed 36 anchor, scroll-state and cursor-controller tests.

## Final checks and blockers

| Area | Result |
|---|---|
| Shared/API | Earlier T27 evidence: `npm run shared:build` PASS; `npm run api:typecheck` PASS; `services/api/src/modules/polls/poll-pagination.test.ts` 17/17 PASS with inert local test-only environment. Full `npm run api:test` remains incomplete; no API check was run in this Android pass, per user instruction. |
| Flutter / Android | T27 run: `flutter analyze` PASS; `flutter test` 383 passed, 1 skipped. T14 final run: `flutter analyze` PASS; `flutter test` 390 visible passed, 1 skipped, plus 49 hidden passed; `flutter build apk --debug` PASS. After the final bottom-boundary correction, the connected SM-A325F targeted anchor/state/controller/Following/accessibility suite passed 67/67. Earlier selected feed/comments suites passed (56 tests); after the T27 anchor fix the focused suite passed 36/36, and `flutter analyze --no-pub` passed. Debug, fixture profile and normal profile APK builds passed. Android 100-item baselines, three synthetic lifecycle cycles and the physical anchor probe are captured above. Feed100 and feed1000, plus roots1000, miss the frame budget; roots100 is a narrow pass and the three-branch workload passes. TalkBack speech remains unverified. The phone is restored to the saved original APK; the installed SHA-256 matches the pre-check backup. |
| Web | `npm run typecheck -w @yaskapp/web` PASS; `npm run lint -w @yaskapp/web` PASS; `npm run test -w @yaskapp/web -- --run` PASS, 44 files / 350 tests; `npm run build -w @yaskapp/web` PASS. |
| Other open dependencies | T21 live screen-reader speech is not verified. T26's staging load run was explicitly cancelled earlier; its documented load budgets remain unmeasured. |

**T27 completion decision:** close T27 by the user's decision on 2026-10-28 with partial evidence and accepted gaps. Keep the four checklist items unchecked because they were not fully completed: Android has 100- and 1,000-item feed/root measurements, the three-branch workload, three synthetic lifecycle cycles, and a physical anchor pass; feed100, feed1000 and roots1000 miss the frame budget; the lifecycle fixture does not verify production cache retention; and AC-01–18, API checks and TalkBack speech were not completed. The user explicitly asked to close without AC-matrix and TalkBack checks and had previously excluded API checks. This disposition records closure by decision, not successful passage of the incomplete gates.
