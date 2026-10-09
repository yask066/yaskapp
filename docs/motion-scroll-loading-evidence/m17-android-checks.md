# M17 Android follow-up: 7 October 2026

Environment: physical Samsung SM A325F (`RF8R321M9LJ`), Android 13 / API 33; screen 1080×2400 at 420 dpi. Flutter Doctor reports Android SDK 37.0.0.

## Profile build and launch

Initial command: `flutter run --profile --no-pub -d RF8R321M9LJ` from `apps/mobile`. After the M10 repair, `flutter build apk --profile` succeeded and the final 84.9 MB APK was reinstalled on the device.

- The initial profile APK was 30.3 MB; the final rebuilt APK after the M10 changes was 84.9 MB.
- APK installed. Flutter announced a Dart VM Service at `http://127.0.0.1:59776/mHtTFYfE18A=/`.
- Android package/activity was `com.example.yaskapp_mobile/.MainActivity`.
- Flutter device capabilities reported `hardwareRendering:false`.
- During the initial profile launch the phone showed its secure PIN lock screen; no PIN was entered. After the owner unlocked it, the app was visually inspected at 100% and 200% below. The subsequent physical Flutter frame-profile run is recorded separately below.

## Text scale and screen reader

- Initial Android `font_scale` was `1.1`. After the owner unlocked the phone, it was changed to `2.0`, the app was relaunched, then it was restored to `1.1`. The TalkBack service list was returned to its initial empty state and `accessibility_enabled` to `0`.
- The initial 200% check exposed clipping in the Feed composer, a missing Share action, and a clipped Search heading. These defects have been repaired. The post-repair screenshot shows the composer reflowing with its full prompt and “Create poll” button, all metrics visible with Share wrapped to a second line, and “Explore popular searches” wrapped to two lines. [Initial Feed at 100%](m17-android-100.png), [initial Feed at 200%](m17-android-200.png), [repaired Feed at 200%](m17-android-200-after-m10.png), [repaired Search at 200%](m17-search-200-after-m10.png).
- With Samsung TalkBack (`com.samsung.android.accessibility.talkback/com.samsung.android.marvin.talkback.TalkBackService`) enabled, the repaired Feed accessibility hierarchy exposed `Open yask066 profile` for the author avatar and `Create poll` for the center tab, alongside existing named Feed controls. The hierarchy contains no unlabeled clickable Feed controls. The keyboard focus smoke identified Search as a focused, named control in [Feed hierarchy](m17-accessibility-after-m10-feed.xml) and [focus evidence](m17-accessibility-focus-after-m10.xml).
- The earlier TalkBack setup requested permission to silence hints during calls; that permission was declined and is not needed for this check. TalkBack was disabled after the hierarchy/focus check, and Android settings were restored: `font_scale=1.1`, `enabled_accessibility_services=null`, `accessibility_enabled=0`. Device audio was not routed to the host, so spoken output was not independently verified by listening. No PIN or account credentials were collected.

## Full Flutter suite

Fresh command on 8 October after the Flutter suite fixes: `flutter test --no-pub --reporter expanded` from `apps/mobile`; exit code 0, 236 passed, 1 skipped. Detailed output is in [m17-flutter-tests-2026-10-08.txt](m17-flutter-tests-2026-10-08.txt). The earlier 223/13-failure log is historical and predates the latest repairs.

## Flutter frame profile

On 7 October, three 30-second profile traces were captured on the unlocked Samsung A32 using the same 100-card T02 fixture (seed `20261002`) and real alternating ADB swipes. The first run was repeated after fixing the local fixture WebSocket heartbeat; the three retained runs are 30.36 s/75 swipes, 30.23 s/76 swipes and 30.38 s/74 swipes. A separate Flutter `--trace-startup` summary reports 789 ms to first frame and 899 ms to first rasterized frame. [Trace details, artifacts, and interpretation limits](m17-flutter-android-profile.md).

## Remaining work

Android AC-12 now has Flutter `FrameTiming` captures for scroll, reaction/count updates, and fresh Feed loads with skeleton on the physical Samsung A32, at both supported 60/90 Hz modes. Scroll late-frame rate fails every 90 Hz run (98.875–99.957%) and one 60 Hz run (1.474%). Every 30-second reaction/update run also fails: 97.600–99.749% at 90 Hz and 3.588–3.883% at 60 Hz. The skeleton appeared in all six first-load samples. The motion-off comparison and a 120 Hz device mode remain unavailable; AC-12 is not passed. See the [Android AC-12 report and raw traces](android-ac12-2026-10-08/README.md). The physical Chrome/monitor profile remains Chrome 155 on a 1680×1050/60 Hz display, three 30-second runs, active page-source `MISSED` 0–0.0555%; see [physical Chrome evidence](m17-verification.md#physical-chrome--monitor-profile). TalkBack spoken output is also unverified; M17 and G0 are not closed.


## Current profile and final suite: 9 October 2026

The current profile was built from source commit `ac13b283f8e5587cdff18894646d3ee9641a3503` with `M17_AC12_PROBE=true` and installed on the same physical Samsung SM-A325F. The device was set to 90 Hz for reaction captures; Yaskapp was confirmed as the foreground activity before each repeated run. Each reaction run used 105 taps against the current revision-aware local T02 fixture. The previous 90 Hz attempts were invalid because the phone switched foreground apps; those logs were replaced by the valid runs in the current [AC-12 profile](android-ac12-2026-10-09/README.md). The 9 October fixture regression suite passes 11/11; its profile server returns `stateRevisions` and applies mutation/viewer updates so the visible count changes. The detailed summary and raw batches are linked from that profile.

Final automated results on 9 October: Flutter full suite 265 passed / 1 skipped; Web suite 240 passed; web typecheck, lint, and production build passed. Full `flutter analyze` exits 1 with 12 diagnostics; see [analyze log](m17-flutter-analyze-final-2026-10-09.txt). The Android 60/90 Hz measurements exceed the 1% absolute AC-12 limit in the recorded runs, so G0 remains NOT PASSED. Android setting overrides for refresh rate were restored after capture; Yaskapp remains open in the foreground.
