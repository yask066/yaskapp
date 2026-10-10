# M26 automated verification

**Date:** 9 October 2026
**Checkout:** `116b3a8c3893c1fd9bba55733b37fd8b4bc661c8`
**Result:** automated checks passed; M26 remains open because live flag matrix, lifecycle-cycle measurement, and paired AC-12 profiling were not performed.

## Current status — 10 October 2026

The dated 9 October report below is historical. Later work captured the 60/90 Hz Android flag matrix and renderer A/B, implemented the user-approved PollCard painter slice, reran the Flutter suite (270 passed, 1 skipped), and added a successful-comments T02 fixture route (12/12 fixture tests). The painter retest did not meet AC-12: the absolute ≤1% late-frame limit fails, including motion-off runs, and the 60 Hz reactions delta exceeds +0.5 pp. A matched 20-cycle M17/painter resource and request comparison now exists; direct Flutter listener/controller/timer counts remain unavailable. Painter 200% text bounds fit the device width; live reduced-motion toggling preserved the like result, but animation suppression was not directly measured, and TalkBack speech was not independently heard. See [10 October device evidence](m26-device-2026-10-10/README.md) and the [current plan update](../superpowers/plans/2026-10-02-motion-scroll-loading.md). G0 remains **NOT PASSED**; do not mark AC-12 passed or enable motion in release builds.

## Addendum — 10 October 2026

**Checkout:** `3b3d2966e544d5ec11c2ddf4fa4286007c9ed571` (`docs: record M24 device smoke evidence`).

**Latest 10 October working-tree follow-up:** PollCard rendering experiment and widget tests; Samsung 90 Hz renderer comparison; successful Comments request/lifecycle retest. Current Flutter suite: 269 passed, 1 skipped. Current focused analyze of PollCard and its layout tests: clean.

### Current automated checks

| Platform | Command | Result |
|---|---|---|
| Web | `npm run test -w @yaskapp/web -- --run` | 36 files, 240 passed, 0 failed. Existing MSW unhandled-request notices were printed to stderr. |
| Web | `npm run typecheck -w @yaskapp/web` | Passed. |
| Web | `npm run lint -w @yaskapp/web` | Passed with `--max-warnings 0`. |
| Web | `npm run build -w @yaskapp/web` with all four `VITE_REACTIONS_MOTION` / `VITE_ENTRY_MOTION` combinations | Four production builds passed and emitted distinct JS bundles. |
| Flutter | `flutter test --no-pub` from `apps/mobile` | 266 passed, 1 skipped, exit 0. |
| Flutter | `flutter test --no-pub test/motion_flags_test.dart` with defaults | 2 passed. Reactions-only and both-on define-specific flag tests each passed. |
| Flutter | `flutter analyze --no-pub lib/main.dart lib/src/core/motion/motion_flags.dart test/motion_flags_test.dart` | No issues found. |
| Flutter | Profile APK with frame probe, flags off; reactions-only; both flags on | All three builds succeeded (75.3 MB, 85.2 MB, and 85.2 MB). Build warnings were the existing Firebase KGP migration notice and icon tree-shaking notice. |

The supported Flutter entry point reads `MotionFlags.fromEnvironment()` in `apps/mobile/lib/main.dart` and passes both independent values to `YaskappApp`; defaults remain false. The 9 October statement that no root-level build configuration existed was stale against this checkout. The later working-tree follow-up adds the measured PollCard raster reductions and their widget tests; those edits do not change motion flag defaults or API behavior.

### Web functional smoke

Using the T02 profiling fixture (100 polls) and a local Vite server, root-level flag modes were checked in the running app:

- Flags off: reactions class absent and entry state idle. Like changed 99→100 and vote changed 50→51 through the fixture-backed API.
- Reactions only: reactions class present and entry state idle. Like changed 100→99 through the same fixture-backed API.
- Both on: reactions class present and entry motion activated for the first visible card; the displayed vote/like values persisted across the rebuild.
- Twenty list→detail→back cycles in flags-off and both-on modes each kept the selected card at the same viewport coordinate (252.27 CSS px; maximum drift 0 CSS px). Focus returned to the card after back navigation.
- Keyboard Tab focus reached the named “More poll actions” control. At a 390×844 responsive viewport, the measured card width was 343.67 CSS px and there was no horizontal overflow.

This was a development-server interaction smoke, not production profiling. It did not verify error/loading under every root flag mode, screen-reader speech, 200% text scale, browser reduced-motion changes, resource/listener/timer counts, background behavior, or the full performance matrix.

