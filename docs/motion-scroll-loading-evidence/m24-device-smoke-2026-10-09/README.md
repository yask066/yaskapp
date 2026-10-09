# M24 physical-device smoke — 9 October 2026

## Device and build

- Device: Samsung SM-A325F (`RF8R321M9LJ`), Android 13 / API 33, 1080×2400 at 420 dpi.
- Source revision: `68a85a795080669b210330ec7c8b94cdb2c14308`.
- Build: Flutter profile mode, installed with `flutter run --profile --no-pub`.
- Flags: `YASKAPP_REACTIONS_MOTION=false`, `YASKAPP_ENTRY_MOTION=true`.
- API: local T02 fixture over `adb reverse tcp:3128 tcp:3128`; synthetic user `T02 Viewer`.

## Scenarios and results

1. Installed and launched the profile build; login controls were available.
2. Signed in to the local fixture. Feed showed fixture poll cards, including the 99→100 count case. Scrolled the list and confirmed the following cards appeared.
3. Opened Search, submitted a query, and confirmed poll result cards appeared.
4. Opened Profile and confirmed the profile list rendered two fixture polls.
5. Logged out; the login screen returned. No persistent test session was left active.

The final completed run had no fatal or unhandled Flutter exception. The stock `profiling` fixture preset clears its base poll records and omits `/profiles/me/polls`, so a temporary copy under ignored `.tmp` preserved those records and supplied that profile route. The app source and tracked fixture were not modified. The first exploratory attempt against the stock preset exposed those missing fixture routes; the completed run used the extended local stub.

After the smoke, the device was reinstalled with the standard profile build (default API URLs and motion flags), the local fixture process was stopped, and the ADB reverse mapping was removed.

Accessibility-tree captures from the device are retained as [Feed](feed.xml), [Search results](search-results.xml), and [Profile](profile.xml).

## Scope

This is a functional smoke on one physical Android device. It does not establish AC-12 performance or a motion-off comparison. The device supports 60 Hz and 90 Hz, not 120 Hz; AC-12 Android results remain as recorded in the [M17 profile](../android-ac12-2026-10-09/README.md).
