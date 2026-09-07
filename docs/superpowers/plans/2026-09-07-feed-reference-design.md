# Feed Reference Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the public web feed to match the supplied Yask reference without changing functional API behaviour.

**Architecture:** Preserve React Router and TanStack Query data flow. `AppLayout` owns the global shell; `FeedPage` owns query states, sorting, and the discovery rail; `PollCard` remains the reusable API-driven interactive component.

**Tech Stack:** React 19, TypeScript, React Router 7, TanStack Query 5, Vite, Vitest, Testing Library, CSS.

**Spec:** `docs/superpowers/specs/2026-09-07-feed-reference-design.md`

## Global Constraints

- Work only under `apps/web`; do not change API routes, server data, or moderation client code.
- Preserve the skip link, visible focus treatment, semantic controls, existing poll mutations, and current route paths.
- Add no dependencies or icon packages.
- Desktop layout has left navigation, centre feed, and right discovery rail; rails are absent below the desktop breakpoint.
- Verify with web unit tests, `typecheck`, `lint`, `build`, and `git diff --check`.

---

### Task 1: Build the responsive application shell

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/components/AppLayout.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `useSession(): { status, user, signOut }`, React Router `Link`, `Outlet`.
- Produces: semantic `.app-shell`, `.app-header`, `.app-sidebar`, `.app-content` containers used by every route.

- [ ] **Step 1: Write the failing shell test**

```tsx
it('renders primary navigation for authenticated users', () => {
  render(<AppLayout />);
  expect(screen.getByRole('link', { name: 'Feed' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create poll' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @yaskapp/web -- AppLayout.test.tsx`

Expected: FAIL because reference shell structure is absent.

- [ ] **Step 3: Implement header and side navigation**

```tsx
<div className="app-shell">
  <header className="app-header">…</header>
  <aside className="app-sidebar" aria-label="Primary navigation">…</aside>
  <div className="app-content"><Outlet /></div>
</div>
```

Keep anonymous login/register links, existing `Avatar`, `/polls/new`, `/search`, `/me`, and sign-out behaviour.

- [ ] **Step 4: Add shell CSS**

Define blue-tinted background and a grid above `1024px`; below it hide `.app-sidebar`, compact header metadata, and prevent horizontal overflow.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @yaskapp/web -- AppLayout.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/AppLayout.tsx apps/web/src/components/AppLayout.test.tsx apps/web/src/styles/global.css
git commit -m "feat(web): add reference-style app shell"
```

### Task 2: Add the feed layout and discovery rail

**Files:**
- Modify: `apps/web/src/features/feed/FeedPage.tsx`
- Modify: `apps/web/src/features/feed/FeedPage.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `listPolls`, `useSession`, `usePollMutations`, unchanged `PollCard`.
- Produces: `.feed-page`, `.feed-main`, `.feed-sidebar`, `.feed-tabs`, and `aside[aria-label="Discover content"]`.

- [ ] **Step 1: Write the failing layout test**

```tsx
it('renders trend discovery beside the feed', async () => {
  renderFeed();
  expect(await screen.findByRole('heading', { name: 'Feed' })).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Discover content' })).toBeInTheDocument();
  expect(screen.getByText('#Programming')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @yaskapp/web -- FeedPage.test.tsx`

Expected: FAIL because no complementary discovery rail exists.

- [ ] **Step 3: Implement semantic feed and rail markup**

```tsx
<div className="feed-page">
  <section className="feed-main" aria-label="Poll feed">…</section>
  <aside className="feed-sidebar" aria-label="Discover content">…</aside>
</div>
```

Keep selected sort `aria-pressed`, existing query states and mutations. Use static trend links and an Explore CTA; do not add a new API query.

- [ ] **Step 4: Add feed CSS**

Limit feed width to approximately 620px; use blue selected tab pills, white rounded rail panels, and hide `.feed-sidebar` below `1024px`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @yaskapp/web -- FeedPage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/feed/FeedPage.tsx apps/web/src/features/feed/FeedPage.test.tsx apps/web/src/styles/global.css
git commit -m "feat(web): add feed discovery layout"
```

### Task 3: Restyle poll cards without changing interactions

**Files:**
- Modify: `apps/web/src/components/PollCard.tsx`
- Modify: `apps/web/src/components/PollCard.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: unchanged `PollCardProps` and `Poll` API model.
- Produces: accessible `.poll-card`, `.poll-option`, `.poll-result-bar`, `.poll-actions` elements with unchanged callbacks.

- [ ] **Step 1: Write the failing result test**

```tsx
it('exposes percentage bars after voting', () => {
  render(<PollCard poll={{ ...poll, viewerVoteOptionId: poll.options[0].id, votesCount: 10 }} viewerId="viewer" />);
  expect(screen.getByRole('progressbar', { name: /Option one/i })).toHaveAttribute('aria-valuenow', '50');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @yaskapp/web -- PollCard.test.tsx`

Expected: FAIL because result bars are absent.

- [ ] **Step 3: Implement result bars and class hooks**

```tsx
<div className="poll-result-bar" role="progressbar" aria-label={option.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
  <span style={{ width: `${percentage}%` }} />
</div>
```

Calculate `percentage` safely for a zero total. Preserve radios, vote buttons, cancellation, likes, comments and deletion.

- [ ] **Step 4: Add card CSS**

Style white rounded cards, author metadata, pale option surfaces, blue progress tracks and wrapping action groups for 320px screens.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w @yaskapp/web -- PollCard.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run the validation suite**

```bash
npm run test -w @yaskapp/web
npm run typecheck -w @yaskapp/web
npm run lint -w @yaskapp/web
npm run build -w @yaskapp/web
git diff --check
```

Expected: every command exits with code 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/PollCard.tsx apps/web/src/components/PollCard.test.tsx apps/web/src/styles/global.css
git commit -m "feat(web): restyle interactive poll cards"
```
