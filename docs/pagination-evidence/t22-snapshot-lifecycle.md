# T22: popular snapshot lifecycle evidence

Captured: 2026-10-26. Scope: PostgreSQL snapshot storage, owner quota, fixed expiry, and scheduled cleanup. Tests used an isolated PostgreSQL 16 container; its connection details and credentials are not stored here.

## Lifecycle results

| Scenario | Result |
|---|---|
| Full saved rank and pagination | In a fresh migrated PostgreSQL database, a snapshot containing 1,005 fixture poll IDs was read in position-based pages. The first four IDs matched the hand-ranked score/timestamp fixture, covering vote, like, and comment score weights plus timestamp tie-breaking. Changing the top poll's score after snapshot creation did not change its saved position. All 1,005 fixture IDs were returned once. |
| Fixed TTL and owner binding | `expires_at - created_at` was exactly 1,800 seconds. Reading a page left `expires_at` unchanged. A different owner's key could not read the snapshot. |
| Owner quota | Creating four snapshots sequentially evicted the oldest. Eight concurrent creations for the same owner left exactly three active snapshots. |
| Cleanup | A snapshot made older than its 30-minute TTL was deleted, and its ordered-ID rows were removed by the foreign-key cascade. |
| Page query plan | With 10,000 saved IDs and page size 50, `EXPLAIN (ANALYZE, BUFFERS)` used the `(snapshot_id, position)` primary-key index inside the lateral subquery and returned 51 rows to the outer sort. This checks the bounded page scan shape; it is not a staging latency measurement. |

## Verification

| Command | Result |
|---|---|
| `node --import tsx --test src/modules/polls/poll-feed-snapshots.test.ts` from `services/api` | Exit 0; 4 tests passed |
| Fresh isolated PostgreSQL 16 database: `npm run db:migrate` then the lifecycle test command | Exit 0; all 35 migrations applied; 4 tests passed |
| `npm run api:typecheck` | Exit 0 |
| `npm run api:test` with isolated PostgreSQL, Redis, and RustFS services | Exit 0; 342 passed, 8 environment-gated tests skipped |
| `npm run db:migrate -w @yaskapp/api` on a fresh PostgreSQL 16 database | Applied migration `035_poll_feed_snapshots.sql` |
| `npm run db:migrate -w @yaskapp/api` on the migrated database | Exit 0; no pending migrations |
| `npm run poll-feed-snapshots:cleanup -w @yaskapp/api` | Exit 0; command completed and reported 0 expired snapshots in the clean fixture database |
| `docker compose --file infra/docker/docker-compose.staging.yml config --quiet` | Exit 0 |
| CI workflow | Adds a separate `yaskapp_pagination` database, applies migrations, and runs the lifecycle integration tests without sharing the API suite's database. |

The isolated test container was stopped after verification. Popular first-page latency and larger staging load budgets remain part of T26.
