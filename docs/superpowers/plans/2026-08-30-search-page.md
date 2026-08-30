# Search Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать в Yaskapp единый авторизованный поиск опросов и пользователей с переключателем типа, сортировкой и cursor-пагинацией.

**Architecture:** Backend получает единый `GET /search`, валидирует параметры и выполняет visibility-aware поиск в PostgreSQL. Flutter использует отдельный `SearchApiClient`, типизированные результаты и Search Screen; переходы переиспользуют существующие `PollCard` и `PublicProfileScreen`. Redis и внешний поисковый движок в MVP не используются.

**Tech Stack:** Flutter/Dart 3.4+, Node.js, TypeScript, Fastify 5, PostgreSQL, `pg`, `zod`, `flutter_test`, Node test runner.

**Spec:** [docs/prd-search.md](../../prd-search.md)

## Global Constraints

- Поиск доступен только авторизованным пользователям.
- `q` после trim имеет длину от 2 до 100 символов; `limit` — от 1 до 50, default 20.
- Поддерживаются `type=all|polls|users` и `sort=relevance|newest|popular`.
- Поиск выполняется по тексту вопроса опроса, username и display name пользователя.
- Удалённые, заблокированные, private и недоступные пользователю сущности не выдаются.
- Cursor должен быть opaque, стабильным и не допускать дублей или пропусков внутри последовательности страниц.
- Полный текст запроса не передаётся в аналитику.
- Не добавлять внешний поисковый сервис или обязательный Redis-кэш.
- Не добавлять фильтры по стране, теме, дате, статусу, хэштегам, комментариям, историю и рекомендации.

---

## File Map

- Create `services/api/src/db/migrations/026_search_indexes.sql` — индексы поиска.
- Create `services/api/src/modules/search/search.types.ts` — API enums, DTO и internal row types.
- Create `services/api/src/modules/search/search.repository.ts` — PostgreSQL queries, ranking и cursor clauses.
- Create `services/api/src/modules/search/search.service.ts` — нормализация, validation-facing service и result mapping.
- Create `services/api/src/modules/search/search.routes.ts` — Fastify route и auth.
- Modify `services/api/src/app.ts` — register search routes.
- Create `services/api/src/modules/search/search.repository.test.ts` — query/mapping tests with database mocks.
- Create `services/api/src/modules/search/search.routes.test.ts` — HTTP validation/auth/error tests.
- Create `apps/mobile/lib/src/features/search/search_result.dart` — Dart result model.
- Create `apps/mobile/lib/src/features/search/search_api_client.dart` — HTTP client for `/search`.
- Create `apps/mobile/lib/src/features/search/search_screen.dart` — input, controls, list and states.
- Create `apps/mobile/test/search_api_client_test.dart` — decoding and request tests.
- Create `apps/mobile/test/search_screen_test.dart` — widget behavior tests.
- Modify `apps/mobile/lib/src/features/feed/feed_screen.dart` — open Search Screen.
- Modify `apps/mobile/test/feed_screen_test.dart` — Search navigation test.
- Modify `apps/mobile/lib/src/core/` analytics boundary if an existing analytics abstraction is found; otherwise create `apps/mobile/lib/src/core/analytics/search_analytics.dart`.
- Create `apps/mobile/test/search_analytics_test.dart` — verify event payload excludes full query.

## Interfaces

Backend service exposes:

```ts
type SearchType = 'all' | 'polls' | 'users';
type SearchSort = 'relevance' | 'newest' | 'popular';

type SearchInput = {
  viewerId: string;
  query: string;
  type: SearchType;
  sort: SearchSort;
  cursor?: string;
  limit: number;
};

type SearchPage = {
  items: SearchResult[];
  nextCursor: string | null;
};

async function search(input: SearchInput): Promise<SearchPage>;
```

Flutter client exposes:

```dart
Future<SearchPage> search({
  required String accessToken,
  required String query,
  SearchType type = SearchType.all,
  SearchSort sort = SearchSort.relevance,
  String? cursor,
  int limit = 20,
});
```

## Task 1: Add PostgreSQL search indexes and repository

**Files:**
- Create: `services/api/src/db/migrations/026_search_indexes.sql`
- Create: `services/api/src/modules/search/search.types.ts`
- Create: `services/api/src/modules/search/search.repository.ts`
- Test: `services/api/src/modules/search/search.repository.test.ts`

