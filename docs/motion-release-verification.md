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

ADB detected the physical Samsung SM-A325F, Android 13/API 33, during the 9 October check. The earlier report incorrectly said the root app had no supported build-time flag configuration; the current checkout already reads `MotionFlags.fromEnvironment()` in `apps/mobile/lib/main.dart`, and both flags default to false. The 10 October M26 addendum confirms web root-mode behavior and build-time Flutter flag tests. The phone was not connected during that run, so device profiles, physical accessibility smoke, and the Android lifecycle comparison remain unmeasured. The prior Android baseline already exceeds AC-12's absolute threshold in documented runs and is not a substitute for the M26 off/on pair.

**10 October update (before administrative closure):** The earlier ruling to wait for root-level flag configuration no longer applies because that configuration is present and verified. At that point, M26 still needed device accessibility, Android lifecycle/resource, and paired performance evidence. The later user-directed closure disposition is in the M26 update below and in [M26 verification](motion-scroll-loading-evidence/m26-automated-verification.md).

The earlier M17 keyboard, text-scale and web navigation evidence, plus M21–M24 automated results, remain useful historical evidence but do not close these M26 checks. Do not change the G0 decision: **G0 remains NOT PASSED**.

### M26 update — 10 October 2026

The 10 October device retests and exact M26 status are recorded in the [physical-device evidence](motion-scroll-loading-evidence/m26-device-2026-10-10/README.md) and [automated verification](motion-scroll-loading-evidence/m26-automated-verification.md). A Feed Like optimization removes duplicate whole-screen rebuilds when the shared state store already publishes pending and accepted results; a regression test covers the visible pending indicator, updated count and absence of FeedScreen rebuilds. Flutter suite: 271 passed, 1 skipped; focused analyze is clean; T02 fixture suite: 12/12 passed.

A single current-code 60 Hz reaction diagnostic pair measured 13.26% late frames with motion off and 20.44% with reactions-only (+7.18 pp). It is not a substitute for the required 3×30 s matrix and confirms that the optimization does not close AC-12. By user direction, M26 was closed administratively without additional tests; its four physical acceptance items retain their PARTIAL/FAIL dispositions. AC-12 remains failed, and G0 remains **NOT PASSED**. The connected phone was returned to the default flags-off profile at 90 Hz with original font and animation settings; the temporary fixture server and adb reverse mapping were removed.

## M27 — Release preparation

**Status: PREPARATION COMPLETE, BLOCKED FROM ROLLOUT.** M27 wires Flutter's existing presentation flags into the production entry point and documents platform-specific build/rollback steps. This enables the M26 live configuration matrix; it does not supply the missing performance or lifecycle evidence. M26 is administratively closed with deferred acceptance evidence; this does not pass AC-12 or G0.

### Configuration and ownership

| Client | Build-time controls | Default | How to disable |
|---|---|---|---|
| Web | `VITE_REACTIONS_MOTION`, `VITE_ENTRY_MOTION` | Both off unless exactly `true` | Set the affected value to `false` or unset it, rebuild the static client, and deploy that build |
| Flutter | `YASKAPP_REACTIONS_MOTION`, `YASKAPP_ENTRY_MOTION` via `--dart-define` | Both false | Set the affected define to `false` or omit it, build a new APK/app bundle, and distribute that build |

There is no remote kill switch. The Engineering release owner builds and configures each client and records the exact build delivered. QA owns the smoke/profile evidence and blocks each stage if its acceptance checks fail. Product and Engineering review the release gate together after M26 and G0 are closed.

### Staged rollout and rollback

| Stage | Configuration | Required smoke before expansion | Rollback condition and action |
|---|---|---|---|
| 0. Stabilized client | Both flags off on web and Flutter | Login, feed/search, vote/like, skeleton/error/retry, scroll restore, reduced-motion setting; confirm no backend or state behavior depends on motion | Any correctness, geometry, loading, accessibility, or scroll regression: keep this stage and repair the owning task |
| 1. Reactions | `reactionsMotion=true`, `entryMotion=false` on a build/configuration that passed M26's paired profile | Vote/like success and failure, rapid repeat input, changed counts, keyboard/screen reader/text scale, reduced motion; confirm content and anchor positions | Any mismatch in state, anchor shift over 2 px, accessibility regression, or AC-12 failure: set reactions false and rebuild/redeploy that client |
| 2. Entry | Both flags true, only after Stage 1 passes on the same client matrix | First visible entry, back/remount without replay, append, focus/hit testing, reduced motion, loading/error and scroll restore | Repeated entry, focus/input problem, anchor shift over 2 px, or AC-12 failure: set entry false and rebuild/redeploy; disable reactions too if their checks fail |

Web build examples are in [the web README](../apps/web/README.md); Flutter commands are in [the mobile README](../apps/mobile/README.md). The static flag-off behavior continues to use the same poll state, API calls, skeletons, and list scroll code.

### M27 verification record

| Target | Build/configuration | Automated result | Device/browser evidence |
|---|---|---|---|
| Flutter | Profile APK with reactions on and entry off; default/off and independent flag configurations tested | See [M27 automated verification](motion-scroll-loading-evidence/m27-automated-verification.md) | Samsung SM-A325F paired 3×30 s profiles now exist at actual 60/90 Hz. All sustained AC-12 groups fail the absolute 1% ceiling; 60 Hz reaction delta is +0.86 pp. 20 navigation cycles, process metrics, 200% hierarchy, Tab focus and TalkBack service state are recorded in [M26 device evidence](motion-scroll-loading-evidence/m26-device-2026-10-10/README.md). |
| Web | Production static build with the staged build-time environment flags | See [M27 automated verification](motion-scroll-loading-evidence/m27-automated-verification.md) | Existing M17/M23 Chrome evidence is historical and does not replace M26 paired profiles |

The [M27 evidence file](motion-scroll-loading-evidence/m27-automated-verification.md) includes refreshed current-source commands and outputs. M25's approved decision remains **no shimmer**; the static skeleton path stays in use. M26 is closed administratively with partial acceptance evidence, G0 remains **NOT PASSED**, and AC-12 is **FAIL**: the motion-off Android baseline exceeds 1%, and the paired reactions-only delta exceeds +0.5 pp at 60 Hz. The physical lifecycle/resource comparison lacks direct M17 listener/controller/timer counters, and spoken TalkBack output was not independently verified. M27 release preparation is complete; PRD AC-14 and AC-15 remain partial, while AC-16's documentation deliverable is complete. This is not release approval. Keep motion off in delivered builds; rollout and the overall PRD Definition of Done remain blocked by performance and accessibility gates. No publish or deployment occurred.
