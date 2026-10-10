# M26 physical-device addendum — 10 October 2026

## Latest M26 retests — painter and matched lifecycle baseline

After the PollCard painter change, the fixture was corrected to serve a successful empty `GET /polls/:id/comments` response for known polls; its regression suite passes 12/12. This supersedes the earlier navigation capture whose fixture returned 404 and the earlier painter request log that contained 45 rows.

On the same SM-A325F, Flutter 3.44.5, local profiling fixture, and current `apps/mobile/pubspec.lock`, both the M17 baseline (`ac13b283`) and the painter working tree completed 20 Feed → Comments → Back cycles, returned to the same Feed card, and made exactly 20 successful comments GET requests. Elapsed times were 24.3 s (M17) and 24.4 s (painter). Matched resource evidence is `paired/lifecycle-m17-*-matched.txt` and `paired/lifecycle-painter-*-retest2.txt`; the isolated request lists are `paired/lifecycle-m17-retest2-requests.txt` and `paired/lifecycle-painter-retest2-requests.txt`.

| Build, flags off | PSS before → after | RSS before → after | Native heap before → after | Threads before → after | Comments GETs |
|---|---:|---:|---:|---:|---:|
| M17 `ac13b283` | 181,184 → 210,084 kB | 277,546 → 313,094 kB | 33,312 → 37,640 kB | 75 → 74 | 20 |
| M26 painter working tree | 185,595 → 213,841 kB | 281,630 → 315,706 kB | 33,900 → 37,924 kB | 73 → 74 | 20 |

Growth was comparable to M17 (+28.9 MB vs +28.2 MB PSS; +2 vs +1 process threads). This provides a matched process-resource comparison, while direct Dart listener/controller/timer counters are unavailable. A Home/background → Feed return on the both-on painter build restored the same card and caused no extra comments GET. At 200% text scale on the painter build, 29 app semantics nodes stayed within the 1080 px horizontal viewport. Reduced-motion settings were switched while the both-on app was foregrounded and a like action completed with the final count/semantics intact; the physical capture does not prove the animation was suppressed frame-by-frame.

**Current decision:** M26 remains open. The paired sustained AC-12 matrix still fails the absolute ≤1% late-frame limit (including motion-off runs), and 60 Hz reactions exceed the +0.5 pp delta. TalkBack speech has not been independently heard. Keep G0 **NOT PASSED** and release flags off.

## Device and build

- Samsung SM-A325F (`RF8R321M9LJ`), Android 13/API 33, 1080×2400 at 420 dpi; supported refresh modes are 60 and 90 Hz (no 120 Hz).
- Tested checkout: `3b3d2966e544d5ec11c2ddf4fa4286007c9ed571`. Three Flutter profile APKs were built with `M17_AC12_PROBE=true`, the local T02 API/WebSocket endpoint and flags off, reactions-only, or both-on.
- The active SurfaceFlinger refresh mode was read from `dumpsys display` after using Samsung Settings → Display → Motion smoothness. [60 Hz](paired/display-60-hz.txt) and [90 Hz](paired/display-90-hz.txt) captures show the active SurfaceFlinger rate. High/90 Hz was restored; [final display state](paired/display-restored.txt) has no user-preferred mode override.
- The phone's original accessibility settings were `font_scale=1.1`, no enabled accessibility service, animation scales 1.0 and Samsung `remove_animations=0`. Those values were restored after testing.

## Paired AC-12 profiles

`paired/summary.csv` contains the accepted sustained captures and cold-start samples. Each scroll run used 90 alternating 300 ms swipes over 29.9–30.7 s; each reaction run used 105 taps over 32.3–33.6 s. Late means `FrameTiming.totalSpanUs` exceeded 16,667 µs at active 60 Hz or 11,111 µs at active 90 Hz. Scroll uses both flags on; reaction uses reactions-only; both are paired against flags off on the same phone and fixture.

| Active rate / scenario | Motion off, late frames | Motion on, late frames | On-minus-off mean | AC-12 result |
|---|---:|---:|---:|---|
| 60 Hz scroll | 2.51–11.74% | 1.61–2.34% | −3.55 pp | **Fail:** all six runs exceed 1%. |
| 90 Hz scroll | 99.95–100.00% | 98.53–100.00% | −0.47 pp | **Fail:** all six runs exceed 1%. |
| 60 Hz reaction | 16.35–21.88% | 17.17–22.69% | +0.86 pp | **Fail:** all six runs exceed 1%; reaction delta also exceeds +0.5 pp. |
| 90 Hz reaction | 96.15–99.35% | 97.26–98.74% | −0.37 pp | **Fail:** all six runs exceed 1%. |

The paired comparison does not show a consistent regression: on-screen scroll is lower with both flags at both rates, while 60 Hz reaction is +0.86 pp and 90 Hz reaction is −0.37 pp. This does not satisfy AC-12 because the absolute ≤1% ceiling fails in every sustained group. The especially high 90 Hz values also appear in the motion-off baseline and match the previously recorded Android bottleneck; this is not evidence that motion is safe to roll out.

### Feed rebuild diagnostic — 10 October

