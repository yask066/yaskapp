# Figma Docs–Inspired Web Client Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Yask web client's current visual system with a restrained Figma Docs–inspired interface while preserving every existing route, API interaction, and accessibility behaviour, and retaining only the current Yask logo image.

**Architecture:** Keep the current React feature and data boundaries intact. Add stable semantic class hooks to existing components, then rebuild the shared stylesheet around a small neutral token system and page-level compositions; do not introduce a component library or new runtime dependency. Verify each markup change with Testing Library and finish with desktop/mobile browser inspection.

**Tech Stack:** React 19, React Router 7, TanStack Query 5, TypeScript 5.8, Vite 6, Vitest 3, Testing Library, CSS

**Spec:** `docs/superpowers/specs/2026-09-11-figma-docs-web-client-redesign.md`

## Global Constraints

- Limit product changes to `apps/web`.
- Preserve existing routes, API contracts, queries, mutations, validation rules, authentication gates, and accessible semantics.
- Keep `apps/web/public/branding/yaskapp_logo.png` as the only retained visual asset from the current design.
- Use the existing `MaterialIcon` component or CSS for interface icons; add no icon or UI package.
- Support keyboard navigation, visible focus, reduced motion, and layouts down to 320px without horizontal scrolling.
- Use a warm white canvas, near-black text, neutral gray metadata, hairline borders, one restrained blue accent, compact radii, and minimal shadow.
- Remove gradients, oversized pills, decorative illustrations, blue-tinted panels, and the current branding icons from the rendered interface.

## File Map

- `apps/web/src/components/AppLayout.tsx`: global header, primary navigation, account controls, and responsive shell.
- `apps/web/src/components/AppLayout.test.tsx`: shell semantics, retained logo, navigation, and asset-removal assertions.
- `apps/web/src/components/PollCard.tsx`: reusable poll hierarchy and class hooks; no data-flow changes.
- `apps/web/src/components/PollCard.test.tsx`: poll option/action semantics and new structural hooks.
- `apps/web/src/components/AsyncState.tsx`: consistent status-panel markup.
- `apps/web/src/features/feed/FeedPage.tsx`: feed header, filter tabs, composer, and contextual rail.
- `apps/web/src/features/feed/FeedPage.test.tsx`: feed structure and preserved sorting/discovery behaviour.
- `apps/web/src/features/auth/AuthPage.tsx`: focused authentication composition using the retained logo.
- `apps/web/src/features/auth/AuthPage.test.tsx`: auth hierarchy and removal of decorative showcase content.
- `apps/web/src/features/search/SearchPage.tsx`: search header, controls, and result sections.
- `apps/web/src/features/search/SearchPage.test.tsx`: search structural hooks with existing request behaviour.
- `apps/web/src/features/profiles/MyProfilePage.tsx`: private profile header and form sections.
- `apps/web/src/features/profiles/PublicProfilePage.tsx`: public profile header, stats, follow action, and poll section.
- `apps/web/src/features/profiles/ProfilePage.test.tsx`: profile structural assertions and preserved mutations.
- `apps/web/src/features/polls/CreatePollPage.tsx`: focused poll editor structure.
- `apps/web/src/features/polls/CreatePollPage.test.tsx`: form grouping and existing submit behaviour.
- `apps/web/src/features/comments/PollDetailPage.tsx`: poll-detail page wrapper and comments region.
- `apps/web/src/features/comments/CommentForm.tsx`: comment composer hooks.
- `apps/web/src/features/comments/CommentList.tsx`: comment-list/card hooks.
- `apps/web/src/styles/global.css`: complete token, component, page, and responsive visual system.

---

### Task 1: Rebuild the application shell

