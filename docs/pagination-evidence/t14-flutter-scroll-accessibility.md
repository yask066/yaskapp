# T14 Flutter scroll and accessibility evidence

Captured: 2026-10-22
Scope: Flutter widget behavior and build validation for T14.

## Automated behavior checks

| Requirement | Evidence |
|---|---|
| Restore a third Following page after opening and returning from comments without fetching the chain again | `apps/mobile/test/subscriptions_screen_test.dart`: `returning from comments keeps page three and its cursor chain` checks the retained third page and cursor sequence. |
| Keep an anchor stable when media above it resizes | `apps/mobile/test/list_scroll_anchor_host_test.dart`: `restores the visible anchor when media above it resizes` asserts a displacement of at most 8 logical px. |
| Keep a visible neighbor stable when its saved anchor is deleted | `apps/mobile/test/list_scroll_anchor_host_test.dart`: `keeps the nearest visible neighbor when its anchor is deleted` asserts a displacement of at most 8 logical px. |
| Keep the visible row stable during a keyboard viewport resize | `apps/mobile/test/list_scroll_anchor_host_test.dart` includes a keyboard-resize viewport case with the same 8 logical px bound. |
| Preserve list position after an append error | `apps/mobile/test/subscriptions_screen_test.dart`: `append error keeps a visible poll anchored in Following` asserts a displacement of at most 8 logical px. |
| Expose pagination actions and status to assistive technology; retain keyboard use through loading and retry | `apps/mobile/test/pagination_footer_test.dart` checks the Load more/Retry semantics, keyboard activation/focus, and Loading more status. |
| Keep focus on the user's current control after the page chain is exhausted and later refreshed | `apps/mobile/test/pagination_footer_test.dart`: `does not restore footer focus after exhaustion and refresh`. |
| Keep manual continuation readable with enlarged text | `apps/mobile/test/pagination_footer_test.dart`: `manual continuation remains readable with enlarged text` uses 2× text scaling. |
| Respect reduced motion and avoid replaying old entry animation IDs | `apps/mobile/test/entry_motion_test.dart` covers reduced motion and prevents replay after row remount. |
| Keep automatic continuation bounded and offer manual continuation | `apps/mobile/test/feed_pagination_test.dart`: `automatic loading stops after three pages until manual action`. |

## Flutter final checks

Commands were run from `apps/mobile` after the T14 changes:

| Command | Result |
|---|---|
| `flutter analyze` | Exit 0, no issues found. |
| `flutter test` | Exit 0; 375 passed, 1 skipped. |
| `flutter build apk --debug` | Exit 0; built `build/app/outputs/flutter-apk/app-debug.apk`. |
| `git diff --check -- apps/mobile` | Exit 0. |

## Android runtime check

The Android device check is still pending. `flutter devices --machine` listed Windows, Chrome, and Edge only; `adb devices -l` listed no attached devices. No Android runtime measurement or device screenshot was captured, so the widget-test bounds above are not presented as device evidence. The T14 checklist remains open for the Android anchor check and its runtime evidence.
