# Public Web MVP Design

## Goal and scope

Build a standalone public browser client for Yaskapp under `apps/web`. It
complements the Flutter mobile app; it does not replace it or change the
existing moderation workspace in `apps/moderation-web`.

The first release makes the core poll loop usable in a desktop or mobile
browser:

- register, sign in, restore an in-session login, and sign out;
- view the public poll feed and switch its supported sort order;
- create a poll (including its optional image), vote, cancel a permitted
  vote, like or unlike a poll, and delete the current user's own poll;
- open a poll's comments, add a comment, like or unlike a comment, and delete
  the current user's own comment;
- view a public profile, follow or unfollow it, and view that user's polls;
- view and edit the signed-in user's profile, including avatar upload;
- search polls and users while signed in.

Notifications, WebSocket live updates, reports, follower/following lists,
PWA installation, and server-side rendering are intentionally outside this
MVP. They can be introduced as subsequent vertical slices without changing
the app boundary.

## Architecture

Use React 19, TypeScript, Vite, and React Router in a new standalone project.
The source is organised by feature, with a small shared application layer:

```text
apps/web/
  src/
    api/              # typed fetch client and endpoint functions
    app/              # router, query client, providers and layout
    components/       # reusable accessible UI primitives
    features/
      auth/
      feed/
      polls/
      comments/
      profiles/
      search/
    styles/
    test/
  public/
  Dockerfile
```

TanStack Query owns remote data, request cancellation, cache invalidation,
and mutation states. Local component state is reserved for forms, menus, and
transient UI. No global state library is needed for this scope.

The client uses the deployed same-origin API by default. `VITE_API_BASE_URL`
provides an explicit base URL for local development or separately hosted API
environments. Vite's development server proxies API requests when that value
is not supplied, so the browser app does not depend on permissive CORS in
development.

## Pages and routes

| Route | Purpose | Access |
| --- | --- | --- |
| `/` | public feed; authenticated controls are progressively enabled | public |
| `/login`, `/register` | authentication forms | public-only |
| `/polls/new` | poll creation form | authenticated |
| `/polls/:pollId` | focused poll and its comments | public; mutations require login |
| `/users/:userId` | public profile and authored polls | public |
| `/me` | current profile and profile editor | authenticated |
| `/search` | poll and user search | authenticated |

The app shell has an accessible top navigation with the Yaskapp brand, feed,
search, create-poll action, and account menu. Its main content area is a
responsive single column with a readable maximum width. On narrow screens,
actions move into a compact header/menu rather than relying on hover.

Poll cards are the central reusable component. They show the author, question,
image when present, options, vote totals/results when the API permits them,
likes, comment count, and contextual actions. Opening a card navigates to the
poll route; mutations update both the detail and feed cache.

## API and data flow

The client consumes existing endpoints and does not add backend routes:

- Authentication: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`.
- Feed and polls: `GET/POST /polls`, `GET /polls/subscriptions`,
  `DELETE /polls/:pollId`, vote and like endpoints, and poll-image media.
- Comments: `GET/POST /polls/:pollId/comments`, plus comment like/delete
  endpoints.
- Profiles: public profile, authored polls, follow state, current profile,
  avatar upload/delete, and profile update endpoints.
- Search: authenticated `GET /search`.

The API client is the only code that calls `fetch`. It adds JSON headers when
appropriate, attaches `Authorization: Bearer <token>` only when a session
exists, parses the standard `{ error, message }` failures, and exposes a
single typed `ApiError` for UI error handling. Multipart avatar and poll-image
uploads deliberately omit `content-type` so the browser applies the boundary.

After a successful login or registration, the returned access token is kept in
`sessionStorage`, then validated with `/auth/me` on app start. This avoids a
long-lived browser token while allowing a reload in the same browser session.
On logout or a `401`, the token and authenticated query cache are cleared and
the user returns to the public experience. The production authentication
follow-up is an httpOnly Secure cookie session with CSRF protection; it will
replace this transport without changing feature APIs.

Mutations disable their initiating control until completion. On success they
update returned poll/comment data and invalidate the smallest relevant query
keys. On validation, conflict, closed-poll, permission, rate-limit, and
network failures the UI presents an actionable inline message or toast and
does not silently discard user form input.

## Visual and accessibility direction

The visual language follows the existing mobile application: a light neutral
background, white rounded surfaces, deep slate text, muted metadata, an
indigo brand colour, and orange for the primary create action. It is a browser
native responsive interpretation rather than a pixel-for-pixel Flutter copy.

Use semantic buttons, links, labels, headings, form error associations,
visible focus rings, sufficient colour contrast, keyboard-operable menus and
dialogs, and live regions for mutation feedback. Images have meaningful alt
text; purely decorative artwork is hidden from assistive technology.

## Build, deployment, and testing

`apps/web` has its own package manifest and scripts for `dev`, `build`,
`typecheck`, `test`, and `lint`. The root workspace configuration includes it
so CI can run these scripts alongside the API checks.

A multi-stage Dockerfile builds static assets and serves them from nginx. The
staging Compose/Caddy configuration gains a `web` service and public host.
Caddy serves the SPA fallback and reverse-proxies API and WebSocket paths to
the existing private API service. The moderation host and `/admin` route stay
separate.

Tests are layered:

1. unit tests for API error mapping and formatters;
2. component tests for authentication forms, poll card states, and critical
   mutations;
3. route-level integration tests using mocked API responses for the core user
   journey;
4. production build and Docker/Caddy configuration checks in CI.

## Delivery slices

Implementation proceeds in independently usable slices:

1. scaffold, API client, app shell, session handling, and authentication;
2. feed, poll card, voting, likes, and poll creation;
3. poll detail, comments, and deletion actions;
4. profiles, follows, avatar/profile editor, and search;
5. deployment integration, accessibility pass, and end-to-end verification.

Each slice remains releasable. Existing backend contracts are the source of
truth; a missing or incompatible client requirement is raised before backend
work is added.