**Interfaces:**
- Consumes: existing `users`, `profiles`, `polls`, `poll_options`, `likes` and public profile/poll mapping patterns.
- Produces: `searchPollRecords(input)`, `searchUserRecords(input)` and row mappers used by `search.service.ts`.

- [ ] **Step 1: Write repository tests for visibility, exact/partial matching, sorting and stable cursor ordering.**

  Cover public poll inclusion, exclusion of deleted/blocked/private polls, active user inclusion, exclusion of deleted users, username/display-name matching, `newest`, `popular`, and tie-breaking by `created_at` then ID. Assert that the query receives normalized query, viewer ID, limit, and decoded cursor values.

- [ ] **Step 2: Run the repository tests and verify they fail.**

  Run: `npm --prefix services/api test -- --test-name-pattern="search repository"`

  Expected: FAIL because the search repository and migration do not exist.

- [ ] **Step 3: Create the migration and indexes.**

  Add a migration that creates a GIN index for `to_tsvector('simple', question)` on non-deleted public polls, a GIN trigram index for `users.username`, and a GIN trigram index for `profiles.display_name`. Enable `pg_trgm` with `CREATE EXTENSION IF NOT EXISTS pg_trgm;`. Keep the migration additive and compatible with the migration guard.

- [ ] **Step 4: Implement repository queries and typed mapping.**

  Use parameterized SQL only. Return poll rows containing the fields required to hydrate an existing `PollSummary`, and user rows containing the fields required by `PublicProfile`. Apply `u.status = 'active'`, `u.deleted_at IS NULL`, `p.deleted_at IS NULL`, `p.visibility = 'public'`, and the viewer visibility predicate. Build cursor predicates from `(score, created_at, id)` for relevance/popularity and `(created_at, id)` for newest. Fetch `limit + 1` rows so the service can determine `nextCursor`.

- [ ] **Step 5: Run the focused tests and migration/type checks.**

  Run: `npm --prefix services/api run typecheck` and `npm --prefix services/api test -- --test-name-pattern="search repository"`

  Expected: PASS for repository tests and TypeScript typecheck; migration applies without checksum or SQL errors.

- [ ] **Step 6: Commit the repository layer.**

  Run: `git add services/api/src/db/migrations/026_search_indexes.sql services/api/src/modules/search && git commit -m "feat: add postgres search repository"`

## Task 2: Expose the authenticated `/search` API

**Files:**
- Create: `services/api/src/modules/search/search.service.ts`
- Create: `services/api/src/modules/search/search.routes.ts`
- Test: `services/api/src/modules/search/search.routes.test.ts`
- Modify: `services/api/src/app.ts`

**Interfaces:**
- Consumes: repository functions from Task 1 and existing `authenticate`/Fastify route patterns.
- Produces: `GET /search` returning `{ items, nextCursor }` with discriminated `type` items.

- [ ] **Step 1: Write HTTP tests for valid requests and all error cases.**

  Test `type=all`, `type=polls`, and `type=users`; default values; URL decoding; `400` for query length, invalid enum, invalid limit, unknown parameter, and unsupported sort/type combination; `401` without a bearer token; `429` through the existing global rate-limit behavior; and `500` mapping to the standard error response.

- [ ] **Step 2: Run the route tests and verify they fail.**

  Run: `npm --prefix services/api test -- --test-name-pattern="GET /search"`

  Expected: FAIL because `/search` is not registered.

- [ ] **Step 3: Implement Zod query validation and service normalization.**

  Trim `q`, reject 0–1 and >100 characters, default `type=all`, `sort=relevance`, `limit=20`, validate opaque cursor decoding, and reject unsupported combinations. Return a typed `SearchPage`; map repository rows into `{ type: 'poll', poll, score }` or `{ type: 'user', user, score }`.

- [ ] **Step 4: Implement and register the route.**

  Register `app.get('/search', { preHandler: [authenticate] }, handler)` through `registerSearchRoutes(app)`. Pass `request.user.sub` as `viewerId`, preserve standard Fastify error handling, and register the module in `buildApp()` after profile/poll routes.

- [ ] **Step 5: Run API tests and typecheck.**

  Run: `npm --prefix services/api run typecheck` and `npm --prefix services/api test -- --test-name-pattern="GET /search"`

  Expected: PASS, including auth, validation, visibility, cursor and error behavior.

- [ ] **Step 6: Commit the API layer.**

  Run: `git add services/api/src/app.ts services/api/src/modules/search && git commit -m "feat: expose search api"`