The store-backed Like path was tightened so a pending/reconciled Like does not rebuild the whole `FeedScreen` when the shared `PollStateStore` already publishes that state. A widget regression test confirms no FeedScreen rebuild at request start or response; fallback API clients still merge a response through the store when it has not accepted the mutation. The Flutter suite passes 271 tests with 1 skipped after this change.

A single 105-tap diagnostic pair on the same phone at active 60 Hz used the compact batched `FrameTiming` probe and the current Feed optimization. The off capture had 1,659 frames, 220 late (13.26%), total-span p50 13.011 ms, raster p50 8.535 ms, and build p50 2.771 ms. Reactions-only had 1,350 frames, 276 late (20.44%), total-span p50 14.619 ms, raster p50 9.235 ms, and build p50 3.621 ms: +7.18 pp versus off. Raw captures: `paired/current-feedfix-final-reaction-tap-60hz-off-run1.log` and `paired/current-feedfix-final-reaction-tap-60hz-on-run1.log`.

This is a one-pair diagnostic (about 38 s each), not the required three-run 30-second AC-12 matrix and does not replace the accepted sustained captures above. It reproduces the >1% absolute failure and the reaction regression, so the Feed rebuild reduction alone does not close the performance gate.

### Cold Feed load

The local T02 profiling response was delayed by five seconds. All 12 off/both-on accessibility dumps at 60/90 Hz showed `Loading polls` at approximately two seconds after launch. Startup windows were 11.1–15.1 seconds and contained only 11–34 rasterized frames; late-frame shares ranged from 50% to 100%. These short startup samples are retained as diagnostics and are not treated as sustained 30-second AC-12 runs.

The first load captures are `[summary rows](paired/first-load-measurements.txt)` with adjacent `.log` and `.xml` files. The 90 Hz and 60 Hz mode evidence is retained separately above.

### Refresh-rate correction

Initial attempts to select 60 Hz with `cmd display set-user-preferred-display-mode` changed the preferred/default mode but SurfaceFlinger remained at 90 Hz. Those files are preserved under [invalid requested-60 / active-90 attempts](paired/invalid-requested60-active90/); they are excluded from `summary.csv`. The accepted 60 Hz series was repeated after choosing Samsung's Standard motion-smoothness setting and confirming `mActiveSfDisplayMode.refreshRate=60.0`.

## Accessibility and navigation

- At 200% font scale the Feed accessibility tree retained named controls and all horizontal bounds stayed within the 1080 px viewport; the scrollable card continued below the viewport as expected. Evidence: [hierarchy](paired/accessibility-font-200.xml). Font scale was restored to 1.1.
- TalkBack was enabled briefly and Android reported the Samsung `TalkBackService` bound with touch exploration on. The accessibility hierarchy was captured, but spoken output was not independently heard. TalkBack was disabled afterward and the original service list was restored.
- Three injected Tab key events focused the named `Open Baseline Author profile` control. After opening Comments and returning, that focus target remained focused; see [keyboard focus](paired/keyboard-focus.xml) and [restored focus](paired/focus-restored.xml).
- Twenty Feed → Comments → Back cycles completed in 30.78 s and returned to the Feed at its original card position. The stock profiling fixture omitted the comments route, so this capture exercised its error state rather than a successful comment response. Process PSS rose from 193,369 to 204,285 kB, RSS from 269,658 to 285,146 kB, Native Heap from 34,789 to 35,049 kB, Dalvik Heap from 7,005 to 7,900 kB; thread rows increased from 67 to 70. See [cycle measurement](paired/lifecycle-measurement.txt), before/after memory and thread dumps, and [Feed hierarchy after the cycles](paired/lifecycle-after.xml). The M17 baseline did not record these same resource counters, so this is not a like-for-like listener/controller/timer comparison.
- A successful-response pass ran 20 Feed → Comments → Back cycles on the both-on Impeller profile in 34.94 s. The fixture received exactly 20 GETs for poll `motion-profile-20261002-001`, one per Comments open; the final hierarchy returned to the same Feed card/anchor. A Home → Feed round trip also restored that card with the request count unchanged. PSS changed 173,301→181,223 kB, RSS 238,306→247,038 kB, Native Heap 23,934→25,201 kB, allocated Dalvik Heap 3,283→3,284 kB, and thread rows stayed at 66. Captures are `paired/lifecycle-comments-repeat-{requests,meminfo-before,meminfo-after,threads-before,threads-after}.txt` and `paired/lifecycle-comments-{after,background-return}.xml`. The M17 evidence has no comparable Android listener/controller/timer counters or PSS/thread baseline, so AC-13 remains partial.
- Flutter automated tests cover interrupted targets, live reduced-motion updates, semantics, lifecycle disposal, virtualized remounts and one-time entry. This device session did not verify reduced motion changing while the app was active, repeated entry visually, or TalkBack speech.

At that point the successful Comments route and request-count retest was complete, while the comparable M17 Android resource baseline and spoken TalkBack check were still missing. The matched baseline rerun and exact current resource/request comparison are recorded at the top of this report; the spoken check remains open.

