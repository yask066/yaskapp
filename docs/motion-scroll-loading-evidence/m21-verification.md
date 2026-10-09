# M21 Web reactions verification

Date: 2026-10-09
Base commit: `6fca22c`
Scope: `AnimatedCount`, PollCard reaction presentation, and local like behavior.

## Implementation

- Reaction effects remain gated by the independent `reactionsMotion` flag and the live reduced-motion/visibility setting.
- Counts and percentages crossfade for the shared 180 ms token. The target value is immediately available to assistive technology; the outgoing value is decorative.
- Result bar width transitions use the 240 ms token. Selected and liked styles use the 160 ms token.
- A local like click may scale the clicked button to 1.08 and back. It invokes the existing callback once. Remote poll updates never pulse the button.
- Compact display formatting is preserved for vote and like counts. No count-up sequence or mutation queue is introduced.

## Verification

- `npm run test -w @yaskapp/web -- --run`: 34 files, 226 tests passed.
- `npm run typecheck -w @yaskapp/web`: passed.
- `npm run lint -w @yaskapp/web`: passed after removing unused test mock parameters.
- `npm run build -w @yaskapp/web`: passed (production build).
- `git diff --check`: passed.
- Browser preview loaded the T02 profiling fixture with reactions motion enabled and rendered the card containing the 99→100 scenario. The available browser interface did not expose DOM rectangle measurement, so the ≤2 CSS px geometry criterion is **not measured**.
- No physical screen reader or device run was performed for this web task. Automated tests verify the immediate semantic target, decorative outgoing text, no added live region, one local callback, and remote updates without a pulse.

## Open criterion

M21 implementation is ready, but the plan's browser rectangle check remains open. M18/G0 remains `NOT PASSED`; the motion flag stays off by default unless explicitly enabled.
