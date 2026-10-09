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

### Fresh M24 re-check — 9 October 2026

- Focused entry/feed/search/profile/public-profile suites: **61 passed, 1 skipped** (`flutter test --no-pub test/entry_motion_test.dart test/feed_screen_test.dart test/search_screen_test.dart test/profile_screen_test.dart test/public_profile_screen_test.dart`).
- Full Flutter suite: **266 passed, 1 skipped** (`flutter test --no-pub`).
- `flutter analyze lib/src/core/motion/entry_motion.dart test/entry_motion_test.dart`: **no issues found**.
- Full `flutter analyze`: exit 1 with **11 diagnostics** in existing auth, home, polls, profile, reports, and test files; none are in the two `entry_motion` files. The current count is one fewer than the earlier recorded run.

## Device smoke

Completed on physical Samsung SM-A325F (`RF8R321M9LJ`), Android 13 / API 33, 1080×2400 at 420 dpi. A profile build with `YASKAPP_REACTIONS_MOTION=false` and `YASKAPP_ENTRY_MOTION=true` installed and launched. Signed into the local T02 fixture, confirmed entry-bearing cards on Feed, scrolled the list, ran a Search query and saw poll result cards, opened the Profile tab and saw its fixture polls, then logged out to the login screen. The completed run had no fatal exception; captured Android accessibility trees are in [device smoke evidence](m24-device-smoke-2026-10-09/README.md).

The smoke used `adb reverse` to a local T02 fixture, not production or staging. A temporary copy of the fixture server preserved base search cards and returned the profile-polls route because the stock `profiling` preset clears those base cards and does not implement that route. The temporary server stayed under the ignored `.tmp` directory; no application or fixture source was changed for the smoke. This is a functional UI smoke only: it does not measure AC-12 frame performance or compare motion on/off. The Samsung supports 60/90 Hz and does not provide the 120 Hz AC-12 mode; those profiling results and limitations remain in the [M17 Android profile](android-ac12-2026-10-09/README.md).