### Remaining M26 evidence

At the end of this run `adb devices -l` listed no connected device. Thus no current physical Android run, TalkBack speech/text-scale smoke, Android 20-cycle resource comparison, or paired 60/90 Hz AC-12 trace could be collected. The prior Android profile still fails the absolute threshold in documented runs and cannot substitute for the current off/on pair.

| Requirement | Updated status | Evidence / gap |
|---|---|---|
| Correctness, errors, loading and anchors across flags off, reactions-only, and both-on | **Partial** | Web root flags and basic like/vote behavior were exercised in all three modes; automated suites cover the broader behavior. Error/loading and full anchor/network matrix were not repeated in every mode and platform. |
| Keyboard, screen reader, 200% text, live reduced motion, interrupted targets, restored focus, no repeated entry | **Partial** | Web Tab focus and restored focus were checked; current suites cover interruptions, reduced-motion updates, semantics and entry/remount. No current physical screen-reader or 200% text-scale run. |
| Twenty list → detail → back cycles with listeners/controllers/timers/request comparison | **Partial** | Web completed 20 cycles off and both-on with 0 CSS px drift. Resource/listener/timer/request/background comparison and Android cycles remain unmeasured. |
| Paired motion-off/on 3×30 s traces for each required viewport/device, including first load | **Not measured** | Production build matrix passed, but no qualifying current trace was captured. Current phone is disconnected; prior Android evidence breaches the absolute 1% limit in recorded workloads. |

M26 remains open. Do not mark AC-12 or G0 passed. The build-time flag prerequisite is present; the remaining device, accessibility, lifecycle-resource and paired-performance evidence is still required.

## Commands and results

| Platform | Command | Result |
|---|---|---|
| Web | `npm run test -w @yaskapp/web -- --run` | 36 files, 236 passed, 0 failed. Exit 0. Some unrelated MSW requests in existing page tests wrote unhandled-request messages to stderr; the suite passed. |
| Web | `npm run typecheck -w @yaskapp/web` | Passed. |
| Web | `npm run lint -w @yaskapp/web` | Passed with `--max-warnings 0`. |
| Web | `npm run build -w @yaskapp/web` | Production build passed; Vite 6.3.5 produced the web bundle. |
| Flutter | `flutter test --no-pub` from `apps/mobile` | 263 passed, 1 skipped, exit 0. |
| Flutter | Focused `motion_settings_test.dart`, `animated_count_test.dart`, `entry_motion_test.dart` | 24 passed. |
| Flutter | Focused analyze for motion and PollCard files | Exit 1 due to one info diagnostic: `prefer_const_constructors` at `test/motion_settings_test.dart:23`. No product-source diagnostics in the focused set. |

Initial Web and Flutter commands stalled or failed before test collection inside the sandbox (Node `realpathSync` EPERM; Flutter emitted no output). Reruns outside the sandbox completed successfully. A direct Dart CLI analyze also failed before analysis because `Platform.resolvedExecutable` was null; Flutter analyze outside the sandbox provided the focused result above.

## Device and flags

`D:\Android\platform-tools\adb.exe devices -l` found physical Samsung `SM-A325F` (`RF8R321M9LJ`), Android 13/API 33. This establishes device availability for a future run; this M26 session did not install or profile a fresh build on it.

The 9 October report stated that the mobile entry point called `const YaskappApp()` without passing flags. This statement is superseded by the 10 October addendum: the current entry point reads `MotionFlags.fromEnvironment()`, with both flags defaulting to false, and passes them to `YaskappApp`. The supported build configuration exists, but no device was connected for this M26 run.

## Open M26 evidence

