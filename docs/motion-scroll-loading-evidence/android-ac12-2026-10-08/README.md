# Android AC-12 profile: 8 October 2026

## Result

**AC-12 is not passed.** The on-device scroll profile exceeds the 1% late-frame limit in all three 90 Hz runs. At 60 Hz, one of three runs also exceeds the limit. The required comparison against a stabilized motion-off build was not captured, so the `+0.5 percentage point` regression condition remains unverified.

## Device and method

- Physical Samsung SM-A325F (`RF8R321M9LJ`), Android 13 / API 33, 1080×2400 at 420 dpi (density 2.625), SoC MT6769V/CT (`mt6768` platform), ARM Mali-G52 MC2 / OpenGL ES 3.2.
- The device supports 60 Hz and 90 Hz; it does not expose 120 Hz. Each refresh mode was explicitly confirmed in `dumpsys display`. Battery saver was off (`low_power=0`); Android text scale remained 1.1 and no accessibility service was enabled.
- Profile APK included `M17_AC12_PROBE=true`, `API_BASE_URL=http://127.0.0.1:3128`, and `API_WEBSOCKET_URL=ws://127.0.0.1:3128/realtime`. The fixture used seed `20261002` and 100 polls. Test login was performed only against the local fixture and logged out afterward.
- Each run used 75 alternating real ADB swipes (300 ms per swipe, 100 ms pause), taking 33.4–34.3 seconds. Flutter `FrameTiming.totalSpan` was classified late when it exceeded the active refresh period (11,111 µs at 90 Hz; 16,667 µs at 60 Hz). Percentiles use nearest-rank p95 over rasterized frames. Build and raster durations are reported separately and are not added together.
- The profile-only probe emits short JSON batches to avoid Android logcat's per-record truncation. Raw records and the computed summary are retained below. The 90 Hz runs contain 737–741 gaps in Flutter frame numbers; this is surfaced as a capture/engine cadence caveat and is not counted as a late frame by the percentages.

## Scroll results

| Refresh | Run | Rasterized frames | Duration | Late frames | Late | `totalSpan` p95 / max | Build p95 / max | Raster p95 / max |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 90 Hz | 1 | 2,311 | 33.85 s | 2,285 | 98.875% | 29.808 / 33.398 ms | 2.149 / 8.179 ms | 15.073 / 17.392 ms |
| 90 Hz | 2 | 2,308 | 33.93 s | 2,307 | 99.957% | 29.970 / 37.215 ms | 1.817 / 14.993 ms | 15.089 / 28.156 ms |
| 90 Hz | 3 | 2,306 | 33.91 s | 2,305 | 99.957% | 29.823 / 37.382 ms | 2.076 / 15.157 ms | 14.980 / 26.563 ms |
| 60 Hz | 1 | 2,035 | 33.92 s | 30 | 1.474% | 11.882 / 30.869 ms | 2.005 / 17.374 ms | 8.144 / 23.217 ms |
| 60 Hz | 2 | 2,029 | 33.78 s | 11 | 0.542% | 10.825 / 28.544 ms | 1.939 / 9.010 ms | 6.619 / 26.364 ms |
| 60 Hz | 3 | 2,032 | 33.85 s | 15 | 0.738% | 11.655 / 25.481 ms | 5.416 / 18.635 ms | 7.392 / 19.846 ms |

At 90 Hz the raster p95 itself is about 15 ms, above the 11.11 ms frame budget. The observed raster stage is the leading bottleneck in this scroll workload; this profile alone does not identify which widget or GPU operation causes it. At 60 Hz, all three `totalSpan` p95 values are under 16.67 ms, but run 1 violates the per-run late-frame threshold.

## Reaction and count-update results

Each run lasted about 30 seconds and alternated 47 vote taps with 47 like taps on the visible T02 count-transition card. The fixture accepted the requests; repeated vote and like counts changed while the feed remained visible. This exercises the existing progress/count transitions. It does not represent an absent motion-on feature flag.