## Earlier M26 decision — before matched painter retests

The sustained paired profiles, first-load diagnostics, physical 200% text smoke, TalkBack service/hierarchy, successful 20-cycle navigation/request pass and background return are captured. M26 **remains open**: AC-12 fails the explicit absolute threshold on both supported refresh modes, the 60 Hz reaction delta exceeds +0.5 pp, resource counters lack an M17 comparison, reduced motion was not verified live on device, and screen-reader speech was not independently checked. Keep G0 **NOT PASSED** and motion flags off for release builds until the rendering bottleneck and remaining checks are resolved.

No release/deploy was performed.

## Renderer A/B — 10 October 2026

The user's requested renderer comparison was run on the final PollCard experiment at active SurfaceFlinger 90 Hz, with both motion flags on and the same profiling fixture. The Android manifest `io.flutter.embedding.android.EnableImpeller=true` selected Impeller/Vulkan; the merged manifest, renderer startup log and active display mode are recorded in `paired/impeller-merged-manifest.txt`, `paired/impeller-renderer-startup.txt` and `paired/impeller-active-display-mode.txt`. The temporary source manifest edit was restored immediately after building. The Impeller profile APK SHA-256 is `6C432F541C0BE1F7D5819BF6D5619053BAD6C9590D29F8A55AD0DB5B0DA97DB3`.

| Renderer | Late frames, 3 runs | Mean raster p50 | Mean raster p95 |
|---|---:|---:|---:|
| Skia | 97.97–100.00% | 12.413 ms | 14.293 ms |
| Impeller/Vulkan | 97.82–99.96% | 12.682 ms | 14.644 ms |

Impeller changed mean late share by only −0.17 percentage points and made mean raster p50 0.270 ms slower. Both renderers are far above the 1% late-frame ceiling at 90 Hz; switching renderers does not resolve AC-12. Raw captures and per-run measurements are in `paired/no-shadow-both-scroll-90hz-run*.log`, `paired/impeller-both-scroll-90hz-run*.log`, and `paired/renderer-90hz.csv`. The earlier failed attempt with incorrect dart-define names is excluded. A PollCard CustomPainter experiment follows.

## PollCard CustomPainter retest — 10 October 2026

Following the user's selected architecture, `PollCard` now paints its white card surface, option surface/selected outline, and determinate progress track/fill with `CustomPainter`. Flutter still lays out all content; text, images, `Material`/`InkWell` actions, callbacks, focus and semantics remain widget-based. Progress keeps a progress-bar semantic node with its 0–100 range and animated value. The visible Feed smoke is `paired/poll-card-painter-visual-smoke.png`; the machine-readable results are in `paired/custom-painter-summary.csv`, with each accepted 30-second trace alongside it.

| Scenario / refresh | Motion off late frames | Motion on late frames | On-minus-off mean | Mean raster p50 off → on |
|---|---:|---:|---:|---:|
| Scroll, 60 Hz | 0.56–0.67% | 0.44–1.50% (one run >1%) | +0.19 pp | 5.69 → 6.08 ms |
| Scroll, 90 Hz | 99.53–100.00% | 98.01–100.00% | −0.50 pp | 12.36 → 12.68 ms |
| Reactions, 60 Hz | 14.72–17.67% | 19.41–23.26% | +5.39 pp | 9.22 → 9.25 ms |
| Reactions, 90 Hz | 98.17–99.51% | 98.28–99.59% | +0.07 pp | 14.48 → 14.46 ms |

Late frames use the existing `FrameTiming.totalSpanUs` threshold (16,667 µs at 60 Hz; 11,111 µs at 90 Hz); each run used 90 alternating swipes or 105 Like/Unlike taps over approximately 30–38 seconds. At 60 Hz scroll, the mean motion delta is within +0.5 pp, but one on-run exceeds the absolute 1% ceiling. At 90 Hz every run misses that ceiling. Reactions fail at both rates; the 60 Hz delta also exceeds +0.5 pp. The painter implementation therefore does not make AC-12 pass: 90 Hz scroll raster p50 is slightly slower than the off build, and the 60 Hz reaction result is worse. Keep G0 **NOT PASSED** and the M26 performance checkbox open.

The initial painter successful-response lifecycle run completed 20 Feed → Comments → Back cycles in 20.75 s and the fixture recorded exactly 20 comments GETs. The same Feed card was visible afterward. PSS changed 186,127→204,928 kB, RSS 282,302→306,014 kB, Native Heap 32,843→34,419 kB, Dalvik allocated heap 3,309→3,311 kB, and process thread rows increased 70→73. The first M17 attempt returned to Feed after 20 screen cycles but the fixture observed zero comments GETs; those captures are excluded. After adding the fixture route, a matched M17 rerun on the same lockfile produced 20/20 successful GETs; the matched resource comparison is recorded at the top of this report. AC-13 remains partial because direct Flutter listener/controller/timer counters are unavailable.

Flutter regression suite after the painter change: **270 passed, 1 skipped**; focused analyze of `poll_card.dart` and its affected tests is clean. The painter test also preserves the progress-bar semantics range and values. This does not change the performance decision above.
