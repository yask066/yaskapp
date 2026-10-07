# M10 verification — Flutter card geometry

**Date:** 5 October 2026

**Base:** `f46c803`

**Scope:** `PollCard` media, pending state, count transitions, selection, and narrow text scaling.

## Changes

- Option rows always reserve an 18 logical px pending slot, so showing or clearing the vote spinner does not resize the card.
- Poll action counts use tabular figures and fixed-width slots. Counts at 1,000 and above use compact English labels (`1K`, `1M`, `1B`); semantics retain the exact value.
- Action metrics use `Wrap`, so their run layout responds to the actual child widths and available card width, including scaled content.
- The existing 16:9 media box and same-size image error fallback remain in place.
- The report-menu test fixture now provides the model's `viewerVoteOptionId` field, so its selected/cancel-vote scenario exercises the actual parser contract.

## Verification

| Check | Result |
|---|---|
| Layout rects before/after media resolution, pending, and count changes | Card and action positions stayed within 2 logical px; media remained 16:9 |
| Count cycle, including zero: `0, 9, 10, 99, 100, 999, 1000` and reverse | Card height and comment/like action rects remained stable |
| Long question and option at 200% text scale, 320×720 viewport | No Flutter layout exception or horizontal overflow |
| Selected option and Cancel vote menu | Present; card/action geometry stayed stable |
| M10 layout/report + affected Feed, Subscriptions, Poll Comments, Notifications widget suites | 66 passed |
| Targeted `flutter analyze` on changed Dart files | No issues found |
| `git diff --check` | Passed |

The additional broad Profile/Search screen sweep still reports 10 failures already tracked by the M02/M08 audit, including pending realtime timers and existing Search loading expectations. Those failures are recorded in [the audit](../motion-scroll-loading-audit.md#15-flutter-failures-все-воспроизведены); this verification does not claim the full mobile suite is clean.

## M17 physical Android follow-up — 7 October 2026

The first Samsung A32 check at Android 13, 1080×2400, and system `font_scale=2.0` exposed clipping in the composer, PollCard action row, and Search heading, plus three unnamed clickable controls. M10 was reopened. On 7 October, the composer was made to reflow, action metrics now wrap to the available width, Search headings wrap, and the author avatar and center create action received screen-reader labels.

The repaired profile APK was reinstalled on the same phone and checked again at 200%. The composer text and button are fully visible; the reaction row places Share on a second line; and “Explore popular searches” wraps over two lines without clipping. With TalkBack enabled, the hierarchy exposes `Open yask066 profile` and `Create poll` as control names. The prior clipping and missing-name findings are resolved for this scoped check. Evidence is in [M17 Android evidence](m17-android-checks.md).
