# Android AC-12 profile: 9 October 2026

## Result

**Android AC-12 is not passed.** All three reaction runs exceed the 1% absolute late-frame limit at 60 Hz and 90 Hz. Scroll exceeds the limit in all three 90 Hz runs and in one of the three 60 Hz runs. The required motion-off comparison was not captured, so the allowed +0.5 percentage point regression check is also unverified.

## Device and method

- Physical Samsung SM-A325F (`RF8R321M9LJ`), Android 13/API 33, 1080×2400 at 420 dpi, ARM Mali-G52 MC2. Device exposes 60 Hz and 90 Hz; 120 Hz is unavailable.
- Source commit `ac13b283f8e5587cdff18894646d3ee9641a3503`; profile APK built with `M17_AC12_PROBE=true`, local API fixture at `127.0.0.1:3128`, motion flags at their defaults (off). Build log: [profile APK](../m17-flutter-profile-final-2026-10-09.txt).
- FrameTiming batches were collected from Android logcat while Yaskapp was foreground. Scroll runs lasted about 36.7–37.0 seconds. Each reaction run used 105 taps on the visible like control; valid 90 Hz captures replaced attempts interrupted when Android switched foreground apps. Device state was tested with the local revision-aware T02 fixture. Correctness regression and full fixture suite: [11/11 tests](../m17-t02-fixture-tests-final-2026-10-09.txt).
- A frame is classified late when `totalSpan` exceeds the refresh budget: 11,111 µs at 90 Hz and 16,667 µs at 60 Hz. p95 uses nearest rank. Frame-number gaps are reported separately and are not counted as late frames.

## Scroll

| Refresh | Run | Frames | Late frames | Late | `totalSpan` p95 / max | Frame-number gaps | Raw log |
|---:|---:|---:|---:|---:|---:|---:|---|
| 90 Hz | 1 | 2,504 | 2,461 | 98.2827% | 29.994 / 42.602 ms | 793 | [log](scroll-90hz-1.log) |
| 90 Hz | 2 | 2,501 | 2,501 | 100.0000% | 29.952 / 39.614 ms | 803 | [log](scroll-90hz-2.log) |
| 90 Hz | 3 | 2,498 | 2,498 | 100.0000% | 29.928 / 53.853 ms | 805 | [log](scroll-90hz-3.log) |
| 60 Hz | 1 | 2,216 | 46 | 2.0758% | 13.661 / 29.968 ms | 0 | [log](scroll-60hz-1.log) |
| 60 Hz | 2 | 2,213 | 14 | 0.6326% | 12.060 / 30.040 ms | 0 | [log](scroll-60hz-2.log) |
| 60 Hz | 3 | 2,205 | 11 | 0.4989% | 10.615 / 22.031 ms | 0 | [log](scroll-60hz-3.log) |

## Reaction/count updates

| Refresh | Run | Frames | Late frames | Late | `totalSpan` p95 / max | Raster p95 | Raw log |
|---:|---:|---:|---:|---:|---:|---:|---|
| 90 Hz | 1 | 1,034 | 95 | 9.1876% | 12.281 / 19.923 ms | 6.043 ms | [log](reaction-90hz-1.log) |
| 90 Hz | 2 | 1,235 | 124 | 10.0405% | 13.769 / 48.648 ms | 6.633 ms | [log](reaction-90hz-2.log) |
| 90 Hz | 3 | 1,240 | 128 | 10.3226% | 13.739 / 33.912 ms | 6.183 ms | [log](reaction-90hz-3.log) |
| 60 Hz | 1 | 1,450 | 167 | 11.5172% | 21.885 / 33.478 ms | 12.138 ms | [log](reaction-60hz-1.log) |
| 60 Hz | 2 | 1,225 | 138 | 11.2653% | 24.829 / 36.557 ms | 9.754 ms | [log](reaction-60hz-2.log) |
| 60 Hz | 3 | 1,451 | 153 | 10.5445% | 24.146 / 40.030 ms | 11.266 ms | [log](reaction-60hz-3.log) |

Unlike the 8 October attempts, these 9 October interactions updated the visible count: the old `profiling` fixture omitted `stateRevisions`, so those prior reaction timings did not reflect a changing UI and are not used in this table. The fixture now returns initial revisions and publishes consistent revisions/viewer state for mutations. The new captures contain at least 1,034 rasterized frames each, enough to show the sustained workload and the absolute-threshold failure.

## First Feed load and full summary

Six additional first-load captures were taken on the current APK, three per supported refresh mode. Before each sample the app process was force-stopped and relaunched; the local T02 fixture delayed the Feed response by five seconds. `Loading polls` appeared in all six first-load accessibility hierarchy dumps. Each sample contains only 12–36 rasterized frames and includes process startup, so the elevated short-sample late percentages below are recorded as startup diagnostics, not as sustained-rendering AC-12 rates.

| Refresh | Run | Frames | Late | `totalSpan` p95 / max | Loading visible | Raw records |
|---:|---:|---:|---:|---:|:---:|---|
| 90 Hz | 1 | 13 | 76.9231% | 65.413 / 135.802 ms | yes | [timings](first-load-90hz-1.log), [hierarchy](first-load-90hz-1.xml) |
| 90 Hz | 2 | 12 | 75.0000% | 99.752 / 104.199 ms | yes | [timings](first-load-90hz-2.log), [hierarchy](first-load-90hz-2.xml) |
| 90 Hz | 3 | 15 | 53.3333% | 129.784 / 138.901 ms | yes | [timings](first-load-90hz-3.log), [hierarchy](first-load-90hz-3.xml) |
| 60 Hz | 1 | 13 | 46.1538% | 63.763 / 144.587 ms | yes | [timings](first-load-60hz-1.log), [hierarchy](first-load-60hz-1.xml) |
| 60 Hz | 2 | 36 | 27.7778% | 68.880 / 164.811 ms | yes | [timings](first-load-60hz-2.log), [hierarchy](first-load-60hz-2.xml) |
| 60 Hz | 3 | 13 | 46.1538% | 90.741 / 115.020 ms | yes | [timings](first-load-60hz-3.log), [hierarchy](first-load-60hz-3.xml) |

The earlier 8 October first-load captures remain archived in [their profile](../android-ac12-2026-10-08/README.md). All current sustained-run metrics plus the six current startup samples are in [summary JSON](summary-2026-10-09.json); startup-only values are also available in [first-load summary](first-load-summary-2026-10-09.json). Capture metadata: [measurement log](capture-measurements.txt). This is an absolute baseline; no motion-on/off comparison was captured.
