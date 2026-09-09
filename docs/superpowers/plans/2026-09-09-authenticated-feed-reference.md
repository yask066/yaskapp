# Authenticated Feed Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Match the supplied Yask reference on the authenticated home feed without changing APIs or poll actions.

**Architecture:** `AppLayout` keeps responsibility for the fixed authenticated shell. `FeedPage` owns the centre feed and desktop discovery rail. `PollCard` preserves its mutation contract and semantic controls while rendering reference-style metadata and results.

**Tech Stack:** React 19, React Router 7, TanStack Query, TypeScript, Vite, Vitest, Testing Library, CSS.

**Spec:** `docs/superpowers/specs/2026-09-07-feed-reference-design.md`

## Global Constraints

- Work only under `apps/web`; keep the API, auth, database, and moderation client unchanged.
- Preserve existing routes, mutations, loading/error/empty states, radio semantics, accessible controls, focus styles, and responsive single-column behavior.
- Do not add dependencies. Use existing CSS and the Avatar component.
- Reproduce the reference’s sticky header, 294px left rail, 750px feed, 300–388px discovery rail, near-white/blue palette, blue primary actions, and orange composer action.

---

### Task 1: Reference shell

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/components/AppLayout.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:** consumes `useSession` and existing routes; produces accessible `Primary navigation` and `Account navigation` plus class hooks for the header and rail.

- [ ] **Step 1: Write a failing shell test.** Assert the Yask home link, notification link to `/search?view=notifications`, and compact footer including `© 2026 Yask`.
- [ ] **Step 2: Run it.** `npm --prefix apps/web test -- AppLayout.test.tsx -t "reference account header" --run` — expected FAIL before the new assertion is supported.
- [ ] **Step 3: Implement semantic shell changes.** Keep all destinations as `Link`s, preserve session-aware account controls, and make footer entries individually readable.
- [ ] **Step 4: Style the shell.** Use `grid-template-columns: 294px minmax(0, 1fr)`, a sticky 5.1rem header, active Home pill, blue create button, notification badge, and muted footer; collapse the rail below 1024px.
- [ ] **Step 5: Verify.** `npm --prefix apps/web test -- AppLayout.test.tsx --run` — expected PASS.
- [ ] **Step 6: Commit.** `git add apps/web/src/components/AppLayout.tsx apps/web/src/components/AppLayout.test.tsx apps/web/src/styles/global.css; git commit -m "feat: align authenticated shell with feed reference"`.

### Task 2: Reference feed and discovery content

**Files:**
- Modify: `apps/web/src/features/feed/FeedPage.tsx`
- Modify: `apps/web/src/features/feed/FeedPage.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:** consumes `listPolls`, `usePollMutations`, `useSession`, and `PollCard`; produces composer, three feed segments, trends, discovery CTA, and follow suggestions in `Discover content`.

- [ ] **Step 1: Write a failing content test.** Assert `Trending topics`, `12.4K polls`, and `Who to follow` while mocking one poll response.
- [ ] **Step 2: Run it.** `npm --prefix apps/web test -- FeedPage.test.tsx -t "reference discovery labels" --run` — expected FAIL because labels/counts differ.
- [ ] **Step 3: Implement presentation data.** Replace only static labels/counts with `Trending topics`, `View all`, `Who to follow`, and reference count strings; retain topic links, collapse behavior, `/search` Explore link, and non-persisting Follow buttons.
- [ ] **Step 4: Style the layout.** At 1280px use `minmax(0, 750px) minmax(300px, 388px)`, hide the right rail below that size, keep equal-width feed tabs, pale-blue CTA, rank bubbles, and outline Follow buttons.
- [ ] **Step 5: Verify.** `npm --prefix apps/web test -- FeedPage.test.tsx --run` — expected PASS including retries and trend collapse.
- [ ] **Step 6: Commit.** `git add apps/web/src/features/feed/FeedPage.tsx apps/web/src/features/feed/FeedPage.test.tsx apps/web/src/styles/global.css; git commit -m "feat: match feed discovery reference"`.

### Task 3: Reference poll cards without changing poll behavior

**Files:**
- Modify: `apps/web/src/components/PollCard.tsx`
- Modify: `apps/web/src/components/PollCard.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:** consumes `Poll` plus the current vote, cancellation, like, delete, and comments callbacks; produces labelled percentage metadata and progress bars alongside preserved radio controls/actions.

- [ ] **Step 1: Write a failing result test.** For a voted poll, assert visible `67%` text and `progressbar` with `aria-valuenow="67"`.
- [ ] **Step 2: Run it.** `npm --prefix apps/web test -- PollCard.test.tsx -t "shows result percentage" --run` — expected FAIL before the explicit result-meta element exists.
- [ ] **Step 3: Implement.** Calculate each option percentage once, render targetable percentage/vote count metadata, retain the existing fieldset/radio behavior, and keep cancellation/deletion conditions unchanged.
- [ ] **Step 4: Style.** Render white rounded cards, pale option rows, blue fill bars, deep-navy headings, and light action controls; constrain images and wrap long text.
- [ ] **Step 5: Verify.** `npm --prefix apps/web test -- PollCard.test.tsx --run` — expected PASS.
- [ ] **Step 6: Commit.** `git add apps/web/src/components/PollCard.tsx apps/web/src/components/PollCard.test.tsx apps/web/src/styles/global.css; git commit -m "feat: restyle interactive poll cards"`.

### Task 4: Complete verification

**Files:**
- Verify: `apps/web/src/components/AppLayout.tsx`
- Verify: `apps/web/src/features/feed/FeedPage.tsx`
- Verify: `apps/web/src/components/PollCard.tsx`

**Interfaces:** consumes Tasks 1–3; produces verification evidence for the completed visual refresh.

- [ ] **Step 1: Run all tests.** `npm --prefix apps/web test -- --run` — expected PASS.
- [ ] **Step 2: Run static checks and build.** `npm --prefix apps/web run typecheck; npm --prefix apps/web run lint; npm --prefix apps/web run build` — expected exit code 0 for each command.
- [ ] **Step 3: Check whitespace.** `git diff --check` — expected no output and exit code 0.
- [ ] **Step 4: Commit any uncommitted verification-ready files.** `git status --short`, then add the changed web files and this plan and commit with `feat: match authenticated feed reference`.
