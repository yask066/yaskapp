# Feed and comment pagination baseline

This directory records the pre-pagination baseline for T02. It includes source-level behavior and runtime measurements from an isolated test environment. Values in the source baseline below describe request/rendering behavior; they are not latency or scroll measurements.

## Reproduction environment

| Item | Value |
|---|---|
| Baseline commit | `4746e2f0ea9628919b5ddf1715730a448a1935ca` (T01 base) |
| Worktree | `C:\Users\user\.codex\worktrees\feed-comments-t02\yaskapp` |
| Host | Windows `[Version 10.0.26200.9711]` |
| Node / npm | Node `v24.7.0`; npm `11.5.1` |
| Flutter / Dart | Flutter `3.44.5`; Dart `3.12.2` |
| Web browsers | Chrome `155.0.8059.80`; Edge `155.0.4283.62` |
| Android device | Samsung SM A325F, Android 13 (API 33), connected over ADB |
| Database | Dedicated test database; connection details stay in local environment configuration |
| API / web / mobile build | API `npm run dev` (development); web Vite `6.3.5`; Flutter debug build |

## Fixture layout

`test/fixtures/feed-comments-pagination.json` is the source of stable IDs, UTC timestamps, ordered IDs, and first-page windows. Seed with a unique lowercase seed to namespace all UUIDs. The normal data set has 125 polls, 125 root comments, and 65 replies. Its separate target poll has 225 roots and 225 replies under one root, so root and reply positions beyond page 10 at limit 20 can be requested against persisted rows. Context records cover follows, private/followers-only visibility, and soft deletion. The database helper inserts within a transaction and cleanup deletes only the poll and account IDs derived from that seed.

Run the fixture helper checks from the API workspace:

```powershell
node --import tsx --test src/modules/polls/poll-pagination.fixtures.test.ts
```

For a real DB run, configure the API's required environment variables in `services/api/.env` or the current shell, then run `npm run db:migrate` from `services/api`. Keep that file local and use a dedicated disposable test database. From `services/api`, seed using this PowerShell command:

```powershell
node --import tsx --input-type=module -e 'import { db, closeDatabaseConnection } from "./src/config/database.js"; import { seedPollPaginationFixtures } from "./src/modules/polls/poll-pagination.fixtures.js"; try { const seeded = await seedPollPaginationFixtures(db, "baseline-2026-10-19"); console.log(JSON.stringify({ seed: seeded.seed, targetPollId: seeded.ids.targetPolls[0], targetRootId: seeded.ids.targetRoots[0], targetRoots: seeded.ids.targetRoots.length, targetReplies: seeded.ids.targetReplies.length })); } finally { await closeDatabaseConnection(); }'
```

The helper transaction rolls back on insert errors. Clean up after collecting evidence, and clean up a prior run before reusing the same seed:

```powershell
node --import tsx --input-type=module -e 'import { db, closeDatabaseConnection } from "./src/config/database.js"; import { cleanupPollPaginationFixtures, expandPollPaginationFixtures, readPollPaginationFixtures } from "./src/modules/polls/poll-pagination.fixtures.js"; try { const seed = "baseline-2026-10-19"; const expanded = expandPollPaginationFixtures(readPollPaginationFixtures(), seed); await cleanupPollPaginationFixtures(db, { seed, ids: expanded.ids, expectedIds: expanded.expectedIds, expectedIdWindows: expanded.expectedIdWindows }); } finally { await closeDatabaseConnection(); }'
```

Start the API with `npm run dev` from `services/api` and the web client with `npm run dev -w @yaskapp/web` from the repository root. Vite proxies API requests to `http://localhost:3000` by default. For Android, run `adb reverse tcp:3000 tcp:3000`, then launch from `apps/mobile` with `flutter run -d RF8R321M9LJ --dart-define=API_BASE_URL=http://127.0.0.1:3000 --dart-define=API_WEBSOCKET_URL=ws://127.0.0.1:3000/realtime`. The mobile app requires an authenticated session; the seed accounts intentionally use non-login placeholder hashes, so use an existing local test session or arrange a test login before recording mobile UI results.

## Source baseline (before pagination changes)

| Surface | Current request / rendering behavior |
|---|---|
| Feed API | `GET /polls` defaults to `limit=20` (valid range 1–50), returning `{ items }` with no continuation token. |
| Web feed | Calls `listPolls()` once with its default limit 20 via TanStack `useQuery`; feed sorting changes the query, but scrolling does not append another request. |
| Flutter feed | Calls `listPolls()` once with default limit 20; the screen retains that response in one list. |
| Roots API | `GET /polls/:pollId/comments` defaults to `limit=50`, returning `{ items }`. |
| Web roots | Calls `listComments()` once with `limit=50`; the rendered list has no next-page request. |
| Flutter roots | Calls `listComments()` once with default limit 50 and renders the comments in one `SingleChildScrollView`. |
| Replies API and clients | Default `limit=20`; the legacy API has a cursor for replies, but roots/comments do not append more than the initial response. |

Inspected at baseline commit in `services/api/src/modules/polls/polls.routes.ts`, `apps/web/src/features/feed/FeedPage.tsx`, `apps/web/src/features/comments/CommentList.tsx`, `apps/web/src/api/polls.ts`, `apps/mobile/lib/src/features/feed/feed_screen.dart`, `apps/mobile/lib/src/features/polls/poll_comments_screen.dart`, and `apps/mobile/lib/src/features/polls/polls_api_client.dart`.

## Runtime evidence

Runtime baseline captured on **2026-10-19 through 13:50 UTC**, before pagination changes, from baseline commit `4746e2f0ea9628919b5ddf1715730a448a1935ca`. API was run with `npm run dev` in development mode against the isolated task database, Redis DB 15, and an empty task bucket. The web client was Vite 6.3.5, and the Android app was a Flutter debug build launched with the command above. Runtime versions and devices are in the environment table. `.env` stayed local and is ignored by git.

