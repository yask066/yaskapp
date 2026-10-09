# M24 Flutter entry motion verification

**Date:** 9 October 2026
**Scope:** one-shot card/reply entry motion, list context identity, and skeleton-to-content transition.

## Implementation

- Added `EntryMotion` with a registry owned by `EntryMotionRegistryScope`, above each list. The registry clears when the list context changes and survives row disposal/remount.
- Mounted Sliver/List rows inspect their bounds against the nearest viewport. Rows first mounted outside the viewport are marked seen and do not animate later when scrolling.
- Visible rows use a 200 ms opacity and 8→0 logical-pixel translation. Layout size stays final; the first six batch indices stagger by 35 ms and later items start without a stagger. Hit testing and semantics stay available at zero opacity.
- Connected feed/search poll and user results, own/public profile polls, subscriptions, notifications, root comments, and replies. Existing route, pagination, read-state, and mutation handlers are preserved.
- Added `ContentEntryTransition` for one skeleton/content crossfade up to 120 ms. Reduced motion replaces an in-flight transition with the current static state immediately.

## Verification

- RED: the new `entry_motion_test.dart` failed to compile because `entry_motion.dart` and its widgets were absent.
- RED: a reduced-motion test caught the skeleton staying at 0.5 opacity after the system setting changed during a crossfade. Keying the switcher by effective duration now settles to static content immediately.
- `flutter test --no-pub test/entry_motion_test.dart`: **13/13 passed**. Coverage includes 200 ms timing, viewport behavior, flags off, new context, virtualized Sliver remount, stagger bound, reduced motion during both transitions, TickerMode pause/resume, background/resume, hit target, and dispose cleanup.
- Search pagination/navigation suite: **20 passed, 1 skipped**. The cursor-page scenario opens Comments after both pages and returns without replaying the row.
- Affected feed/profile/public-profile/comments/notifications suites: **68 passed**.
- Full Flutter suite: **263 passed, 1 skipped**, exit 0.
- `flutter analyze`: **12 existing diagnostics** in the app/test tree; none originate in the new `entry_motion.dart` or the new widget tests. Existing profile-screen diagnostics predate this diff.
- `flutter build apk --debug --no-pub`: **passed** (`assembleDebug`).
- `git diff --check`: clean.

## Device smoke

Not completed. `flutter devices` found Windows, Chrome, and Edge only; `adb devices -l` found no Android device. The configured Pixel 7 AVD exited with code 1 at startup. Its configuration targets Android 37 but the corresponding system-image directory is empty, so there is no installed image for the AVD to boot. The debug APK build does not substitute for physical/emulator smoke; this acceptance check remains open.
