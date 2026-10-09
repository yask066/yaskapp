# M26 automated verification

**Date:** 9 October 2026
**Checkout:** `116b3a8c3893c1fd9bba55733b37fd8b4bc661c8`
**Result:** automated checks passed; M26 remains open because live flag matrix, lifecycle-cycle measurement, and paired AC-12 profiling were not performed.

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

The mobile entry point calls `const YaskappApp()` in `apps/mobile/lib/main.dart`. `YaskappApp` defaults both `reactionsMotion` and `entryMotion` to false in `apps/mobile/lib/src/app.dart`; no build-time or runtime configuration currently reaches those root flags. Tests can inject `MotionSettingsScope`, but a real app binary cannot currently be launched in the reactions-only or both-on configurations from the supported app entry point. Therefore, on-device comparisons were not inferred from widget tests.

## Open M26 evidence

| Requirement | Status | Evidence / gap |
|---|---|---|
| Correctness, errors, loading and anchors across flags off, reactions-only, and both-on | **Partial** | Web and Flutter component/page suites pass and directly cover disabled/enabled individual effects, reduced motion, mutations, navigation and anchors. No end-to-end cross-platform matrix was rerun under all three root app flag configurations; current mobile entry point has no flag injection. |
| Keyboard, screen reader, 200% text, live reduced motion, interrupted targets, restored focus, no repeated entry | **Partial** | Automated tests cover target interruption, live reduced motion, semantics, disposal/backgrounding, virtualized remount and one search-back navigation case. M17's 200% Android layout/TalkBack hierarchy and web keyboard evidence predate M21–M24; spoken TalkBack output was not independently heard. No M26 physical accessibility smoke was captured. |
| Twenty list → detail → back cycles with listeners/controllers/timers/request comparison | **Not measured** | M17 records 20 production web navigation cycles before M21–M24. M24 tests one two-page search/back case. There is no current 20-cycle resource/listener/timer comparison. |
| Paired motion-off/on 3×30 s traces for each required viewport/device, including first load | **Not measured / prior Android baseline fails** | No current-commit paired profile was captured. Existing [8 October Android AC-12 evidence](android-ac12-2026-10-08/README.md) already fails the absolute 1% ceiling in every 90 Hz scroll run, one 60 Hz scroll run, and all reaction runs. Existing web profiles predate M21–M24 and are not the required pair. |
| Targeted suites and checks | **Passed with one analyzer info** | Results above. The lone info diagnostic is in a test file and does not fail Flutter tests. |

## Acceptance criteria status

| AC | M26 status | Current evidence |
|---|---|---|
| AC-01 | **Fail / prior scope exception** | M19–M25 were implemented before G0 passed, as recorded in the plan and M18 report. This run does not change that order. |
| AC-02 | **Partial** | Current Web/Flutter suites pass. Cross-platform behavior was not repeated under all root flag combinations. |
| AC-03 | **Partial** | Current Web full suite includes M05 reordered vote/like race cases; historical M17/M06 strict race evidence exists. No current all-flags/realtime integration matrix was captured. |
| AC-04 | **Partial** | M21 web geometry measured ≤2 CSS px and M22 Flutter action/layout tests pass. M26 did not repeat device geometry at 200% with motion enabled. |
| AC-05 | **Partial** | Historical M17/M23 anchor evidence and current list tests exist. No fresh paired on-device/web scroll-anchor run with M21–M24 enabled was captured. |
| AC-06 | **Partial** | Current Flutter full suite includes M24 navigation tests; web full suite includes list/detail/back anchor tests. Twenty-cycle cross-platform resource comparison remains open. |
| AC-07 | **Partial** | Search, keyboard-related, and notification-target tests pass in current suites; no new cross-platform keyboard/focus smoke across all flag modes. |
| AC-08 | **Partial** | Existing loading/error/retry tests pass and M25 keeps skeletons static. No fresh full loading matrix across the M26 flag modes. |
| AC-09 | **Pass for automated component coverage** | Current suites cover immediate target semantics, interrupted values, count/bar/like motion and unchanged data callbacks. |
| AC-10 | **Pass for automated component coverage** | Current suites cover one-time entry, offscreen handling, virtualized remount, and entry completion. Device-level behavior is not covered. |
| AC-11 | **Partial** | Automated reduced-motion, semantics and lifecycle tests pass. Physical screen-reader speech and post-M24 accessibility smoke remain unverified. |
| AC-12 | **Fail / paired comparison not measured** | Previous Android baseline breaches 1% in the recorded runs. No current same-build off/on pair; see Android profile evidence. |
| AC-13 | **Not measured** | No current 20-cycle resource/listener/timer comparison. |
| AC-14 | **Partial** | Both flags default off and component tests verify static behavior. No device smoke or live build switching for both flags. |
| AC-15 | **Partial** | Current Web and Flutter automated suites/checks pass, but required device/accessibility/profile scenarios remain open. |
| AC-16 | **Partial** | G0 and this M26 report preserve the known limits, but a complete tested-build matrix and passing paired traces are absent. |

## Decision

M26 remains open. Do not mark AC-12 or G0 passed. Before a valid paired on-device run, connect the M20 app-level flags to a supported profile/build configuration (defaulting both flags to false), then capture the same build policy, fixture and device with each flag mode. This report does not add or claim new device traces.
