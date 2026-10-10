# M27 automated verification

**Date:** 9 October 2026; refreshed 10 October 2026

**Original source commit:** `fab3029` (`feat(mobile): configure motion rollout flags`)

**Refreshed source commit:** `77adc92ba1bd53195ccb82aa2d7bf523b7e2867f` (`docs: close M26 disposition and finish M27 prep`)

**Result:** M27 release preparation is complete. Current automated checks pass; the release gates that depend on device/accessibility/performance evidence remain partial or failed.

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

## Release gate — prior disposition before this refresh

M27 release preparation is complete: Flutter configuration and web/mobile build-time controls are documented, both flags default off and remain independent, and rollback requires a rebuild. M26 was administratively closed at the user's direction without additional tests; this did not pass its acceptance gates. G0 remains **NOT PASSED** and physical Android paired traces fail the absolute AC-12 threshold. A matched process-resource comparison exists, but direct Flutter listener/controller/timer counters, frame-by-frame live reduced-motion suppression and spoken TalkBack verification remain open. In this pre-refresh disposition, PRD AC-14–AC-16 were incomplete; see the updated status below.

## Refreshed verification on current source — 10 October 2026

All commands below ran from the isolated worktree at `77adc92ba1bd53195ccb82aa2d7bf523b7e2867f`.

### Flutter

- `flutter test --no-pub` — **271 passed, 1 skipped**, exit 0.
- `flutter test --no-pub --plain-name "reads independent rollout flags from the build environment" test/motion_flags_test.dart` — **1 passed** in each of four configurations: defaults, reactions-only, entry-only and both-on. The separate default-only assertion is exercised in the full suite; it is intentionally excluded from enabled-define runs.
- Focused `flutter analyze --no-pub lib/main.dart lib/src/core/motion/motion_flags.dart test/motion_flags_test.dart` — **no issues found**.
- Current-source profile APK with default/off flags — **built successfully**, 74.1 MB.
- Additional current-source profile APK variants could not be completed: after earlier build attempts exhausted the C: drive, Gradle failed with “not enough space”; Flutter-generated build output was cleaned afterward. The 9 October source-revision matrix above remains historical evidence and is not represented as a current-source build.

### Web

- `npm ci` and `npm run shared:build` completed successfully.
- `npm run test -w @yaskapp/web -- --run` — **240 passed across 36 files**, exit 0. MSW emitted existing unhandled-request notices for `/auth/me`, `/polls?limit=20`, and `/polls/poll-1`; no test failed.
- `npm run typecheck -w @yaskapp/web` and `npm run lint -w @yaskapp/web` — exit 0.
- Production builds succeeded for all four build-time flag combinations. The current JavaScript assets were `index-Yu76V5Zy.js` (off/off), `index-ByWbIjzg.js` (reactions only), `index-GfHg3Mmp.js` (entry only), and `index-DjYivNeA.js` (both on). Distinct assets confirm the selected values are embedded at build time; this does not replace browser interaction or frame-profile evidence.

### M27 and PRD disposition

| Item | Current disposition | Evidence / remaining condition |
|---|---|---|
| M27 release preparation | **Complete** | Build-time controls, defaults, rollback, rollout sequence, owners, tested platform matrix and blocker report are documented. |
| PRD AC-14 | **Partial** | Four-mode web builds, Flutter flag-reader tests and current default APK build pass. The full cross-platform live smoke for errors/loading/anchors in every flag mode remains deferred with M26. |
| PRD AC-15 | **Partial** | Current Flutter and Web automated suites pass. The deferred M26 accessibility/device matrix is not complete. |
| PRD AC-16 | **Complete as documentation** | G0 report, final Android comparison, tested configuration/build matrix, limitations and disable instructions are recorded in this report and [release instructions](../motion-release-verification.md). AC-12 itself remains failed. |

M26 remains closed administratively with its outstanding acceptance checks deferred. G0 remains **NOT PASSED**, AC-12 remains **FAIL**, and motion must stay off in delivered builds. M27 is complete as release preparation; this does not authorize rollout, deployment, or completion of the overall PRD Definition of Done.
