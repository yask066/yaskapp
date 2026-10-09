# M20 Flutter verification

**Date:** 9 October 2026
**Result:** M20 implementation and automated acceptance checks complete.

## Behavior

- `MotionSettingsScope` injects session-independent `reactionsMotion` and `entryMotion` flags; both default to false. The app entry point reads the build-time `YASKAPP_REACTIONS_MOTION` and `YASKAPP_ENTRY_MOTION` defines.
- `MotionSettings.of` derives effective reduced motion from live `MediaQuery.disableAnimations`; the system preference overrides either rollout flag. Lifecycle pause disables motion and resume restores eligibility.
- Count, reaction, skeleton/content-entry and entry effects use presentation-owned controllers and settle immediately when motion is disabled. The settings scope contains no store or mutation calls.
- Existing programmatic scroll honors reduced motion: notification materialization jumps to the top, and comment/reply target scrolling uses `Duration.zero`.

## Verification

| Check | Result |
|---|---|
| `flutter test --no-pub test/motion_settings_test.dart test/motion_flags_test.dart` | 6 passed |
| Flutter full suite: `flutter test --no-pub` | 265 passed, 1 skipped |
| Changed-file analysis for settings, tokens, flags, app entry and tests | No issues found |
| Independent build flag: reactions on, entry off | Passed |
| Independent build flag: reactions off, entry on | Passed |
| Both build flags on | Passed |
| Package-wide `flutter analyze --no-pub` | 11 existing diagnostics in auth, home, polls, profile, reports and unrelated tests; none in M20 files |

The focused analyzer issue in `motion_settings_test.dart` was fixed by making the test's `MaterialApp` const-correct. The package-wide diagnostics remain outside M20 scope. AC-12 performance and G0 are tracked separately and remain not passed.
