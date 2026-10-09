# M04 backend verification

**Date:** 9 October 2026  
**Branch:** `codex/m04-completion`  
**Database:** isolated local PostgreSQL 16 container, database `yaskapp_m04_test`; migrations `001–027` applied. Redis 7 and S3Mock were separate local test services. No development database was used.

## Results

- `npm run api:typecheck` — passed.
- `npm run api:test` — 159 passed, 1 failed, 0 skipped. The only failure is the known unrelated baseline test `logout clears the cookie session and mutating cookie requests require a trusted origin` in `services/api/src/modules/auth/auth.cookie.integration.test.ts:76`. It expects the server to revoke a stateless JWT after logout, while `/auth/logout` only clears the browser cookie. The same known failure is recorded in the M27 plan; auth/session behavior was kept out of M04.
- Focused integration test `vote revision overflow rolls back the vote row and all counters` — passed (1/1). It set `votes_revision` to PostgreSQL BIGINT max, attempted a vote, and verified the request failed while the vote row and both counters remained unchanged.
- Focused poll/search/realtime unit suite — passed (31/31): `polls.repository.test.ts`, `polls.routes.test.ts`, `search.repository.test.ts`, `search.routes.test.ts`, `realtime.hub.test.ts`.
- Existing integration assertions exercised version increments on committed vote, comment, like and unlike operations; duplicate vote/like and repeated unlike no-ops preserve revisions. Authenticated search returns viewer fields with poll revisions. Realtime tests verify vote broadcasts omit viewer-specific state. Existing admin integration verifies comment deletion and event behavior; its soft-deleted parent Poll case was corrected so moderation can delete a comment on that Poll.
- Review confirmed existing HTTP envelopes and realtime channels were retained, the additional `stateRevisions` field is additive for older clients, and events are published after repository transactions commit.

## Follow-up

The API suite is not fully green because of the documented unrelated auth baseline failure. No integration tests were skipped. M04-specific DB assertions and typecheck passed. The auth failure remains separately tracked and does not alter the M04 contract verification result.
