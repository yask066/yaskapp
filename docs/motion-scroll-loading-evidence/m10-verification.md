# M10 verification — Flutter card geometry

**Date:** 5 October 2026

**Base:** `f46c803`

**Scope:** `PollCard` media, pending state, count transitions, selection, and narrow text scaling.

## Changes

- Option rows always reserve an 18 logical px pending slot, so showing or clearing the vote spinner does not resize the card.
- Poll action counts use tabular figures and fixed-width slots. Counts at 1,000 and above use compact English labels (`1K`, `1M`, `1B`); semantics retain the exact value.
- The actions wrap when the card content is narrower than 340 logical px, preventing overflow at 200% text scale.
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