## Task 3: Add the Flutter search client and models

**Files:**
- Create: `apps/mobile/lib/src/features/search/search_result.dart`
- Create: `apps/mobile/lib/src/features/search/search_api_client.dart`
- Test: `apps/mobile/test/search_api_client_test.dart`

**Interfaces:**
- Consumes: `/search` response, `ApiConfig`, existing HTTP exception and client patterns.
- Produces: `SearchApiClient.search()` and immutable `SearchPage`, `SearchResult`, `SearchType`, `SearchSort`.

- [ ] **Step 1: Write client tests for request construction and decoding.**

  Assert URL query parameters, bearer header, default values, cursor propagation, mixed poll/user decoding, null `nextCursor`, invalid response rejection, and API error status/message mapping.

- [ ] **Step 2: Run the focused Flutter tests and verify they fail.**

  Run: `flutter test --no-pub test/search_api_client_test.dart`

  Expected: FAIL because the search models/client do not exist.

- [ ] **Step 3: Implement typed result decoding.**

  Decode `type` as a discriminated union: `poll` uses `PollSummary.fromJson`, `user` uses `PublicProfile.fromJson`. Reject unknown result types and malformed payloads with `SearchApiException`.

- [ ] **Step 4: Implement `SearchApiClient.search()`.**

  Build `_config.uri('/search', queryParameters: ...)`, send `authorization: Bearer <token>`, decode the object response, and expose `close()`. Encode `type`, `sort`, `limit`, and optional cursor exactly as the backend contract defines.

- [ ] **Step 5: Run tests and analyzer.**

  Run: `flutter test --no-pub test/search_api_client_test.dart` and `flutter analyze`

  Expected: PASS with no new analyzer errors.

- [ ] **Step 6: Commit the client layer.**

  Run: `git add apps/mobile/lib/src/features/search apps/mobile/test/search_api_client_test.dart && git commit -m "feat: add mobile search api client"`

## Task 4: Build the Search Screen

**Files:**
- Create: `apps/mobile/lib/src/features/search/search_screen.dart`
- Test: `apps/mobile/test/search_screen_test.dart`

**Interfaces:**
- Consumes: `SearchApiClient`, `PollCard`, `PublicProfileScreen`, `AuthSession`, and result models from Task 3.
- Produces: `SearchScreen({required session, SearchApiClient? searchApiClient, PollsApiClient? pollsApiClient, ProfilesApiClient? profilesApiClient})`.

- [ ] **Step 1: Write widget tests for initial, loading, results, empty and error states.**

  Use a fake `SearchApiClient` that records calls. Test automatic focus, no request for query length <2, 300–500 ms debounce, submit, clear, filter changes preserving query, sort changes resetting cursor, mixed poll/user rendering, result taps, retry, and pagination.

- [ ] **Step 2: Run the widget tests and verify they fail.**

  Run: `flutter test --no-pub test/search_screen_test.dart`

  Expected: FAIL because `SearchScreen` is not implemented.

- [ ] **Step 3: Implement the screen state machine.**

  Keep `TextEditingController`, selected `SearchType`, selected `SearchSort`, item list, next cursor, loading/error flags, and a debounce `Timer`. Cancel the timer and dispose owned clients in `dispose()`. Ignore stale responses by associating each request with a monotonically increasing request ID.

- [ ] **Step 4: Implement result widgets and interactions.**

  Render poll results with the existing `PollCard` in compact mode and user results with avatar/display name/username. Open `PublicProfileScreen` for users and the existing poll detail/comments flow for polls. Hide unsupported sort choices for the active type.

- [ ] **Step 5: Implement all UI states and pagination.**

  Add initial hint, loading indicator/skeleton, empty message, retryable error, timeout/offline message, and bottom pagination indicator. Preserve query on errors; reset items/cursor when type or sort changes; never append a page after a failed or stale request.

- [ ] **Step 6: Run focused tests and analyzer.**

  Run: `flutter test --no-pub test/search_screen_test.dart` and `flutter analyze`

  Expected: PASS with no new analyzer errors.

- [ ] **Step 7: Commit the Search Screen.**

  Run: `git add apps/mobile/lib/src/features/search/search_screen.dart apps/mobile/test/search_screen_test.dart && git commit -m "feat: add search screen"`

## Task 5: Connect Feed navigation and analytics events