| Refresh | Run | Rasterized frames | Duration | Late | `totalSpan` p95 / max | Build p95 / max | Raster p95 / max |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 90 Hz | 1 | 2,000 | 30.08 s | 97.600% | 30.858 / 47.114 ms | 3.800 / 20.626 ms | 15.267 / 31.567 ms |
| 90 Hz | 2 | 1,992 | 29.92 s | 99.749% | 30.817 / 38.131 ms | 3.015 / 23.063 ms | 15.264 / 27.165 ms |
| 90 Hz | 3 | 1,996 | 30.24 s | 99.599% | 30.771 / 36.117 ms | 3.342 / 20.624 ms | 15.283 / 26.044 ms |
| 60 Hz | 1 | 1,778 | 30.03 s | 3.656% | 15.727 / 30.388 ms | 7.636 / 16.638 ms | 9.790 / 16.358 ms |
| 60 Hz | 2 | 1,777 | 30.04 s | 3.883% | 15.528 / 29.594 ms | 7.807 / 14.301 ms | 9.664 / 15.206 ms |
| 60 Hz | 3 | 1,756 | 29.71 s | 3.588% | 15.098 / 34.816 ms | 7.742 / 15.982 ms | 9.139 / 28.715 ms |

Every reaction/update run exceeds the 1% absolute threshold at both refresh rates.

## First Feed load and skeleton

Three fresh authenticated Feed loads were captured per refresh mode. The local profiling fixture delayed `/polls` for 5 seconds; `Loading polls` was present in the Android accessibility hierarchy in all six samples before the response arrived. These were fresh Feed sessions in the running profile app, not process-cold launches. The skeleton is static, so only 10–13 rasterized frame timings were produced per sample; late-frame percentages on that small transitional sample are not treated as a sustained-rendering AC-12 rate.

| Refresh | Run | Timing samples | `totalSpan` p95 / max | Skeleton visible |
|---:|---:|---:|---:|:---:|
| 90 Hz | 1 | 10 | 53.499 / 53.499 ms | yes |
| 90 Hz | 2 | 13 | 52.515 / 52.515 ms | yes |
| 90 Hz | 3 | 13 | 54.095 / 54.095 ms | yes |
| 60 Hz | 1 | 10 | 55.934 / 55.934 ms | yes |
| 60 Hz | 2 | 11 | 57.504 / 57.504 ms | yes |
| 60 Hz | 3 | 11 | 58.690 / 58.690 ms | yes |

Screenshots: [60 Hz skeleton](cold-60hz-1.png), [90 Hz skeleton](cold-90hz-1.png). The accessibility hierarchy for every run is in the matching `cold-<rate>hz-<run>.xml` file.

## Coverage gaps

- No stabilized motion-off APK/profile was available for an off/on comparison.
- Scroll, reaction/count updates, and first Feed load with skeleton were each captured in three runs at both supported refresh rates. The first-load samples are fresh Feed sessions in a running profile process, not process-cold launches; because the skeleton is static, their short timing samples do not measure a sustained rendering workload.
- The hardware cannot exercise the protocol's 120 Hz configuration. Results here cover 60 Hz and the device's available 90 Hz mode only.
- A late-frame percentage below 1% is required in **every** run, and the motion-on increase may be at most 0.5 percentage points over motion-off. The current evidence therefore leaves Android AC-12 open and records a failure at 90 Hz; it does not justify closing M17/G0.

## Artifacts

- [`summary.json`](summary.json)
- 90 Hz raw FrameTiming batches: [run 1](run-1.log), [run 2](run-2.log), [run 3](run-3.log)
- 60 Hz raw FrameTiming batches: [run 1](run-60hz-1.log), [run 2](run-60hz-2.log), [run 3](run-60hz-3.log)
- Reaction/update batches: [90 Hz](reaction-90hz-1.log), [90 Hz](reaction-90hz-2.log), [90 Hz](reaction-90hz-3.log); [60 Hz](reaction-60hz-1.log), [60 Hz](reaction-60hz-2.log), [60 Hz](reaction-60hz-3.log)
- First-load batches and accessibility hierarchies: see the `cold-<rate>hz-<run>.log` and `.xml` files in this directory.
