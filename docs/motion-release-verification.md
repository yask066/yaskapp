# Motion release verification

## M25 — shimmer decision

**Decision (9 October 2026): do not add shimmer.** Keep poll, user, comment, and notification skeletons static. This is the completed optional outcome for M25; it does not pass AC-12 or open G0.

### Evidence reviewed

| Profile | Result | Relevance to shimmer |
|---|---|---|
| Physical Samsung SM-A325F, Android 13, Flutter profile build, T02 fixture, 60/90 Hz | On scroll, late frames were 98.875–99.957% at 90 Hz and 0.542–1.474% at 60 Hz. On reaction/count updates, all runs exceeded 1%: 97.600–99.749% at 90 Hz and 3.588–3.883% at 60 Hz. | The absolute AC-12 limit is already exceeded in the Android workload. There is no measured evidence to spend additional frame time on a skeleton effect. The profile identifies raster as the leading scroll bottleneck at 90 Hz, but does not isolate its cause. |
| Android first Feed load with five-second fixture delay | The existing static skeleton was visible in all six samples. These short first-load samples are not a sustained-rendering rate. | Static loading feedback already works; shimmer is not needed to make loading visible. |
| Physical Chrome 155, Windows display at 60 Hz | Three production-build runs recorded 0–1 missed active-page BeginFrames out of 1,801 (0–0.0555%). | This is a favorable web scroll baseline, but it does not establish Android headroom or measure a shimmer-on comparison. |
| Web entry-motion preview and Flutter entry-motion verification | Existing skeleton-to-content transition is bounded to 120 ms; reduced motion switches to static content. `entryMotion` is off by default. | The optional skeleton effect can remain absent without changing loading behavior or introducing another setting. |

### Interpretation and limits

The Android captures do not provide the paired shimmer-off/shimmer-on comparison required to quantify a `+0.5` percentage-point regression. They do show that the absolute 1% threshold already fails in the measured Android scroll/reaction workloads, so there is no affirmative profiling evidence for adding shimmer. The web result cannot stand in for the Android measurement. Accordingly, M25 takes the allowed no-shimmer outcome and leaves the comparative AC-12 and G0 gates open.

No product code or animation timers were added. Existing static skeletons remain the loading presentation; cached content behavior is unchanged. Existing reduced-motion behavior and the default-off `entryMotion` flags remain in force.

### Source evidence

- [Android AC-12 profile and raw captures](motion-scroll-loading-evidence/android-ac12-2026-10-08/README.md)
- [M17 stabilization and web profile report](motion-scroll-loading-evidence/m17-verification.md)
- [M23 web entry-motion verification](motion-scroll-loading-evidence/m23-web-verification.md)
- [M24 Flutter entry-motion verification](motion-scroll-loading-evidence/m24-flutter-verification.md)
- [PRD AC-12 protocol and loading requirements](prd-motion-scroll-loading.md)

### Reconsideration criteria

Reconsider shimmer only after a same-device, same-fixture, same-build-policy profile records paired shimmer-off/on runs, including first load, with the effect limited to visible skeletons and stopped in background. Every run must meet the absolute AC-12 limit (≤1% late frames), and the shimmer-on increase must remain ≤0.5 percentage points. Until then, keep shimmer out of scope and retain static skeletons.

## M26 — Final motion verification

**Date:** 9 October 2026
**Result: PARTIAL — M26 remains open; AC-12 and G0 are not passed.**

Current automated checks passed on checkout `116b3a8c3893c1fd9bba55733b37fd8b4bc661c8`: Web 236/236 plus typecheck, lint and production build; Flutter 263 passed/1 skipped; focused motion widget tests 24/24. Focused Flutter analyze found one info diagnostic in `test/motion_settings_test.dart:23` (`prefer_const_constructors`). Full results and methods are in [M26 automated verification](motion-scroll-loading-evidence/m26-automated-verification.md).

ADB detected the physical Samsung SM-A325F, Android 13/API 33. The root app entry currently constructs `const YaskappApp()` and its two motion flags default off; no supported app/build configuration can set reactions-only or both-on for a live profile. This leaves the required end-to-end flag matrix and paired device measurements unavailable in the current code. The prior Android baseline already exceeds AC-12's absolute threshold in all 90 Hz scroll runs, one 60 Hz scroll run, and every reaction run; that evidence is from 8 October and is not a substitute for the M26 off/on pair. Twenty-cycle runtime-resource comparison and post-M24 physical accessibility smoke also remain unmeasured.

**Ruling:** Treat the missing root-level motion flag configuration as a prerequisite to the live paired profile and leave M26 open — M26 is a verification task and M27 owns release configuration; adding a new runtime/build control here would exceed the approved M26 scope — cost if wrong: the release matrix remains blocked until that configuration is implemented and verified.

The earlier M17 keyboard, text-scale and web navigation evidence, plus M21–M24 automated results, remain useful historical evidence but do not close these M26 checks. Do not change the G0 decision: **G0 remains NOT PASSED**.