**Files:**
- Modify: `apps/mobile/lib/src/features/feed/feed_screen.dart`
- Modify or create: `apps/mobile/lib/src/core/analytics/search_analytics.dart`
- Test: `apps/mobile/test/feed_screen_test.dart`
- Test: `apps/mobile/test/search_analytics_test.dart`

**Interfaces:**
- Consumes: `SearchScreen` and existing Feed navigation/session dependencies.
- Produces: Search icon opens Search Screen; analytics methods `searchOpened()`, `searchSubmitted({required int queryLength, required SearchType type, required SearchSort sort})`, `filterChanged(...)`, `resultClicked(...)`, `empty(...)`, and `error(...)`.

- [ ] **Step 1: Write navigation and analytics tests.**

  Assert tapping the existing Search icon pushes `SearchScreen` with the current session. Assert analytics payloads contain query length/type/sort/result metadata but never the raw query string.

- [ ] **Step 2: Run the tests and verify they fail.**

  Run: `flutter test --no-pub test/feed_screen_test.dart test/search_analytics_test.dart`

  Expected: FAIL because the icon callback is empty and the analytics boundary does not emit the new events.

- [ ] **Step 3: Wire Feed navigation.**

  Replace the empty Search icon callback with a `Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => SearchScreen(session: widget.session)))`, passing injectable clients where the existing Feed test pattern requires them.

- [ ] **Step 4: Add the minimal analytics boundary.**

  If no analytics provider exists, implement a no-op `SearchAnalytics` interface with a test spy; do not add a third-party SDK. Emit only the event name and approved metadata. Call the events from screen lifecycle, submit, filter/sort change, result click, empty and error transitions.

- [ ] **Step 5: Run focused tests.**

  Run: `flutter test --no-pub test/feed_screen_test.dart test/search_analytics_test.dart`

  Expected: PASS; the existing Feed tests remain green.

- [ ] **Step 6: Commit navigation and analytics.**

  Run: `git add apps/mobile/lib/src/features/feed/feed_screen.dart apps/mobile/lib/src/core/analytics apps/mobile/test/feed_screen_test.dart apps/mobile/test/search_analytics_test.dart && git commit -m "feat: connect search navigation and analytics"`

## Task 6: Run end-to-end verification and update documentation

**Files:**
- Modify: `docs/prd-search.md` only if implementation decisions change the approved contract.
- Test: existing API integration tests and Flutter test suite.

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: verified staging-ready search feature and documented deviations, if any.

- [ ] **Step 1: Run backend migration and focused API tests.**

  Run: `npm --prefix services/api run db:migrate`, `npm --prefix services/api run typecheck`, and `npm --prefix services/api test`

  Expected: migration succeeds, typecheck passes, and all API tests pass. If the local migration guard reports a pre-existing checksum mismatch, stop and record that environment issue without altering historical migrations.

- [ ] **Step 2: Run Flutter focused and regression tests.**

  Run: `flutter test --no-pub test/search_api_client_test.dart test/search_screen_test.dart test/feed_screen_test.dart test/home_navigation_test.dart test/profile_screen_test.dart`

  Expected: all selected tests pass.

- [ ] **Step 3: Run Flutter analyzer and diff checks.**

  Run: `flutter analyze` and `git diff --check`

  Expected: no new analyzer errors and no whitespace errors.

- [ ] **Step 4: Perform staging smoke verification.**

  With the configured staging API, verify login → Feed → Search; search for a known public poll and active user; switch All/Polls/Users; change sorting; paginate; open poll and profile; verify empty, retry and timeout states; verify private/deleted/blocked entities are absent.

- [ ] **Step 5: Update PRD only for approved implementation deviations.**

  Record concrete deviations under a dated implementation note in `docs/prd-search.md`; do not broaden MVP scope during implementation.

- [ ] **Step 6: Commit final verification notes.**

  Run: `git add docs/prd-search.md && git commit -m "docs: record search verification"` only when the PRD changed; otherwise keep the verification result in the task handoff.

## Self-Review Checklist

- [ ] Every PRD requirement maps to at least one task: scope/UX in Tasks 3–5, API in Task 2, PostgreSQL/ranking/visibility in Task 1, analytics in Task 5, readiness in Task 6.
- [ ] No task depends on an undefined public function; cross-task interfaces are listed above.
- [ ] No placeholder language remains in the plan.
- [ ] No new filters, search history, recommendations or external search infrastructure are introduced.
- [ ] Implementation must stop and revisit the spec if popularity score or visibility semantics cannot be implemented using current models.