**Files:**
- Modify: `apps/web/src/components/AppLayout.test.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `useSession()` and the existing `Avatar` and `MaterialIcon` components.
- Produces: `.app-shell`, `.app-header`, `.app-sidebar`, `.app-content`, `.nav-link`, `.nav-link--active`, `.button`, `.button--primary`, and `.button--quiet` styling hooks used by all later tasks.

- [ ] **Step 1: Write failing shell structure tests**

Extend `AppLayout.test.tsx` with location-aware active navigation and retained-logo assertions:

```tsx
test('renders the documentation-style shell with one retained branding image', () => {
  const { container } = renderLayout();
  expect(container.querySelector('.app-shell')).toBeInTheDocument();
  expect(container.querySelectorAll('img[src^="/branding/"]')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Yaskapp' }))
    .toContainElement(container.querySelector('img[src="/branding/yaskapp_logo.png"]'));
  expect(screen.getByRole('navigation', { name: 'Primary navigation' }))
    .toHaveClass('app-sidebar-navigation');
});
```

Update `renderLayout(initialEntry = '/')` to pass `initialEntries={[initialEntry]}`, then add:

```tsx
test('marks only the current primary destination', () => {
  renderLayout('/search');
  const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
  expect(within(navigation).getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
  expect(within(navigation).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
});
```

- [ ] **Step 2: Run the shell tests and confirm the new assertions fail**

Run:

```powershell
npm --workspace apps/web test -- --run src/components/AppLayout.test.tsx
```

Expected: FAIL because `app-sidebar-navigation` and route-aware `aria-current` are absent.

- [ ] **Step 3: Implement route-aware shell markup**

In `AppLayout.tsx`, use `NavLink` for primary destinations and a shared callback:

```tsx
const navigationClassName = ({ isActive }: { isActive: boolean }) =>
  `nav-link${isActive ? ' nav-link--active' : ''}`;

<nav className="app-sidebar-navigation" aria-label="Primary navigation">
  <NavLink end className={navigationClassName} to="/"><MaterialIcon name="home_outlined" /> Home</NavLink>
  <NavLink className={navigationClassName} to="/search"><MaterialIcon name="search" /> Explore</NavLink>
  <NavLink className={navigationClassName} to="/search?view=notifications"><MaterialIcon name="notifications_none" /> Notifications</NavLink>
  <NavLink className={navigationClassName} to="/me"><Avatar name={user.profile.displayName} src={user.profile.avatarUrl} size={22} /> Profile</NavLink>
</nav>
```

Keep the existing logo path and handlers. Remove notification dots and old sidebar/footer presentation hooks. Use `.button.button--primary` for create/register and `.button.button--quiet` for sign-out where appropriate.

- [ ] **Step 4: Replace the stylesheet foundation and shell rules**

Start `global.css` with the neutral system and shared primitives:

```css
:root {
  color-scheme: light;
  --canvas: #f7f7f5;
  --surface: #ffffff;
  --surface-subtle: #f3f3f1;
  --text: #1e1e1e;
  --muted: #6b6b67;
  --border: #deded9;
  --border-strong: #bdbdb7;
  --accent: #3451b2;
  --accent-hover: #2b4598;
  --danger: #b42318;
  --radius-sm: 6px;
  --radius-md: 10px;
  --focus: 0 0 0 3px rgb(52 81 178 / 24%);
}

* { box-sizing: border-box; }
body { min-width: 320px; min-height: 100vh; margin: 0; background: var(--canvas); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.app-shell { min-height: 100vh; }
.app-header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; min-height: 64px; border-bottom: 1px solid var(--border); background: rgb(255 255 255 / 94%); }
.app-brand img { display: block; width: 104px; height: auto; }
.button { min-height: 40px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-weight: 650; }
.button--primary { border-color: var(--accent); background: var(--accent); color: #fff; }
.button--quiet { border-color: transparent; background: transparent; color: var(--muted); }
```

Add a `1024px` desktop grid with a 248px sticky left rail and one flexible content column. Add a mobile layout in which the navigation becomes a horizontal scroll-safe row and the header search wraps below the logo/actions.

- [ ] **Step 5: Run shell tests, typecheck, and stylesheet checks**

Run:

```powershell
npm --workspace apps/web test -- --run src/components/AppLayout.test.tsx
npm --workspace apps/web run typecheck
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 6: Commit the shell redesign**

```powershell
git add apps/web/src/components/AppLayout.tsx apps/web/src/components/AppLayout.test.tsx apps/web/src/styles/global.css
git commit -m "feat(web): redesign application shell"
```

---

### Task 2: Redesign the feed and reusable poll card

**Files:**
- Modify: `apps/web/src/features/feed/FeedPage.test.tsx`
- Modify: `apps/web/src/features/feed/FeedPage.tsx`
- Modify: `apps/web/src/components/PollCard.test.tsx`
- Modify: `apps/web/src/components/PollCard.tsx`
- Modify: `apps/web/src/components/AsyncState.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: shell tokens and button primitives from Task 1; current `Poll`, `usePollMutations()`, and `AsyncStateProps` interfaces.
- Produces: `.page-heading`, `.feed-toolbar`, `.segmented-tabs`, `.poll-card`, `.poll-option`, `.poll-actions`, `.context-panel`, and `.async-state` patterns reused by detail/profile/search pages.

- [ ] **Step 1: Write failing feed and poll structure tests**

Add to `FeedPage.test.tsx`:

```tsx
test('uses an editorial feed heading and restrained contextual rail', async () => {
  server.use(http.get('/polls', () => HttpResponse.json({ items: [poll] })));
  const { container } = renderFeed();
  expect(await screen.findByRole('heading', { name: 'Your feed' })).toBeInTheDocument();
  expect(container.querySelector('.feed-toolbar')).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Discover content' })).toHaveClass('context-rail');
  expect(container.querySelector('.discovery-cta')).not.toBeInTheDocument();
});
```

Add to `PollCard.test.tsx` using its existing poll fixture:

```tsx
test('exposes the new poll metadata, option, and action groups', () => {
  const { container } = renderPollCard();
  expect(container.querySelector('.poll-card__meta')).toBeInTheDocument();
  expect(container.querySelector('.poll-card__options')).toBeInTheDocument();
  expect(container.querySelector('.poll-card__actions')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused tests and confirm they fail**

```powershell
npm --workspace apps/web test -- --run src/features/feed/FeedPage.test.tsx src/components/PollCard.test.tsx
```

Expected: FAIL on the new heading and class hooks.

- [ ] **Step 3: Implement the feed hierarchy**

In `FeedPage.tsx`, add a visible heading and merge the composer/tabs into a clear header:

```tsx
<section className="feed-main" aria-label="Poll feed">
  <header className="page-heading feed-heading">
    <div><p className="eyebrow">Latest conversations</p><h1>Your feed</h1></div>
    <Link className="button button--primary" to="/polls/new"><MaterialIcon name="add" /> Create poll</Link>
  </header>
  <section className="feed-toolbar" aria-label="Create and filter polls">
    <Link className="poll-composer" to="/polls/new">What's on your mind today?</Link>
    <div className="segmented-tabs" aria-label="Feed order">
      <button type="button" aria-pressed={sort === 'for-you'} onClick={() => setSort('for-you')}>For you</button>
      <button type="button" aria-pressed={sort === 'following'} onClick={() => setSort('following')}>Following</button>
      <button type="button" aria-pressed={sort === 'trending'} onClick={() => setSort('trending')}>Trending</button>
    </div>
  </section>
</section>
```

Keep the existing three sort values and query keys. Remove the decorative CTA and emoji artwork. Keep trends and suggested users as two `.context-panel` sections inside `.context-rail`, preserving the trend toggle and all existing labels needed by tests.

- [ ] **Step 4: Implement the poll-card hierarchy without changing behaviour**

Rename/add class hooks in `PollCard.tsx`:

```text
poll-card-header  -> poll-card__meta
poll-card h2      -> poll-card__question
poll-options      -> poll-card__options
poll-option label -> poll-option__content
poll-actions      -> poll-card__actions
```

Keep radio inputs, explicit vote buttons, progressbar roles, accessible descriptions, like/comment handlers, confirmation prompts, and all mutation callbacks unchanged. Add `className="poll-card__image"` to optional poll media. Add `className="async-state async-state--${state}"` to every `AsyncState` root while preserving roles and text.

- [ ] **Step 5: Add feed, poll, contextual rail, and status styles**

Append CSS using flat, rule-based surfaces:

```css
.feed-page { width: min(100%, 1120px); margin: 0 auto; display: grid; gap: 32px; }
.page-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border); }
.eyebrow { margin: 0 0 6px; color: var(--muted); font-size: .75rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.segmented-tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--border); }
.segmented-tabs button { min-height: 44px; padding: 0; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); }
.segmented-tabs button[aria-pressed="true"] { border-color: var(--accent); color: var(--text); }
.poll-card { padding: 24px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.poll-option { position: relative; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
.poll-result-bar { height: 4px; background: var(--surface-subtle); }
.poll-result-bar span { display: block; height: 100%; background: var(--accent); }
.context-panel { padding: 20px 0; border-top: 1px solid var(--border); }
.async-state { padding: 24px; border: 1px dashed var(--border-strong); border-radius: var(--radius-sm); color: var(--muted); }
```

Use a 760px poll column plus a 280px rail only at wide desktop widths; hide the rail below 1280px. Ensure long poll text wraps and images use `max-width: 100%` with an editorial 3:2 crop.

- [ ] **Step 6: Run focused and regression tests**

```powershell
npm --workspace apps/web test -- --run src/features/feed/FeedPage.test.tsx src/components/PollCard.test.tsx
npm --workspace apps/web test -- --run
npm --workspace apps/web run typecheck
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the feed and poll redesign**

```powershell
git add apps/web/src/features/feed/FeedPage.tsx apps/web/src/features/feed/FeedPage.test.tsx apps/web/src/components/PollCard.tsx apps/web/src/components/PollCard.test.tsx apps/web/src/components/AsyncState.tsx apps/web/src/styles/global.css
git commit -m "feat(web): redesign feed and poll cards"
```

---

### Task 3: Redesign authentication and editor forms

**Files:**
- Modify: `apps/web/src/features/auth/AuthPage.test.tsx`
- Modify: `apps/web/src/features/auth/AuthPage.tsx`
- Modify: `apps/web/src/features/polls/CreatePollPage.test.tsx`
- Modify: `apps/web/src/features/polls/CreatePollPage.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: Task 1 tokens/buttons and the existing auth/create mutation contracts.
- Produces: `.focused-page`, `.form-panel`, `.field`, `.field-row`, `.form-actions`, and `.inline-alert` patterns reused by profile and comment forms.

- [ ] **Step 1: Write failing form composition tests**

Add to `AuthPage.test.tsx`:

```tsx
test('renders a focused auth panel without the old decorative showcase', () => {
  const { container } = renderAuth(<AuthPage mode="login" />);
  expect(container.querySelector('.auth-panel')).toBeInTheDocument();
  expect(container.querySelector('.auth-showcase')).not.toBeInTheDocument();
  expect(container.querySelectorAll('img[src^="/branding/"]')).toHaveLength(1);
});
```

Add to `CreatePollPage.test.tsx` after rendering:

```tsx
expect(screen.getByRole('main')).toHaveClass('focused-page');
expect(screen.getByRole('form', { name: 'Create a poll' })).toHaveClass('form-panel');
expect(screen.getByRole('group', { name: 'Options' })).toHaveClass('poll-editor__options');
```

- [ ] **Step 2: Run focused tests and confirm they fail**

```powershell
npm --workspace apps/web test -- --run src/features/auth/AuthPage.test.tsx src/features/polls/CreatePollPage.test.tsx
```

Expected: FAIL because the new focused form hooks do not exist and the showcase still renders.

- [ ] **Step 3: Simplify authentication markup**

Replace the decorative showcase in `AuthPage.tsx` with:

```tsx
<main id="main-content" className="auth-page focused-page">
  <section className="auth-panel form-panel" aria-labelledby="auth-title">
    <Link className="auth-brand" to="/" aria-label="Yask home">
      <img src="/branding/yaskapp_logo.png" alt="" />
    </Link>
    <header className="form-panel__header">
      <p className="eyebrow">Welcome to Yask</p>
      <h1 id="auth-title">{isRegistration ? 'Create your account' : 'Sign in'}</h1>
    </header>
    <form onSubmit={(event) => void handleSubmit(event)}>
      {isRegistration ? <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required /></div> : null}
      {isRegistration ? <div className="field"><label htmlFor="username">Username</label><input id="username" name="username" autoComplete="username" required /></div> : <div className="field"><label htmlFor="login">Login</label><input id="login" name="login" autoComplete="username" required /></div>}
      <div className="field"><label htmlFor="password">Password</label><div className="password-input-wrap"><input id="password" name="password" type={passwordVisible ? 'text' : 'password'} autoComplete={isRegistration ? 'new-password' : 'current-password'} required /><button className="button button--quiet" type="button" aria-label={passwordVisible ? 'Hide password' : 'Show password'} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? 'Hide' : 'Show'}</button></div></div>
      {isRegistration ? <div className="field"><label htmlFor="countryCode">Country code</label><input id="countryCode" name="countryCode" autoComplete="country" required /></div> : null}
      {isRegistration ? <div className="field"><label htmlFor="displayName">Display name (optional)</label><input id="displayName" name="displayName" autoComplete="name" /></div> : null}
      {serverError ? <p className="inline-alert" role="alert">{serverError}</p> : null}
      <div className="form-actions"><button className="button button--primary" type="submit" disabled={pending}>{pending ? 'Submitting…' : isRegistration ? 'Create account' : 'Sign in'}</button></div>
    </form>
  </section>
</main>
```

Wrap each label/input pair in `.field`, keep all input names, password visibility, pending state, country selection, destination safety, and error text unchanged. Use button primitives for submit and visibility controls.

- [ ] **Step 4: Structure the poll editor**

Give the main element `.focused-page poll-editor`, the form `className="form-panel" aria-label="Create a poll"`, each label/control pair `.field`, options fieldset `.poll-editor__options`, option row `.field-row`, and validation messages `.inline-alert`. Keep `minimumOptions`, `maximumOptions`, `validate`, file acceptance, checkbox, cache update, and navigation unchanged.

- [ ] **Step 5: Add focused-form styles**

```css
.focused-page { width: min(100%, 720px); margin: 0 auto; }
.auth-page { min-height: 100vh; display: grid; place-items: center; padding: 32px 16px; }
.auth-panel { width: min(100%, 440px); }
.form-panel { padding: clamp(24px, 5vw, 40px); border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
.field { display: grid; gap: 8px; margin-top: 20px; font-weight: 650; }
.field input, .field textarea, .field select { width: 100%; min-height: 44px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
.form-actions { display: flex; gap: 12px; align-items: center; margin-top: 24px; }
.inline-alert { padding: 12px 14px; border-left: 3px solid var(--danger); background: #fff8f7; color: var(--danger); }
```

Ensure disabled controls retain readable contrast and textareas resize vertically only.

- [ ] **Step 6: Run focused and regression checks**

```powershell
npm --workspace apps/web test -- --run src/features/auth/AuthPage.test.tsx src/features/polls/CreatePollPage.test.tsx
npm --workspace apps/web test -- --run
npm --workspace apps/web run typecheck
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the form redesign**

```powershell
git add apps/web/src/features/auth/AuthPage.tsx apps/web/src/features/auth/AuthPage.test.tsx apps/web/src/features/polls/CreatePollPage.tsx apps/web/src/features/polls/CreatePollPage.test.tsx apps/web/src/styles/global.css
git commit -m "feat(web): redesign authentication and poll editor"
```

---

### Task 4: Redesign search, profiles, poll detail, and comments

**Files:**
- Modify: `apps/web/src/features/search/SearchPage.test.tsx`
- Modify: `apps/web/src/features/search/SearchPage.tsx`
- Modify: `apps/web/src/features/profiles/ProfilePage.test.tsx`
- Modify: `apps/web/src/features/profiles/MyProfilePage.tsx`
- Modify: `apps/web/src/features/profiles/PublicProfilePage.tsx`
- Modify: `apps/web/src/features/comments/PollDetailPage.tsx`
- Modify: `apps/web/src/features/comments/CommentForm.tsx`
- Modify: `apps/web/src/features/comments/CommentList.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `.page-heading`, `.poll-card`, `.form-panel`, `.field`, `.button`, and `.async-state` patterns from Tasks 1–3 and all existing feature API functions.
- Produces: `.search-page`, `.profile-page`, `.profile-header`, `.profile-stats`, `.detail-page`, `.comments-section`, `.comment-form`, and `.comment-list` final page compositions.

- [ ] **Step 1: Write failing search and profile structure tests**

Add after the normal SearchPage render in `SearchPage.test.tsx`:

```tsx
expect(screen.getByRole('main')).toHaveClass('search-page');
expect(screen.getByRole('search')).toHaveClass('search-panel');
expect(screen.getByRole('tablist', { name: 'Search result type' })).toHaveClass('segmented-tabs');
```

Add to the public-profile test after `Author` loads:

```tsx
expect(screen.getByRole('main')).toHaveClass('profile-page');
expect(screen.getByLabelText('Profile statistics')).toHaveClass('profile-stats');
expect(screen.getByRole('region', { name: 'Polls by Author' })).toBeInTheDocument();
```

Add to the private-profile test after the display-name input loads:

```tsx
expect(screen.getByRole('form', { name: 'Edit profile' })).toHaveClass('form-panel');
```

- [ ] **Step 2: Run focused tests and confirm they fail**

```powershell
npm --workspace apps/web test -- --run src/features/search/SearchPage.test.tsx src/features/profiles/ProfilePage.test.tsx
```

Expected: FAIL on the new page, search, stats, region, and form hooks.

- [ ] **Step 3: Structure search without changing query behaviour**

Add `className="search-page"` to main, a `.page-heading`, `<form role="search" className="search-panel">`, and a `.segmented-tabs` tablist around the existing result-type controls. Wrap user results in `.people-results` and poll results in `.feed-list`. Preserve debounce timing, URL parameters, enabled conditions, request payloads, keyboard semantics, and all existing labels asserted by tests.

- [ ] **Step 4: Structure both profile pages**

For `PublicProfilePage.tsx`, use:

```tsx
<main id="main-content" className="profile-page">
  <section className="profile-header" aria-labelledby="profile-name">
    <Avatar name={name} src={profile.profile.avatarUrl} size={72} />
    <div><h1 id="profile-name">{name}</h1><p>@{profile.username}</p><p>{profile.profile.bio}</p></div>
    {user ? <button className="button" type="button" aria-pressed={profile.viewerIsFollowing} onClick={() => followMutation.mutate(profile.viewerIsFollowing)}>{profile.viewerIsFollowing ? 'Following' : 'Follow'}</button> : null}
  </section>
  <dl className="profile-stats" aria-label="Profile statistics">
    <div><dt>Polls</dt><dd>{profile.profile.pollsCount}</dd></div>
    <div><dt>Followers</dt><dd>{profile.profile.followersCount}</dd></div>
    <div><dt>Following</dt><dd>{profile.profile.followingCount}</dd></div>
  </dl>
  <section className="profile-polls" role="region" aria-label={`Polls by ${name}`}>
    <h2>Polls by {name}</h2>
    {pollsQuery.data?.map((poll) => <PollCard key={poll.id} poll={poll} viewerId={user?.id} />)}
  </section>
</main>
```

Use one `dt`/`dd` pair for polls, followers, and following. Keep the self-profile redirect, follow/unfollow mutation, login link, cached relationship replacement, and authored-poll query unchanged.

For `MyProfilePage.tsx`, add `.profile-page`, `.profile-header`, and `<form className="form-panel" aria-label="Edit profile">`. Apply Task 3 `.field` and `.form-actions` hooks while keeping changed-field calculation, avatar upload/delete, cache update, and pending/error behaviour unchanged.

- [ ] **Step 5: Structure poll detail and comments**

Use `.detail-page` on main and wrap comments in:

```tsx
<section className="comments-section" aria-labelledby="comments-heading">
  <header className="page-heading"><h1 id="comments-heading">Comments</h1></header>
  {user ? <CommentForm onSubmit={async (body) => { await createMutation.mutateAsync(body); }} /> : <Link to={`/login?next=${encodeURIComponent(`/polls/${pollId}`)}`}>Login</Link>}
  {pollId ? <CommentList pollId={pollId} currentUserId={user?.id} /> : null}
</section>
```

Add `.comment-form` and `.field` to `CommentForm.tsx`; add `.comment-list`, `.comment-card`, `.comment-card__author`, `.comment-card__body`, and `.comment-card__actions` in `CommentList.tsx`. Keep validation, loading/error/empty text, cache replacement, likes, delete confirmation, and invalidation behaviour unchanged.

- [ ] **Step 6: Add page-specific styles**

```css
.search-page, .profile-page, .detail-page { width: min(100%, 840px); margin: 0 auto; }
.search-panel { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; margin: 28px 0; }
.profile-header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 20px; align-items: start; padding-bottom: 28px; border-bottom: 1px solid var(--border); }
.profile-stats { display: flex; gap: 28px; margin: 0; padding: 20px 0; border-bottom: 1px solid var(--border); }
.profile-stats div { display: grid; gap: 2px; }
.profile-stats dt { color: var(--muted); font-size: .78rem; }
.profile-stats dd { order: -1; margin: 0; font-weight: 750; }
.comments-section { margin-top: 32px; padding-top: 28px; border-top: 1px solid var(--border); }
.comment-list { padding: 0; margin: 24px 0 0; list-style: none; }
.comment-card { padding: 20px 0; border-bottom: 1px solid var(--border); }
```

Add a mobile rule that stacks `.search-panel` and `.profile-header`, wraps `.profile-stats`, and keeps every action reachable.

- [ ] **Step 7: Run focused and full regression checks**

```powershell
npm --workspace apps/web test -- --run src/features/search/SearchPage.test.tsx src/features/profiles/ProfilePage.test.tsx
npm --workspace apps/web test -- --run
npm --workspace apps/web run typecheck
npm --workspace apps/web run lint
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 8: Commit the remaining page redesigns**

```powershell
git add apps/web/src/features/search apps/web/src/features/profiles apps/web/src/features/comments apps/web/src/styles/global.css
git commit -m "feat(web): redesign search profiles and comments"
```

---

### Task 5: Complete responsive polish and visual verification

**Files:**
- Modify: `apps/web/src/styles/global.css`
- Modify if selectors require correction: files changed in Tasks 1–4

**Interfaces:**
- Consumes: all page and component hooks from Tasks 1–4.
- Produces: final responsive, focus, overflow, and reduced-motion behaviour for the entire web client.

- [ ] **Step 1: Add CSS invariants for responsive and motion behaviour**

Ensure `global.css` includes:

```css
img { max-width: 100%; }
button, input, select, textarea { font: inherit; }
button, a, input, select, textarea { -webkit-tap-highlight-color: transparent; }
@media (max-width: 700px) {
  .app-content { padding: 24px 16px 80px; }
  .page-heading { align-items: start; flex-direction: column; }
  .poll-card { padding: 18px; }
  .poll-card__actions, .form-actions { align-items: stretch; flex-direction: column; }
  .poll-card__actions .button, .form-actions .button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
```

Search the stylesheet for forbidden legacy visual treatments and remove them:

```powershell
rg -n "gradient|people-art|showcase-card|branding/(?!yaskapp_logo)" apps/web/src --pcre2
```

Expected: no rendered legacy decoration or non-logo branding asset reference remains.

- [ ] **Step 2: Run the complete automated verification suite**

```powershell
npm --workspace apps/web test -- --run
npm --workspace apps/web run typecheck
npm --workspace apps/web run lint
npm --workspace apps/web run build
git diff --check
```

Expected: tests, typecheck, lint, build, and whitespace check all PASS.

- [ ] **Step 3: Start the web client with its normal Vite flow**

```powershell
npm --workspace apps/web run dev -- --host 127.0.0.1
```

Expected: Vite reports a local preview URL and remains running for inspection.

- [ ] **Step 4: Inspect meaningful desktop layouts**

At approximately 1440×1000, inspect the anonymous feed and login page. If an existing local authenticated session or test account is available, also inspect the authenticated feed, search, poll creation, profile, public profile, and poll detail pages. Verify:

```text
logo is the only retained branding image
header and left rail remain aligned while scrolling
poll column stays readable and context rail never crowds it
all cards are flat, neutral, and consistently bordered
forms share one field and button language
focus indicators are visible on links, tabs, fields, and actions
loading/error/empty states fit the new visual system
```

- [ ] **Step 5: Inspect mobile layouts**

At 390×844 and 320×720, inspect feed, authentication, search, poll creation, profile, and poll detail routes. Verify:

```text
no horizontal page overflow
navigation remains usable without hiding primary destinations
header search wraps cleanly
poll questions and option text wrap without clipping
form fields and actions fit the viewport
comments and profile stats reflow into readable stacks
```

Fix any observed issue in the owning component or CSS rule, then repeat Steps 2, 4, and 5.

- [ ] **Step 6: Commit responsive and visual polish**

```powershell
git add apps/web
git commit -m "fix(web): polish responsive documentation-style UI"
```

- [ ] **Step 7: Confirm the final repository state**

```powershell
git status --short
git log -5 --oneline
```

Expected: no uncommitted files from this plan; recent commits show the shell, feed, forms, remaining pages, and responsive polish tasks.