| Requirement | Status | Evidence / gap |
|---|---|---|
| Correctness, errors, loading and anchors across flags off, reactions-only, and both-on | **Partial** | 10 October web smoke exercised root flags in all three modes and verified fixture-backed like/vote behavior; current suites cover broader states. Error/loading and full cross-platform matrix were not repeated in every mode. |
| Keyboard, screen reader, 200% text, live reduced motion, interrupted targets, restored focus, no repeated entry | **Partial** | Automated tests cover target interruption, live reduced motion, semantics, disposal/backgrounding, virtualized remount and one search-back navigation case. M17's 200% Android layout/TalkBack hierarchy and web keyboard evidence predate M21–M24; spoken TalkBack output was not independently heard. No M26 physical accessibility smoke was captured. |
| Twenty list → detail → back cycles with listeners/controllers/timers/request comparison | **Partial** | Web completed 20 cycles with flags off and both-on at 0 CSS px drift and focus restoration; Android successful-response cycles, requests and background-return anchor are captured. Matching M17 Android listener/controller/timer and resource baseline remains absent. |
| Paired motion-off/on 3×30 s traces for each required viewport/device, including first load | **Not measured / prior Android baseline fails** | No current-commit paired profile was captured. Existing [8 October Android AC-12 evidence](android-ac12-2026-10-08/README.md) already fails the absolute 1% ceiling in every 90 Hz scroll run, one 60 Hz scroll run, and all reaction runs. Existing web profiles predate M21–M24 and are not the required pair. |
| Targeted suites and checks | **Passed with one analyzer info** | Results above. The lone info diagnostic is in a test file and does not fail Flutter tests. |

## Acceptance criteria status

| AC | M26 status | Current evidence |
|---|---|---|
| AC-01 | **Fail / prior scope exception** | M19–M25 were implemented before G0 passed, as recorded in the plan and M18 report. This run does not change that order. |
| AC-02 | **Partial** | Current Web/Flutter suites pass. Cross-platform behavior was not repeated under all root flag combinations. |
| AC-03 | **Partial** | Current Web full suite includes M05 reordered vote/like race cases; historical M17/M06 strict race evidence exists. No current all-flags/realtime integration matrix was captured. |
| AC-04 | **Partial** | M21 web geometry measured ≤2 CSS px and M22 Flutter action/layout tests pass. The painter run at 200% text scale has no horizontal overflow, but did not remeasure the ≤2 px geometry deltas. |
| AC-05 | **Partial** | Historical M17/M23 anchor evidence and current list tests exist. No fresh paired on-device/web scroll-anchor run with M21–M24 enabled was captured. |
| AC-06 | **Partial** | Current Flutter full suite includes M24 navigation tests; web full suite includes list/detail/back anchor tests. Twenty-cycle cross-platform resource comparison remains open. |
| AC-07 | **Partial** | Search, keyboard-related, and notification-target tests pass in current suites; no new cross-platform keyboard/focus smoke across all flag modes. |
| AC-08 | **Partial** | Existing loading/error/retry tests pass and M25 keeps skeletons static. No fresh full loading matrix across the M26 flag modes. |
| AC-09 | **Pass for automated component coverage** | Current suites cover immediate target semantics, interrupted values, count/bar/like motion and unchanged data callbacks. |
| AC-10 | **Pass for automated component coverage** | Current suites cover one-time entry, offscreen handling, virtualized remount, and entry completion. Device-level behavior is not covered. |
| AC-11 | **Partial** | Automated reduced-motion, semantics and lifecycle tests pass. The foreground painter run toggled system reduced-motion settings and preserved the like result, but did not directly confirm frame-by-frame suppression; TalkBack speech remains unverified. |
| AC-12 | **Fail / paired comparison captured** | Current Android off/on 3×30 s traces fail the 1% ceiling at both active rates; 60 Hz reaction also exceeds the +0.5 pp regression budget. The 90 Hz Skia/Impeller A/B shows both renderers near 99% late frames. |
| AC-13 | **Partial** | Same-lockfile M17 and painter runs each completed 20 successful comments GETs and returned to the same Feed anchor. PSS/RSS/native heap/thread deltas were comparable and a Home/background return caused no extra comments request. Direct Flutter listener/controller/timer counters are unavailable. See `lifecycle-matched-summary.csv`. |
| AC-14 | **Partial** | Both flags default off and component tests verify static behavior. No device smoke or live build switching for both flags. |
| AC-15 | **Partial** | Current Web and Flutter automated suites/checks pass, but required device/accessibility/profile scenarios remain open. |
| AC-16 | **Partial** | G0 and this M26 report preserve the known limits, but a complete tested-build matrix and passing paired traces are absent. |

## Decision

M26 remains open. Do not mark AC-12 or G0 passed. The Flutter build-time flags are wired and both-off/both-on profile builds succeeded on 10 October. The current-device sustained paired traces are captured and fail AC-12; other flag-matrix, accessibility and lifecycle/resource checks remain partial.

### Feed state-notification optimization retest — 10 October 2026

