# M09 verification — Web card geometry

**Date:** 5 October 2026
**Base:** `1b8c437`
**Scope:** PollCard media, option results, pending state, action counts, and avatar dimensions.

## Changes

- Poll media reserves a 16:9 box before the image resolves. A failed image uses an in-place fallback and Retry control; retrying keeps the same box.
- Avatar images switch to a same-size initials fallback on load failure.
- Option vote counts keep a 9ch slot and percentages keep a 4ch slot. Counts below 1,000 stay full; counts from 1,000 use English compact notation (for example, `1K`). Accessible labels keep the exact comma-grouped count.
- Like and comment counts use compact notation from 1,000 and a 4ch slot, with full exact values in accessible names. Numeric slots use tabular figures.
- Pending text has a fixed line-height and reserved row; only the active row exposes a screen-reader status. At the mobile breakpoint, option labels use a full row and vote/percentage values move below them so 200% text scaling leaves room for long labels.
- Result percentages are clamped to 0–100 and retain option order.

## Verification

| Check | Result |
|---|---|
| PollCard, Avatar, and CSS tests | 38 passed |
| Full web Vitest suite | 177 passed across 27 files on the final run |
| Web TypeScript check | Passed with `tsc --project apps/web/tsconfig.json --noEmit --tsBuildInfoFile D:/yaskapp/.task9-web.tsbuildinfo`; the package script could not write its default `apps/web/tsconfig.tsbuildinfo` in this sandbox |
| ESLint on changed TS/TSX files | Passed with `--max-warnings 0` |
| `git diff --check` | Passed |
| Real-browser count cycle, 9→10→99→100→999→1000→999→100→99→10→9 | Anchor stayed at 922.98 CSS px throughout in the default browser viewport; maximum measured shift 0 px |
| Real-browser pending toggle | Anchor stayed unchanged after fixing the pending row line-height; 0 px shift in both the default and 390×844 viewport checks |
| Media geometry | Measured ratio 1.7778 after initial missing-image fallback and Retry; target 16:9 ratio is 1.7778 |
| Text scaling and narrow viewport | At 200% body text (32px) in a 390×844 viewport override, document scroll width was 376px against a 391px browser inner width. Long option labels retained 229px of width; no horizontal overflow |
| Late font load | Not applicable: this page uses the system font stack and declares no downloaded web font or font preload |

The browser check used a temporary local React harness rendering the actual `PollCard`; the harness was removed after measurement. The exact browser build was not exposed by the in-app browser. One earlier parallel full-suite run had two `poll-lifecycle.test.tsx` failures; that file passed alone and the final full-suite run passed all tests. Existing MSW unmatched-request diagnostics still appeared during some passing feed/profile tests.

## Review

The check covered 16:9 reservation, media error/retry, avatar fallback size, pending insertion/removal, count growth and reversal, 0/100 percentages, order retention, narrow-width wrapping, accessible full counts, and the 2 CSS px anchor limit. No web fonts load asynchronously, so there was no late-font event to simulate. Device performance profiling was outside M09.
