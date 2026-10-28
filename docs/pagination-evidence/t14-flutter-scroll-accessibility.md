# T14 Flutter scroll and accessibility evidence

Captured: 2026-10-28
Scope: Flutter scroll restoration, Following lifecycle, pagination accessibility and final build validation for T14.

## Automated behavior checks

| Requirement | Evidence |
|---|---|
| Restore a third Following page after opening and returning from comments without fetching the chain again | `apps/mobile/test/subscriptions_screen_test.dart`: `returning from comments keeps page three and its cursor chain` checks the retained third page and cursor sequence. |
| Keep an anchor stable when media above it resizes | `apps/mobile/test/list_scroll_anchor_host_test.dart`: `restores the visible anchor when media above it resizes` asserts a displacement of at most 8 logical px. |
| Keep an anchor stable when media grows during a user scroll | `apps/mobile/test/list_scroll_anchor_host_test.dart`: `restores the anchor when media grows during a user scroll` asserts a displacement of at most 8 logical px; it also guards against extent updates overwriting the last settled anchor. |
| Keep the original anchor through consecutive media growth immediately after an automatic correction | `apps/mobile/test/list_scroll_anchor_host_test.dart`: `restores consecutive media growth after a scroll correction` triggers a second extent increase on the correction itself and asserts a displacement of at most 8 logical px. |
| Rebase an anchor when viewport growth clamps the current position at the list end | `apps/mobile/test/list_scroll_anchor_host_test.dart`: `settles when viewport growth makes the saved offset unreachable` verifies the current visible position is captured once and does not trigger repeated correction. |
| Preserve an explicit return-to-top action when pending notifications are materialized | `apps/mobile/test/notifications_screen_test.dart`: `pending banner materializes new items once and returns to top` confirms the user's `jumpTo(0)` is not undone by the changed item IDs. |
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
| `flutter test --reporter json` | Exit 0; 390 visible tests passed, 1 skipped, and 49 hidden tests passed. |
| `flutter build apk --debug` | Exit 0; built `build/app/outputs/flutter-apk/app-debug.apk`. |
| `git diff --check` | Exit 0. |

## Android runtime check

The physical Android anchor probe was captured on 2026-10-28 on a Samsung SM-A325F running Android 13/API 33 (1080×2400 at 420 dpi, active 90 Hz). It saved `anchor-item-0` at 200 logical px, grew the unanchored header above the list by 96 logical px, and measured 0 logical px drift against the 8 px bound. The raw runtime output is in [`t27-android-sm-a325f-profile.json`](t27-android-sm-a325f-profile.json), under `scrollAnchor`. After the final consecutive-growth correction, the current host and regression suite were rerun on the same device below.

After the final T14 scroll-host fixes, current Android-targeted tests ran on device `RF8R321M9LJ` and passed 67/67:

```sh
flutter test --device-id RF8R321M9LJ --reporter compact \
  test/list_scroll_anchor_host_test.dart \
  test/list_scroll_state_test.dart \
  test/cursor_list_controller_test.dart \
  test/subscriptions_screen_test.dart \
  test/pagination_footer_test.dart \
  test/entry_motion_test.dart
```

This run covered the final anchor host, keyboard/media resize, unreachable end-boundary rebasing, deleted anchors, third-page Following return, append-error restoration, footer semantics/focus, enlarged text, reduced motion and entry animation behavior. The real-device profile probe remains the runtime measurement; the targeted tests verify the final code on the same Android device.
