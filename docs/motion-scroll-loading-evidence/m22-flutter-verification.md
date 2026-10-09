# M22 Flutter reaction motion verification

**Date:** 9 October 2026
**Scope:** Flutter reaction counts, percentages, result bars, and local like/selection press scale.

## Implementation

- Added `AnimatedCount` with an 180 ms default, immediate target semantics, compact formatting, non-negative values, current-value interruption, and controller cleanup.
- Bound count and percentage animation to `reactionsMotion`; result bars use 240 ms. All effects settle immediately when the flag is off, system reduced motion is enabled, or the app is backgrounded.
- Added a 160 ms local press scale capped at 1.08 for vote and like actions. The transform is inside the existing hit target, so it does not change action layout geometry; server/store updates do not trigger the pulse.
- Percentage text exposes the accepted target to semantics while hiding the animated visual copy.
- `MotionSettings.of` now defaults to static behavior when a standalone widget has no settings scope.

## Verification

- RED: the new `animated_count_test.dart` failed to compile because `animated_count.dart` and `AnimatedCount` were missing.
- Targeted count, reaction, PollCard layout, and store integration suites: **16/16 passed**.
- Full Flutter suite: **250 passed, 1 skipped**, exit 0 (`flutter test --no-pub`).
- Changed-file analyzer: **no issues** (`flutter analyze --no-pub` with the five changed Dart files).
- A full-package analyzer run still reports 12 existing info/warning diagnostics in app/test files; none are in the changed M22 files.
- `git diff --check`: clean.

Widget-clock coverage includes first mount, 9→10, 99→100, 999→1000, decrease, interrupted target, zero/negative counts, immediate reduced-motion and background completion, dispose, motion flags off/on, target semantics, 240 ms bars, local scale bounds, background cancellation, unchanged action rects, layout, and PollState integration.

No physical-device frame-time or AC-12 measurement was part of M22. M17 and G0 remain open; reaction flags remain off by default.