The store-backed Feed Like handler no longer schedules redundant FeedScreen rebuilds for pending and accepted state when the shared `PollStateStore` already contains the mutation. If an injected API client has not updated the store, the response still follows the existing merge/rebuild path. Regression coverage is `store-backed like pending does not rebuild FeedScreen`; it observes no FeedScreen build at pending or response while the Like progress state and count update remain visible.

Verification after this change: `flutter test --no-pub` — 271 passed, 1 skipped; `flutter test --no-pub test/feed_screen_test.dart` — 22 passed; focused Flutter analyze — no issues; T02 server tests — 12/12 passed. A single current-code diagnostic reaction pair at active 60 Hz measured off 13.26% late vs reactions-only 20.44% (+7.18 pp); raster p50 was 8.535 → 9.235 ms. Full frame counts and raw logs are in the physical-device README. This one pair is diagnostic, not the required 3×30 s matrix; it confirms that AC-12 remains failed and cannot close the M26 performance checkbox.

## Addendum — physical Samsung SM-A325F — 10 October 2026

This supersedes the earlier 10 October note that the phone was disconnected and no paired profiles existed. The phone was connected and tested on checkout `3b3d2966e544d5ec11c2ddf4fa4286007c9ed571`. Current device evidence and raw logs are in [M26 physical-device evidence](m26-device-2026-10-10/README.md).

### Paired sustained profiles

Three 30-second scroll runs compared flags off with both flags on; three reaction runs compared flags off with reactions-only. Each was repeated at actual SurfaceFlinger 60 Hz and 90 Hz. Samsung's Standard/High motion-smoothness UI was used to select the mode, and the active SurfaceFlinger rate was recorded. Initial requested-60 runs that stayed at active 90 Hz are quarantined and excluded; see `m26-device-2026-10-10/paired/invalid-requested60-active90/`.

| Actual refresh / scenario | Off late frames | Motion-on late frames | On-minus-off mean | Status |
|---|---:|---:|---:|---|
| 60 Hz scroll | 2.51–11.74% | 1.61–2.34% | −3.55 pp | Fail: every run exceeds 1%. |
| 90 Hz scroll | 99.95–100.00% | 98.53–100.00% | −0.47 pp | Fail: every run exceeds 1%. |
| 60 Hz reaction | 16.35–21.88% | 17.17–22.69% | +0.86 pp | Fail: every run exceeds 1% and delta exceeds +0.5 pp. |
| 90 Hz reaction | 96.15–99.35% | 97.26–98.74% | −0.37 pp | Fail: every run exceeds 1%. |

The paired Android profile therefore does not pass AC-12, and G0 remains **NOT PASSED**. The first-load fixture was delayed by five seconds; `Loading polls` was present in all 12 60/90 Hz off/both-on dumps. These startup captures have only 11–34 frames over 11–15 seconds and are diagnostics, not 30-second sustained runs.

### Physical accessibility and lifecycle

- At `font_scale=2.0`, the Feed hierarchy retained named controls without horizontal overflow. Tab focus reached `Open Baseline Author profile`, and after Comments/back navigation that named focus target remained focused. Samsung TalkBack was briefly bound and reported `touchExplorationEnabled=true`; spoken output was not independently heard. Device font scale, TalkBack state and animation settings were restored.
- One 20-cycle Feed → Comments(error) → Back run completed in 30.78 seconds. A successful-comments retest completed 20 cycles in 34.94 seconds and produced exactly 20 fixture GETs, one per Comments open. A Home → Feed round trip restored the same card and preserved the 20-request count. PSS changed 173,301→181,223 kB, RSS 238,306→247,038 kB, Native Heap 23,934→25,201 kB, allocated Dalvik Heap 3,283→3,284 kB, and thread rows remained at 66. See the `lifecycle-comments-repeat-*` captures. M17 lacks matching Android listener/controller/timer and process-resource baseline counters, so AC-13 remains partial.
- Flutter automated coverage still supplies the live reduced-motion, interrupted-target, semantics, disposal and one-time-entry checks. This device pass did not verify reduced motion changing while the app was active, repeated entry visually, or spoken TalkBack output.

### Current M26 status

