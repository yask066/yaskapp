# M27 automated verification

**Date:** 9 October 2026  
**Source commit:** `fab3029` (`feat(mobile): configure motion rollout flags`)  
**Result:** automated release preparation checks pass; device/performance release gates remain open.

## Flutter

- `flutter test --no-pub` — **265 passed, 1 skipped**, exit 0.
- Motion/disable smoke set (`motion_flags_test.dart`, `motion_settings_test.dart`, `poll_card_motion_test.dart`, `animated_count_test.dart`, `entry_motion_test.dart`, `content_skeleton_test.dart`, list scroll, feed/search and poll state suites) — **100 passed, 1 skipped**, exit 0. This confirms the default-off path leaves reactions static and exercises existing loading, list restoration, feed/search, and state behavior.
- Build-configuration test with default defines — **2 passed**; reactions-only, entry-only, and both-on variants of `reads independent rollout flags from the build environment` — **1 passed each**. Commands use `flutter test --no-pub --dart-define=YASKAPP_REACTIONS_MOTION=... --dart-define=YASKAPP_ENTRY_MOTION=...`.
- `flutter analyze --no-pub lib/main.dart lib/src/core/motion/motion_flags.dart test/motion_flags_test.dart` — **no issues found**.
- `flutter build apk --profile --no-pub --dart-define=YASKAPP_REACTIONS_MOTION=true --dart-define=YASKAPP_ENTRY_MOTION=false` — succeeded; `build/app/outputs/flutter-apk/app-profile.apk`, 74.1 MB.
- Same profile APK build with both defines `true` — succeeded; output 93.3 MB.
- `flutter build apk --profile --no-pub` with defaults — succeeded with both flags off.
- Full `flutter analyze --no-pub` remains exit 1 with 12 existing diagnostics in auth, home, poll, profile, reports and test files. This matches the M26/M22 record; none point to M27 files.

No physical-device smoke was performed as part of the 9 October M27 run. A subsequent M26 physical-device addendum on 10 October captured paired 60/90 Hz profiles, first-load diagnostics, one 20-cycle navigation run, a 200% text hierarchy and TalkBack service state; see [M26 device evidence](m26-device-2026-10-10/README.md). That later evidence still fails the Android AC-12 threshold and leaves parts of accessibility and resource comparison open.

## Web

After `npm ci` and `npm run shared:build`:

- `npm run test -w @yaskapp/web -- --run` — **236 passed across 36 files**, exit 0. MSW printed pre-existing unhandled `/auth/me` and `/polls?limit=20` request notices in editor/feed tests; there were no test failures.
- `npm run typecheck -w @yaskapp/web` — exit 0.
- `npm run lint -w @yaskapp/web` — exit 0.
- Production builds (`npm run build -w @yaskapp/web`) succeeded in all four configurations. The generated JavaScript hashes differed, confirming the selected values are embedded at build time:

| Reactions | Entry | JavaScript asset |
|---|---|---|
| off (unset/default) | off (unset/default) | `index-B3M11Z_e.js` |
| on | off | `index-CicUg3G3.js` |
| off | on | `index-xCi-t0qs.js` |
| on | on | `index-C58Ft1aA.js` |

These are build and automated-test checks, not browser frame profiles. The M17/M23 Chrome profiles are historical and do not establish M26's paired results.

## Release gate

M27 release preparation is complete: Flutter configuration and web/mobile build-time controls are documented, both flags default off and remain independent, and rollback requires a rebuild. M26 was administratively closed at the user's direction without additional tests; this did not pass its acceptance gates. G0 remains **NOT PASSED** and physical Android paired traces fail the absolute AC-12 threshold. A matched process-resource comparison exists, but direct Flutter listener/controller/timer counters, frame-by-frame live reduced-motion suppression and spoken TalkBack verification remain open. No rollout or deployment is approved by these results; PRD AC-14–AC-16 remain incomplete.
