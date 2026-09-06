# Public Web MVP — Task Breakdown

**Source plan:** `docs/superpowers/plans/2026-09-04-public-web-mvp.md`

**Goal:** Deliver the public Yaskapp browser client in independently reviewable, testable increments.

## Execution order

```text
Task 1 → Task 2 → Task 3 → Task 4 → ┬→ Task 5 →┐
                                      └→ Task 6 →┴→ Task 7
```

Tasks 5 and 6 can run in parallel after Task 4. All other tasks are sequential.

---

## Task 1 — Web workspace and application shell

**Purpose:** Create the `apps/web` Vite + React + TypeScript workspace and its testable baseline.

**Scope:**

- Add the `apps/*` npm workspace and `@yaskapp/web` scripts.
- Configure TypeScript, Vite, Vitest, Testing Library, ESLint, and the local `/api` proxy.
- Add `App`, `main.tsx`, test setup, `index.html`, and responsive global styles.

**Depends on:** none.

**Done when:** The application shell renders an accessible `Yaskapp` brand link, and typecheck, the shell test, and production build pass.

**Verification:**

```powershell
npm run typecheck -w @yaskapp/web
npm run test -w @yaskapp/web -- --run src/app/App.test.tsx
npm run build -w @yaskapp/web
```

## Task 2 — Typed API client and browser session

**Purpose:** Establish the sole browser API boundary and authentication-session lifecycle.

**Scope:**

- Add API models, decoders, `ApiClient`, endpoint modules, and API-error handling.
- Add TanStack Query setup and `SessionProvider` with `useSession()`.
- Keep JWTs only in `sessionStorage`; clear session and authenticated cache on logout or `401`.
- Support JSON and `FormData` request bodies without manually setting multipart headers.

**Depends on:** Task 1.

**Done when:** Endpoint signatures are type-safe, malformed responses are rejected at the API boundary, bearer tokens are attached correctly, and a `401` clears the session.

**Verification:**

```powershell
npm run test -w @yaskapp/web -- --run src/api/client.test.ts src/app/session-provider.test.tsx
npm run typecheck -w @yaskapp/web
```

## Task 3 — Authentication, routes, navigation, and public feed

**Purpose:** Deliver the usable public entry point: auth pages, route guards, layout, and read-only poll feed.

**Scope:**

- Add `/`, `/login`, and `/register` routes, auth redirects, and protected-route support for later tasks.
- Build the accessible application layout, skip link, account menu, reusable avatar, async states, and `PollCard`.
- Implement login and registration forms with field-level errors and pending states.
- Render newest/popular public poll feeds with loading, empty, retry, and anonymous interaction states.

**Depends on:** Tasks 1–2.

**Done when:** Visitors can browse the feed and authenticate, while authentication and feed errors remain visible and retryable.

**Verification:**

```powershell
npm run test -w @yaskapp/web -- --run src/features/auth/AuthPage.test.tsx src/features/feed/FeedPage.test.tsx
npm run lint -w @yaskapp/web
npm run build -w @yaskapp/web
```

## Task 4 — Poll creation and poll interactions

**Purpose:** Let authenticated users create, vote on, like, and delete polls with authoritative cache updates.

**Scope:**

- Add the protected `/polls/new` route and poll-creation form.
- Validate question, option count and uniqueness, vote cancellation, and optional image uploads.
- Add `usePollMutations()` for vote, vote cancellation, likes, and deletion.
- Update `PollCard` for authenticated actions, result display, accessible errors, and author-only deletion.
- Replace or remove matching poll cache entries using API responses; do not calculate vote or like totals locally.

**Depends on:** Tasks 1–3.

**Done when:** Created polls enter the feed, mutations update every relevant poll cache entry, and image uploads use browser-generated multipart boundaries.

**Verification:**

```powershell
npm run test -w @yaskapp/web -- --run src/features/polls/usePollMutations.test.tsx src/features/polls/CreatePollPage.test.tsx src/features/feed/FeedPage.test.tsx
npm run typecheck -w @yaskapp/web
npm run build -w @yaskapp/web
```

## Task 5 — Poll detail and comments

**Purpose:** Add poll-detail navigation and the complete supported comment flow.

**Scope:**

- Add public `/polls/:pollId` with a cached poll-detail query.
- Add semantic comment list and form.
- Support comment creation, likes, and author-only deletion with confirmation.
- Preserve returned comment counts in poll caches and form text after failed requests.
- Make poll titles accessible links without turning vote or like controls into navigation.

**Depends on:** Tasks 2–4.

**Done when:** Guests can read comments, authenticated users can perform comment mutations, and comment-count changes are reflected in poll cards.

**Verification:**

```powershell
npm run test -w @yaskapp/web -- --run src/features/comments/PollDetailPage.test.tsx src/features/polls/usePollMutations.test.tsx
npm run lint -w @yaskapp/web
npm run build -w @yaskapp/web
```

## Task 6 — Profiles, follows, profile editing, and search

**Purpose:** Add user discovery and account-management flows.

**Scope:**

- Add public `/users/:userId`, protected `/me`, and protected `/search` routes.
- Render public profiles, authored polls, and follow/unfollow controls.
- Enable editing display name, bio, country code, and avatar while keeping session and profile caches consistent.
- Implement explicit, validated search for polls and users.

**Depends on:** Tasks 2–4.

**Parallelism:** May start after Task 4 at the same time as Task 5.

**Done when:** Profile, follow, avatar, and search flows use only existing API endpoints and preserve entered form/search values after API errors.

**Verification:**

```powershell
npm run test -w @yaskapp/web -- --run src/features/profiles/ProfilePage.test.tsx src/features/search/SearchPage.test.tsx
npm run lint -w @yaskapp/web
npm run build -w @yaskapp/web
```

## Task 7 — Packaging, staging routing, CI, and documentation

**Purpose:** Make the SPA deployable and protect delivery with automated checks.

**Scope:**

- Add the web Dockerfile, nginx static serving, SPA history fallback, and smoke tests.
- Add a `web` service to staging Compose and a public `WEB_HOST` Caddy route.
- Proxy existing API paths before the SPA catch-all, preserve moderation routing, and document CORS.
- Add web checks to CI and document local startup and API environment variables.

**Depends on:** Tasks 1–6.

**Done when:** The production image serves deep links, API routes reach the backend, moderation routing remains unchanged, and web/API/deployment checks pass.

**Verification:**

```powershell
npm run typecheck -w @yaskapp/web
npm run lint -w @yaskapp/web
npm run test -w @yaskapp/web -- --run
npm run build -w @yaskapp/web
node --test infra/docker/test/ip-admin-routing.test.mjs apps/web/test/smoke.test.mjs
npm run api:typecheck
git diff --check
```

## Global constraints

- Do not change backend endpoints or the existing moderation web application, except for routing that preserves its current behavior.
- Use `VITE_API_BASE_URL` when supplied and same-origin API paths otherwise.
- Store browser credentials only in `sessionStorage`.
- Do not set `Content-Type` for `FormData` uploads.
- Keep UI controls semantic, labelled, keyboard-operable, visibly focusable, and able to display request errors.
- Keep Node.js compatibility at `>=20`, use npm workspaces, and commit the root lockfile.
