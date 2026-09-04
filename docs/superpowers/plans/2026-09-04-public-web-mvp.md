# Public Web MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a standalone, responsive public browser client for Yaskapp's existing authentication, poll, comment, profile, and search APIs.

**Architecture:** Add a Vite React TypeScript workspace at `apps/web`. A typed API boundary is the sole caller of `fetch`; TanStack Query manages all remote data and mutations, while a session provider holds the current user and a token stored only in `sessionStorage`. Nginx serves the built SPA and Caddy routes a separate public web hostname to it while proxying the existing API paths.

**Tech Stack:** Node.js 20+, React 19, TypeScript, Vite, React Router, TanStack Query, Vitest, Testing Library, MSW, nginx, Caddy, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-04-public-web-mvp-design.md`

## Global Constraints

- Keep `apps/moderation-web` unchanged except for shared deployment routing that must continue to serve it at its current host and `/admin` development path.
- Consume the existing API contract; do not add or change backend endpoints in this MVP.
- Use `VITE_API_BASE_URL` when supplied and same-origin relative API paths otherwise.
- Store a JWT only in `sessionStorage`; clear it and the authenticated query cache on logout or any `401` response.
- Do not set `Content-Type` on `FormData` uploads; the browser must add the multipart boundary.
- Use semantic HTML, visible focus states, labelled fields, keyboard-operable controls, and user-visible request errors.
- Keep Node.js compatibility at `>=20` and use npm workspaces and the committed root lockfile.

---

## Planned file structure

| File | Responsibility |
| --- | --- |
| `package.json` | Include `apps/*` in root workspaces and expose web scripts. |
| `apps/web/package.json` | Browser-client dependencies and scripts. |
| `apps/web/vite.config.ts` | Vite, React, Vitest, and local API proxy configuration. |
| `apps/web/src/api/client.ts` | Typed `fetch` wrapper, API errors, bearer-token injection, multipart handling. |
| `apps/web/src/api/models.ts` | API response models and JSON decoders shared by feature API modules. |
| `apps/web/src/api/{auth,polls,profiles,search}.ts` | Endpoint-specific functions with no UI state. |
| `apps/web/src/app/{App,router,query-client,session-provider}.tsx` | Providers, routes, protected-route guards, session bootstrap. |
| `apps/web/src/features/*` | Page-level feature components, hooks, and focused tests. |
| `apps/web/src/components/*` | Reusable controls, app layout, error/loading states, poll card, and avatar. |
| `apps/web/src/styles/global.css` | Responsive design tokens, resets, layout, focus, and component styles. |
| `apps/web/Dockerfile`, `apps/web/nginx.conf` | Static production build and SPA history fallback. |
| `infra/docker/docker-compose.staging.yml` | `web` service and Caddy dependency. |
| `infra/docker/Caddyfile` | `WEB_HOST` host block routing browser assets and existing API endpoints. |
| `services/api/.env.staging.example` | Public web host and CORS origin documentation. |
| `.github/workflows/ci.yml` | Web typecheck, tests, and production build. |

---

### Task 1: Create the web workspace and a testable application shell

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/App.test.tsx`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/styles/global.css`

**Interfaces:**
- Produces `App(): JSX.Element`, mounted by `src/main.tsx`.
- Produces npm workspace `@yaskapp/web` with `dev`, `build`, `typecheck`, `test`, and `lint` scripts.
- Later tasks mount feature routes inside `App` and use the test setup's `renderWithProviders` helper.

- [ ] **Step 1: Write the failing shell test**

Create `apps/web/src/app/App.test.tsx` before the application component:

```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the public Yaskapp application shell', () => {
  render(<App />);
  expect(screen.getByRole('link', { name: 'Yaskapp' })).toHaveAttribute('href', '/');
});
```

- [ ] **Step 2: Install the workspace and test dependencies, then verify the test fails**

Run:

```powershell
npm install -w @yaskapp/web react react-dom react-router-dom @tanstack/react-query
npm install -D -w @yaskapp/web @types/react @types/react-dom @vitejs/plugin-react vite typescript vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh msw
npm run test -w @yaskapp/web -- --run src/app/App.test.tsx
```

Expected: the test command fails because `src/app/App.tsx` is not present.

- [ ] **Step 3: Add the smallest runnable Vite/React setup**

Update the root workspace list to include `"apps/*"`. Define `@yaskapp/web` as a private ESM workspace with these scripts:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "typecheck": "tsc -b --pretty false",
  "test": "vitest",
  "lint": "eslint src --max-warnings 0"
}
```

Configure Vitest with `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, and a `/api` development proxy that targets `VITE_API_PROXY_TARGET ?? 'http://localhost:3000'`. Create `App` with a single accessible brand link and `main.tsx` that mounts it under `React.StrictMode`. In the setup file import `@testing-library/jest-dom/vitest`.

- [ ] **Step 4: Add a responsive global baseline**

Define CSS custom properties for the existing product palette (`--color-brand: #566A9D`, `--color-accent: #FA7F2D`, neutral page/surface/text colours), border radii, shadows, a 72px desktop content header, `box-sizing: border-box`, and a `:focus-visible` outline. Set `body` to a system sans-serif stack and a light neutral background. Do not create feature-specific selectors in this task.

- [ ] **Step 5: Run workspace checks**

Run:

```powershell
npm run typecheck -w @yaskapp/web
npm run test -w @yaskapp/web -- --run src/app/App.test.tsx
npm run build -w @yaskapp/web
```

Expected: all commands exit `0`; the test finds the `Yaskapp` link.

- [ ] **Step 6: Commit the scaffold**

```powershell
git add package.json package-lock.json apps/web
git commit -m "feat(web): scaffold public browser client"
```

### Task 2: Establish typed API and session boundaries

**Files:**
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/models.ts`
- Create: `apps/web/src/api/auth.ts`
- Create: `apps/web/src/api/polls.ts`
- Create: `apps/web/src/api/profiles.ts`
- Create: `apps/web/src/api/search.ts`
- Create: `apps/web/src/api/client.test.ts`
- Create: `apps/web/src/app/query-client.ts`
- Create: `apps/web/src/app/session-provider.tsx`
- Create: `apps/web/src/app/session-provider.test.tsx`

**Interfaces:**
- Produces `ApiClient` with `get<T>(path)`, `send<T>(path, init)`, `setAccessToken(token)`, and `clearAccessToken()`.
- Produces `ApiError` with `status: number`, `code?: string`, and `message: string`.
- Produces `SessionProvider`, `useSession()`, and `SessionState` with `{ status, user, signIn, register, signOut }`.
- Consumes `AuthUser`, `Poll`, `PollComment`, and `PublicProfile` decoders from `models.ts`.

- [ ] **Step 1: Write failing API-boundary tests**

Use MSW in `client.test.ts` to assert that a JSON request sends a bearer token, decodes a normal `{ poll }` response, and maps this error response to `ApiError`:

```ts
http.post('/polls', () => HttpResponse.json(
  { error: 'poll_closed', message: 'This poll is closed.' },
  { status: 422 },
));

await expect(polls.vote('poll-1', 'option-1')).rejects.toMatchObject({
  status: 422,
  code: 'poll_closed',
  message: 'This poll is closed.',
});
```

In `session-provider.test.tsx`, seed `sessionStorage` with a token, mock `/auth/me`, render a probe using `useSession`, and assert that it reaches `{ status: 'authenticated', user }`. Add a second test returning `401` and assert the token is removed and state becomes `anonymous`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/api/client.test.ts src/app/session-provider.test.tsx
```

Expected: FAIL because the API and session modules do not exist.

- [ ] **Step 3: Implement JSON model decoding and the single fetch wrapper**

Create exact TypeScript interfaces based on the mobile clients: `AuthUser`, `AuthUserProfile`, `PollAuthor`, `PollOption`, `Poll`, `PollComment`, `PublicProfile`, `FollowRelationship`, and `SearchResult`. Decode unknown JSON at the API boundary and throw `ApiError(502, 'invalid_response', ...)` for malformed server payloads.

Implement `ApiClient` so it prefixes `import.meta.env.VITE_API_BASE_URL ?? ''`, adds `authorization` only if a token exists, adds `content-type: application/json` only for JSON bodies, and handles `204` without attempting JSON parsing. Add a registered `onUnauthorized` callback called exactly once per failing request when status is `401`.

- [ ] **Step 4: Implement endpoint modules and session lifecycle**

Expose these endpoint functions with these signatures:

```ts
login(input: { login: string; password: string }): Promise<AuthSession>
register(input: { email: string; username: string; password: string; countryCode: string; displayName?: string }): Promise<AuthSession>
listPolls(input?: { sort?: 'newest' | 'popular'; limit?: number }): Promise<Poll[]>
createPoll(input: { question: string; options: string[]; allowVoteCancellation: boolean; image?: File }): Promise<Poll>
vote(pollId: string, optionId: string): Promise<Poll>
listComments(pollId: string): Promise<PollComment[]>
getPublicProfile(userId: string): Promise<PublicProfile>
search(input: { q: string; type: 'all' | 'polls' | 'users'; sort: 'relevance' | 'newest' | 'popular' }): Promise<SearchResult>
```

`SessionProvider` must read `yaskapp.access-token` from `sessionStorage`, call `/auth/me`, and use `QueryClient.clear()` plus token removal for `signOut` and API `401` events. It must not persist any credential to `localStorage`.

- [ ] **Step 5: Run API/session tests and typecheck**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/api/client.test.ts src/app/session-provider.test.tsx
npm run typecheck -w @yaskapp/web
```

Expected: all tests pass; TypeScript accepts all endpoint signatures.

- [ ] **Step 6: Commit the shared client layer**

```powershell
git add apps/web/src/api apps/web/src/app/query-client.ts apps/web/src/app/session-provider.tsx apps/web/src/app/session-provider.test.tsx
git commit -m "feat(web): add API client and browser session"
```

### Task 3: Build authentication, routes, navigation, and public feed read path

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/components/AppLayout.tsx`
- Create: `apps/web/src/components/AsyncState.tsx`
- Create: `apps/web/src/components/Avatar.tsx`
- Create: `apps/web/src/components/PollCard.tsx`
- Create: `apps/web/src/features/auth/AuthPage.tsx`
- Create: `apps/web/src/features/auth/AuthPage.test.tsx`
- Create: `apps/web/src/features/feed/FeedPage.tsx`
- Create: `apps/web/src/features/feed/FeedPage.test.tsx`

**Interfaces:**
- Consumes `useSession`, `listPolls`, `Poll`, and `ApiError` from Task 2.
- Produces routes `/`, `/login`, and `/register`, plus reusable `PollCard({ poll, viewerId, onVote, onLike, onOpenComments })`.
- Later tasks extend `PollCard` without changing its read-only rendering contract.

- [ ] **Step 1: Write failing route and feed tests**

In `AuthPage.test.tsx`, mock a successful login and assert that submitting labelled `Login` and `Password` controls calls `signIn` and navigates to `/`.

In `FeedPage.test.tsx`, mock `GET /polls?limit=20` with a poll and assert the visible question and `Vote` button. Add a failed-load case and assert a `Retry` button reissues the request.

- [ ] **Step 2: Verify the page tests fail**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/features/auth/AuthPage.test.tsx src/features/feed/FeedPage.test.tsx
```

Expected: FAIL because no router or feature pages exist.

- [ ] **Step 3: Implement app providers, route guards, and layout**

Wrap `SessionProvider`, `QueryClientProvider`, and `RouterProvider` in `App`. The router must expose `/`, `/login`, and `/register`; redirect authenticated visitors away from auth pages and redirect anonymous visitors who reach later protected routes to `/login?next=<pathname>`.

`AppLayout` renders an `<a aria-label="Yaskapp" href="/">` brand, Feed link, Search link when authenticated, a Create poll link when authenticated, and either Login/Register links or a keyboard-operable account menu with Profile and Sign out. Use `<main id="main-content">` and a skip link targeting it.

- [ ] **Step 4: Implement auth forms and the feed card**

Use native `<form>` elements, field-level text linked with `aria-describedby`, disabled submit controls while pending, and server errors in `role="alert"`. Registration fields are email, username, password, country code, and optional display name.

`FeedPage` uses `useQuery({ queryKey: ['polls', 'newest'], queryFn: () => listPolls() })`; it presents a loading state, error/retry state, an empty state, and cards. Provide a `Newest`/`Popular` control whose value becomes the query key and API `sort` parameter. The first release may show disabled mutation controls for anonymous visitors, linked to `/login` with an explanatory accessible label.

- [ ] **Step 5: Run tests, lint, and production build**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/features/auth/AuthPage.test.tsx src/features/feed/FeedPage.test.tsx
npm run lint -w @yaskapp/web
npm run build -w @yaskapp/web
```

Expected: all commands exit `0`; the built SPA includes public feed and auth routes.

- [ ] **Step 6: Commit navigation and read-only feed**

```powershell
git add apps/web/src/app apps/web/src/components apps/web/src/features/auth apps/web/src/features/feed
git commit -m "feat(web): add authentication and public feed"
```

### Task 4: Add poll creation, votes, likes, and optimistic cache updates

**Files:**
- Modify: `apps/web/src/api/polls.ts`
- Modify: `apps/web/src/components/PollCard.tsx`
- Create: `apps/web/src/features/polls/CreatePollPage.tsx`
- Create: `apps/web/src/features/polls/CreatePollPage.test.tsx`
- Create: `apps/web/src/features/polls/usePollMutations.ts`
- Create: `apps/web/src/features/polls/usePollMutations.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/features/feed/FeedPage.tsx`

**Interfaces:**
- Consumes poll API functions from Task 2 and `QueryClient` from Task 2.
- Produces protected `/polls/new` and `usePollMutations()` returning `{ vote, cancelVote, toggleLike, deletePoll, isPending }`.
- Produces `CreatePollPage` for the authenticated create flow.

- [ ] **Step 1: Write failing mutation and creation tests**

Write a hook test that starts with `['polls', 'newest']` data, mocks `POST /polls/poll-1/votes`, calls `vote({ pollId: 'poll-1', optionId: 'option-1' })`, and asserts the returned poll replaces the cached card.

In `CreatePollPage.test.tsx`, fill a question and two options, attach a PNG file, submit, and assert the request body is `FormData` containing `question`, JSON `options`, `allowVoteCancellation`, and `image`, with no manually supplied `content-type`. Assert success redirects to `/` and the created poll is at the start of the feed cache.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/features/polls/usePollMutations.test.tsx src/features/polls/CreatePollPage.test.tsx
```

Expected: FAIL because the feature modules and route are absent.

- [ ] **Step 3: Implement mutation hooks with precise cache behaviour**

`usePollMutations` must use `useMutation`. For a successful vote, cancellation, or like action, replace the matching poll in every cached `['polls', sort]` list and in `['poll', pollId]` if present. For deletion, remove it from those lists and navigate from its detail page to `/`. Do not optimistic-increment vote or like totals; use the authoritative returned `Poll` so failed mutations cannot leave incorrect totals.

Map `422/poll_closed` to “This poll is closed. Voting changes are no longer available.” and `vote_cancellation_not_allowed` to “The poll author does not allow vote cancellation.” Keep other `ApiError.message` values visible in an `aria-live="polite"` status region.

- [ ] **Step 4: Implement the poll creation form and interactive card controls**

Require a 1–280 character question and 2–6 non-empty, distinct options; enforce this both with form validation and disabled submission. Add/remove option buttons require at least two fields. Provide a labelled checkbox for `allowVoteCancellation` and an optional image input accepting `image/jpeg,image/png,image/webp`.

For authenticated cards, render one vote button per option; disable voting for an already selected option or a closed poll. After a vote, render results as option vote counts and percentages. Show Cancel vote only when the viewer has voted, cancellation is allowed, and the poll is open. Add a pressed-state Like button and an author-only Delete control that asks for confirmation before calling `deletePoll`.

- [ ] **Step 5: Run feature checks**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/features/polls/usePollMutations.test.tsx src/features/polls/CreatePollPage.test.tsx src/features/feed/FeedPage.test.tsx
npm run typecheck -w @yaskapp/web
npm run build -w @yaskapp/web
```

Expected: all pass; image uploads use browser-generated multipart headers.

- [ ] **Step 6: Commit poll write functionality**

```powershell
git add apps/web/src/api/polls.ts apps/web/src/app/router.tsx apps/web/src/components/PollCard.tsx apps/web/src/features/polls apps/web/src/features/feed/FeedPage.tsx
git commit -m "feat(web): add poll creation and interactions"
```

### Task 5: Deliver poll detail and comment interactions

**Files:**
- Modify: `apps/web/src/api/polls.ts`
- Create: `apps/web/src/features/comments/PollDetailPage.tsx`
- Create: `apps/web/src/features/comments/CommentList.tsx`
- Create: `apps/web/src/features/comments/CommentForm.tsx`
- Create: `apps/web/src/features/comments/PollDetailPage.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/components/PollCard.tsx`

**Interfaces:**
- Consumes `listComments`, `createComment`, `likeComment`, `unlikeComment`, and `deleteComment` from `api/polls.ts`.
- Produces public `/polls/:pollId` route and `CommentList({ pollId, currentUserId })`.
- Updates the `Poll` cache after comment creation to preserve the API's returned `commentsCount`.

- [ ] **Step 1: Write failing detail tests**

Mock a selected poll and comments. Assert `/polls/poll-1` shows the question, a `Comments` heading, each comment, and a label reading `Add a comment` for an authenticated session. Submit a comment and assert the new comment appears and the poll-card comment count becomes the returned count. Add an anonymous test that shows a Login link instead of a text area.

- [ ] **Step 2: Verify the detail tests fail**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/features/comments/PollDetailPage.test.tsx
```

Expected: FAIL because the detail route and components are absent.

- [ ] **Step 3: Implement the poll detail query and comments UI**

Add `getPoll(pollId: string): Promise<Poll>` using `GET /polls/:pollId`; cache it at `['poll', pollId]`. Query comments at `['comments', pollId]`. Render the reusable `PollCard` followed by a semantic comments section. `CommentForm` requires 1–1000 non-whitespace characters and leaves entered text intact on an API error.

On comment creation, insert the returned comment at the beginning of `['comments', pollId]` and replace the returned poll everywhere using the Task 4 cache helper. Comment likes replace only that comment. Show Delete only when `comment.author.id === currentUserId`; confirmation precedes the deletion, then remove that item and invalidate the poll query to refresh its count.

- [ ] **Step 4: Wire card navigation and verify the full comment flow**

Make the poll question/title an accessible link to `/polls/:pollId`; keep each action button separate so clicking Vote or Like does not navigate. Add `aria-pressed` for comment Like and `role="alert"` error text for failed write actions.

- [ ] **Step 5: Run tests and build**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/features/comments/PollDetailPage.test.tsx src/features/polls/usePollMutations.test.tsx
npm run lint -w @yaskapp/web
npm run build -w @yaskapp/web
```

Expected: all commands exit `0`; public users can read comments and authenticated users can complete every supported comment mutation.

- [ ] **Step 6: Commit comments**

```powershell
git add apps/web/src/api/polls.ts apps/web/src/app/router.tsx apps/web/src/components/PollCard.tsx apps/web/src/features/comments
git commit -m "feat(web): add poll detail and comments"
```

### Task 6: Add profiles, follow actions, profile editing, and search

**Files:**
- Modify: `apps/web/src/api/profiles.ts`
- Modify: `apps/web/src/api/search.ts`
- Create: `apps/web/src/features/profiles/PublicProfilePage.tsx`
- Create: `apps/web/src/features/profiles/MyProfilePage.tsx`
- Create: `apps/web/src/features/profiles/ProfilePage.test.tsx`
- Create: `apps/web/src/features/search/SearchPage.tsx`
- Create: `apps/web/src/features/search/SearchPage.test.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

**Interfaces:**
- Consumes Task 2 API client, Task 3 `PollCard`, and Task 4 poll mutation hooks.
- Produces public `/users/:userId`, protected `/me`, and protected `/search` routes.
- Produces `toggleFollow(userId: string): Promise<FollowRelationship>` and `updateMyProfile(input): Promise<AuthUser>`.

- [ ] **Step 1: Write failing profile and search tests**

`ProfilePage.test.tsx` must mock `GET /users/user-1`, `GET /users/user-1/polls`, and `POST /users/user-1/follow`; assert the profile information, authored poll, and `Follow` changing to `Following`. Add a `/me` test that uploads an avatar through `FormData`, submits display name/bio/country code changes, and updates the header's account label from the returned user.

`SearchPage.test.tsx` must fill a labelled search field with `climate`, select `Polls`, submit, and assert `GET /search?q=climate&type=polls&sort=relevance&limit=20` renders the returned poll result. Include the API `400` case and assert its message is shown without clearing the entered search term.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/features/profiles/ProfilePage.test.tsx src/features/search/SearchPage.test.tsx
```

Expected: FAIL because profile and search pages do not exist.

- [ ] **Step 3: Implement profile API calls and public profile page**

Add `getPublicProfile`, `listUserPolls`, `followUser`, `unfollowUser`, `getMyProfile`, `updateMyProfile`, `uploadAvatar`, and `deleteAvatar` API functions. Cache public profile data at `['profile', userId]` and authored polls at `['user-polls', userId]`. Follow/unfollow must replace `viewerIsFollowing` and `followersCount` from the returned relationship; it must not calculate counts locally.

Render avatar, display name, `@username`, bio, country, counts, follow control, and authored poll list. Guests see the follow action as a Login link; the current user's profile route redirects to `/me`.

- [ ] **Step 4: Implement current-profile editing and search**

`MyProfilePage` fetches `/auth/me` data from the session, offers labelled display name, bio, and country fields, and only submits changed values. Avatar upload/delete uses the profile API and updates both the session user and matching profile cache. Preserve form values on errors.

`SearchPage` is protected and only requests data after an explicit submit with a trimmed query length of at least two. It has labelled type (`all`, `polls`, `users`) and sort (`relevance`, `newest`, `popular`) selects. Render poll results using `PollCard`; render user results as links to `/users/:userId` with avatars and names.

- [ ] **Step 5: Run tests, lint, and build**

Run:

```powershell
npm run test -w @yaskapp/web -- --run src/features/profiles/ProfilePage.test.tsx src/features/search/SearchPage.test.tsx
npm run lint -w @yaskapp/web
npm run build -w @yaskapp/web
```

Expected: all commands exit `0`; no profile or search action uses an endpoint outside the existing API contract.

- [ ] **Step 6: Commit profile and search features**

```powershell
git add apps/web/src/api/profiles.ts apps/web/src/api/search.ts apps/web/src/app/router.tsx apps/web/src/components/AppLayout.tsx apps/web/src/features/profiles apps/web/src/features/search
git commit -m "feat(web): add profiles and search"
```

### Task 7: Package the SPA, route it in staging, and lock in verification

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/web/nginx.conf`
- Create: `apps/web/README.md`
- Create: `apps/web/test/smoke.test.mjs`
- Modify: `infra/docker/docker-compose.staging.yml`
- Modify: `infra/docker/Caddyfile`
- Modify: `infra/docker/test/ip-admin-routing.test.mjs`
- Modify: `services/api/.env.staging.example`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes the compiled `apps/web/dist` output from Task 1.
- Produces container `yaskapp-web:staging` on port 80 and `WEB_HOST` public routing.
- Preserves the present `MODERATION_HOST`, `/admin`, API domain, and IP development paths.

- [ ] **Step 1: Write failing deployment smoke tests**

Add assertions that the new Dockerfile builds from the repository root and serves `index.html`, nginx has `try_files $uri $uri/ /index.html;`, Compose defines `web` with `apps/web/Dockerfile`, Caddy routes `{$WEB_HOST:web-staging.example.com}` to `web:80`, and API paths `/auth/*`, `/polls*`, `/users*`, `/profiles*`, `/search*`, and `/media/*` are reverse-proxied to `api:3000` before the SPA catch-all.

Also retain the existing assertions proving IP `/admin` and moderation host routing do not regress.

- [ ] **Step 2: Run deployment tests to verify they fail**

Run:

```powershell
node --test infra/docker/test/ip-admin-routing.test.mjs
node --test apps/web/test/smoke.test.mjs
```

Expected: FAIL because the web container and host configuration are absent.

- [ ] **Step 3: Add static serving and staging routing**

Use this two-stage Dockerfile shape:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @yaskapp/web
COPY apps/web apps/web
RUN npm run build -w @yaskapp/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
```

Configure nginx to serve immutable hashed assets and return `index.html` for all non-file routes. Add a `web` service mirroring the existing `moderation-web` build/expose/dependency pattern. Add `WEB_HOST=web-staging.example.com` and include `https://web-staging.example.com` in the documented production `CORS_ORIGINS` value.

In Caddy, add the public web host block with the same security headers as the moderation host, API reverse-proxy handlers before `handle { reverse_proxy web:80 }`, `img-src 'self' data:`, and `connect-src 'self'`. Make `https` depend on both `web` and `moderation-web` services. Do not change the existing API-domain host behavior.

- [ ] **Step 4: Add CI and operator documentation**

Add a CI step after API checks that runs:

```bash
npm run typecheck -w @yaskapp/web
npm run lint -w @yaskapp/web
npm run test -w @yaskapp/web -- --run
npm run build -w @yaskapp/web
node --test infra/docker/test/ip-admin-routing.test.mjs apps/web/test/smoke.test.mjs
```

Document local startup (`npm run api:dev` plus `npm run dev -w @yaskapp/web`), `VITE_API_PROXY_TARGET`, `VITE_API_BASE_URL`, the web staging hostname, and the fact that browser tokens are session-only pending cookie authentication.

- [ ] **Step 5: Run the complete available verification suite**

Run:

```powershell
npm run typecheck -w @yaskapp/web
npm run lint -w @yaskapp/web
npm run test -w @yaskapp/web -- --run
npm run build -w @yaskapp/web
node --test infra/docker/test/ip-admin-routing.test.mjs apps/web/test/smoke.test.mjs
npm run api:typecheck
git diff --check
```

Expected: every command exits `0`; static routing preserves SPA deep links and no moderation routing test regresses.

- [ ] **Step 6: Commit delivery configuration**

```powershell
git add apps/web infra/docker services/api/.env.staging.example .github/workflows/ci.yml README.md package-lock.json
git commit -m "feat(web): deploy public browser client"
```

## Plan self-review

**Spec coverage:** Tasks 1–2 establish the React/Vite client, API boundary, and session storage; Tasks 3–5 implement authentication, feed, polling, and comments; Task 6 implements profiles, follows, avatar editing, and search; Task 7 covers nginx/Caddy/Docker/CI and records the current cookie-session, realtime, notifications, PWA, reports, and follower-list exclusions. Every page and mutation in the approved MVP scope maps to a task.

**Placeholder scan:** The plan contains no unfinished implementation markers or deferred unnamed actions. Each test and code step names the concrete files, commands, inputs, and expected results.

**Type consistency:** `ApiClient`, `ApiError`, session API, poll models, `PollCard`, and `usePollMutations` are defined before later tasks consume them. Query keys are consistently `['polls', sort]`, `['poll', pollId]`, `['comments', pollId]`, `['profile', userId]`, and `['user-polls', userId]`.