The browser and Android app each loaded the legacy first page. The web browser was scrolled to the document bottom (scrollY 10,039.93 px of 10,666 px; viewport 626 px) and observed for two seconds. The device owner reported reaching the feed bottom; this environment exposes no native screen inspection, so mobile rendered-row counts could not be read directly. No subsequent `/polls` request appeared in API logs after that mobile scroll.

| Client / case | Rows available | Initial request / response | After loaded-list bottom | Visible / unavailable rows | Result |
|---|---:|---|---|---|---|
| Web feed, Chrome 155.0.8059.80 | 126 public polls | `GET /polls?limit=20`: 200, 20 items; server 35.87 ms | 0 additional requests after 2 s | 20 DOM articles; 106 remain beyond page 1 | No append request on scroll |
| Flutter feed, SM A325F, Android 13 | 126 public polls | `GET /polls?limit=20`: 200, 20 items; server 18.27 ms | 0 further `/polls` requests observed after user reported bottom | 20 returned; rendered count not inspectable; 106 remain beyond page 1 | No append request observed |
| Web roots, target poll | 225 roots | Initial `GET /polls/<target>/comments?limit=50`: 200, 50 items, ~21.41 ms server time | UI could not scroll a rendered list | No roots rendered; 175 remain beyond page 1 | Guest route also requests protected `GET /polls/<target>` (401, ~23 ms). Repeated retries reached global API 429, leaving both poll and comments alerts in error state. |
| Flutter roots, target poll | 225 roots | `GET /polls/<target>/comments?limit=50`: 200, first 50 items; API server 13.26 ms. | 0 further comments requests after user scrolled to bottom and waited | 50 returned; 175 remain beyond page 1 | Target poll and comments request confirmed in API log; device UI row count is not inspectable here. |
| Web replies, target branch (API probe) | 225 replies | `GET /polls/<target>/comments/<targetRoot>/replies?limit=20`: 200, 20 items, `nextCursor` present; server 6.95 ms | UI not reached as guest | 205 remain beyond page 1 | Existing replies cursor continues; web UI unverified. |
| Flutter replies, target branch | 225 replies | First `GET .../replies?limit=20`: 200, 20 items; API server 11.18 ms. | Five cursor continuation requests followed after the user tapped “Load more replies”; all returned 200, server times 9.20–11.18 ms. | Six 20-item pages requested (120 total); 105 remain. UI row count is not inspectable. | Legacy cursor chain continued successfully. Because the manual “Load more replies” button was used while scrolling, this does not measure scroll-only auto-loading. |

Separate direct API probes, run with a reserved synthetic client IP to isolate them from the browser's rate-limit burst, returned: feed 200/20 (`{items}` only; 7.85 ms server, 63.84 ms client round trip), target detail 401 unauthorized (2.20 ms server, 5.58 ms round trip), target roots 200/50 (`{items}` only; 8.27 ms server, 10.28 ms round trip), and target replies 200/20 with `nextCursor` (6.95 ms server, 8.57 ms round trip). The feed round trip includes a fresh Node fetch connection and is not comparable to server response time. These API probes establish endpoint behavior; they are not UI render timings.

Reproduce the direct API count/status/cursor probe from the repository root after seeding and starting the API:

```powershell
node -e 'import { performance } from "node:perf_hooks"; const base = "http://127.0.0.1:3000"; const poll = "8a154057-247d-4940-867c-000000000001"; const root = "2c7b310c-1011-425b-85ce-000000000001"; const paths = ["/polls?limit=20", `/polls/${poll}`, `/polls/${poll}/comments?limit=50`, `/polls/${poll}/comments/${root}/replies?limit=20`]; for (const path of paths) { const start = performance.now(); const response = await fetch(base + path, { headers: { "x-forwarded-for": "198.51.100.19" } }); const data = await response.json(); console.log(JSON.stringify({ path, status: response.status, items: data.items?.length, keys: Object.keys(data), clientRoundTripMs: Number((performance.now() - start).toFixed(2)) })); }'
```

The IDs above are for seed `baseline-2026-10-19`; change them if using another seed. The synthetic IP is reserved for documentation/testing and keeps the probe isolated from the browser rate-limit bucket.

### Existing failures and limitations

- Unauthenticated web poll detail fails with 401 while the guest comments endpoint can initially return 200. The current web detail page still attempts the protected poll request, then retries rapidly until the global rate limiter returns 429; no comments are rendered. The browser was left unauthenticated, so web roots/replies scrolling could not be measured.
- The mobile client repeatedly opens `/realtime`; the API returns 500 with `TypeError: Cannot read properties of undefined (reading 'sub')` at `src/realtime/realtime.routes.ts:66`. This is an existing runtime failure, separate from pagination.
- The device user registered a temporary account in the isolated test database. Fixture accounts use placeholder password hashes and cannot be used to sign in.
- CUA has no Android screen inspection surface in this environment. Mobile UI row counts and scroll offsets therefore depend on the operator's manual report plus API request logs.
- After evidence collection, cleanup removed the seed-scoped rows; verification found 0 fixture polls and 0 fixture accounts remaining. The device's separately registered test account was left in the isolated database.

The fixture helper checks (2/2) and API typecheck passed before this run. They verify fixture generation and type safety only; this baseline records the current no-pagination behavior and is not a pagination acceptance test. The web authenticated comments UI remains unverified because this run used a guest browser, and mobile visual row counts are not inspectable; both limits are recorded rather than treated as passes. Clean up only `baseline-2026-10-19` with the seed-scoped helper after evidence collection.