| Requirement | Status after 10 October device run |
|---|---|
| Correctness/error/loading/anchor under flags off, reactions-only and both-on | **Partial** — web three-mode smoke and automated suites are documented; painter device runs verified successful Feed, like and comments behavior in flags-off/both-on builds. The full error/loading/anchor/network matrix across platforms and flag modes is not complete. |
| Keyboard, screen reader, 200% text, live reduced motion, interruptions, restored focus, no repeated entry | **Partial** — painter 200% semantics tree has 0 horizontal overflow; earlier Tab focus and focus-return evidence remains. Live reduced-motion settings were toggled while the app was foregrounded, but frame-by-frame suppression was not directly confirmed; TalkBack speech remains unverified. |
| Twenty lifecycle cycles and resource/request comparison | **Partial** — matched M17 and painter runs each completed 20 successful GETs and returned to the same Feed anchor; PSS/RSS/native heap/thread growth was comparable, and background return caused no extra comments GET. Direct listener/controller/timer counters remain unavailable. |
| Paired off/on profiles and first load | **Fail** — current painter sustained pairs fail AC-12: all 90 Hz groups exceed 1%, one 60 Hz scroll-on run is 1.50%, and the 60 Hz reaction delta is +5.39 pp. A matched painter first-load matrix remains outstanding. |

M26 remains open and its four acceptance checkboxes stay unchecked. There is measured evidence now, but the required performance gate fails; recording the failure does not convert AC-12 or the M26 Definition of Done into a pass.

### Renderer A/B update — 10 October 2026

Following the user's direction, the final PollCard experiment was compared on the physical Samsung at confirmed 90 Hz with both flags enabled. The Skia default and Impeller/Vulkan each ran three 30-second scroll profiles on the same T02 fixture. Skia late-frame share was 97.97–100.00% (mean raster p50 12.413 ms); Impeller was 97.82–99.96% (mean raster p50 12.682 ms). The mean late-share difference was −0.17 percentage points, while raster p50 was 0.270 ms slower on Impeller. The comparison gives no material improvement and both remain far above AC-12's 1% ceiling. See the raw profiles and `renderer-90hz.csv` in the device evidence directory. The earlier attempted build with incorrect define names was excluded.

Three localized PollCard rendering changes (remove redundant outer/option clipping and the card shadow) were also measured against motion off; raster p50 improved from about 14.4 ms to 12.3–12.7 ms, but 90 Hz late-frame share remained 97.97–100.00%. The targeted widget tests were added and passed. Do not mark M26's paired-performance checkbox complete; the gate still fails. The subsequently approved painter experiment is recorded below.

### PollCard CustomPainter retest — 10 October 2026

The user selected a painter for card/option/progress decoration while retaining normal Flutter text, images, Material actions and semantics. Current painter sources and test changes are in `apps/mobile/lib/src/features/polls/poll_card.dart`, `test/poll_card_layout_test.dart`, `test/poll_card_motion_test.dart`, and `test/feed_screen_test.dart`. The full Flutter suite passed 270/270 runnable tests (1 skipped); focused analyze of the four affected files passed after removing an unused local from the modified test.

Current-source paired profiles were captured with three runs per mode/scenario at actual 60/90 Hz: 60 Hz scroll off 0.56–0.67%, both-on 0.44–1.50% (mean delta +0.19 pp); 90 Hz scroll off 99.53–100.00%, both-on 98.01–100.00% (−0.50 pp); 60 Hz reaction off 14.72–17.67%, reactions-only 19.41–23.26% (+5.39 pp); 90 Hz reaction off 98.17–99.51%, reactions-only 98.28–99.59% (+0.07 pp). All 90 Hz groups fail the absolute 1% gate; the 60 Hz reaction delta fails +0.5 pp, and one 60 Hz scroll-on run fails 1%. The painter experiment therefore does not satisfy AC-12. Full per-run measurements and logs are in [the physical-device addendum](m26-device-2026-10-10/README.md#pollcard-custompainter-retest--10-october-2026).

The painter build completed matched 20-cycle Feed → Comments → Back runs in 24.4 s with exactly 20 successful fixture GETs; the M17 `ac13b283` baseline did the same in 24.3 s on the same lockfile. Resource deltas were comparable (PSS +28,246 kB vs +28,900 kB; RSS +34,076 kB vs +35,548 kB; Native Heap +4,024 kB vs +4,328 kB; thread rows +1 vs −1). An additional both-on Home/background → Feed return preserved the card and caused no extra comments GET. Exact captures are in `lifecycle-matched-summary.csv` and adjacent before/after files. Direct listener/controller/timer counters are unavailable. Reduced-motion settings were toggled with the app foregrounded and the like action/semantics remained correct, but visual suppression was not measured frame-by-frame; TalkBack speech remains unverified. The four M26 evidence checkboxes stay open and G0 remains **NOT PASSED**.
