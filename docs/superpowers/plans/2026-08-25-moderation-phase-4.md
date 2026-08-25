# Moderation Phase 4 Permanent Bans and Appeals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add sanction-based permanent bans, user appeals, superadmin-only decisions, realtime moderation events, and end-to-end smoke coverage.

**Architecture:** Permanent bans are immutable sanction decisions with `type = permanent_ban`, `expires_at = NULL`, and backend enforcement through the existing sanction query. Appeals are separate records linked to a sanction; creation is user-facing, while decisions are superadmin-only and atomically update the sanction plus audit log. Realtime events expose only identifiers and state transitions, never reasons or private text.

**Tech Stack:** Fastify, TypeScript, PostgreSQL transactions/migrations, existing JWT/session-version enforcement, WebSocket realtime hub, moderation web app, Node test runner.

**Spec:** `docs/prd-moderation-web-panel.md`, sections 9.3, 10, 12, 14, 15, 16, and Phase 4.

## Global Constraints

- Permanent ban is sanction-based; do not add a `banned` user status enum.
- Only `superadmin` may issue or revoke a permanent ban and make final appeal decisions.
- Every mutation requires a reason, server-side permission, rate limit, and `Idempotency-Key`.
- Permanent ban, appeal decision, session revocation, and audit insertion commit or roll back together.
- One active appeal is allowed per sanction; duplicate creation is idempotent or returns a stable conflict.
- Realtime payloads contain identifiers/status only; never send reasons, appeal text, or private user data.
- Existing Flutter ordinary-user flows must not expose moderation routes or panel navigation.

---

### Task 1: Permanent-ban and appeals schema

**Files:**
- Create: `services/api/src/db/migrations/017_moderation_permanent_bans_appeals.sql`
- Test: `services/api/src/modules/moderation/appeals.integration.test.ts`

- [ ] Add `permanent_ban` to the sanction type constraint without changing `users.status`.
- [ ] Create `appeals` with sanction/user references, `open|upheld|reduced|revoked|request_more_info` status, reason, decision note, resolver, timestamps, and a unique active appeal per sanction.
- [ ] Add indexes for appeal status/created time, user, sanction, and active-ban lookup.
- [ ] Add failing integration tests for ordinary-user access, one-active-appeal enforcement, and cleanup-safe foreign keys.

### Task 2: Permanent-ban transactions and enforcement

**Files:**
- Modify: `services/api/src/modules/moderation/sanctions.repository.ts`
- Modify: `services/api/src/modules/moderation/sanctions.service.ts`
- Modify: `services/api/src/modules/auth/auth.service.ts`
- Modify: `services/api/src/modules/auth/auth.utils.ts`
- Test: `services/api/src/modules/moderation/appeals.integration.test.ts`

- [ ] Add `permanent_ban` to `SanctionType` and active-sanction enforcement.
- [ ] Implement a superadmin-only permanent-ban mutation linked to an open user case.
- [ ] Increment `session_version` on issue and revoke, making existing JWTs invalid.
- [ ] Make the mutation idempotent and audit it as `moderation.permanent_ban_issued`.
- [ ] Add failing tests for login/JWT/content rejection and rollback when audit insertion fails.

### Task 3: Appeals repository and service

**Files:**
- Create: `services/api/src/modules/moderation/appeals.repository.ts`
- Create: `services/api/src/modules/moderation/appeals.service.ts`
- Modify: `services/api/src/modules/admin/audit.repository.ts`
- Test: `services/api/src/modules/moderation/appeals.integration.test.ts`

- [ ] Implement `createAppeal` with sanction ownership validation, active-sanction validation, and one active appeal per sanction.
- [ ] Implement cursor-paginated appeal listing for moderation staff.
- [ ] Implement superadmin-only `uphold`, `reduce`, `revoke`, and `request_more_info` decisions.
- [ ] Make decisions transactional: lock appeal/sanction, update both, revoke permanent ban when required, increment session version, and write audit.
- [ ] Ensure decisions cannot be performed twice or by moderators.

### Task 4: Protected API routes and permissions

**Files:**
- Modify: `services/api/src/modules/auth/permissions.ts`
- Modify: `services/api/src/modules/moderation/moderation.routes.ts`
- Modify: `services/api/src/modules/admin/admin.routes.ts`
- Test: `services/api/src/modules/moderation/appeals.integration.test.ts`

- [ ] Add `POST /moderation/users/:userId/permanent-ban`.
- [ ] Add `POST /appeals` for the sanctioned user.
- [ ] Add `GET /moderation/appeals?status=&cursor=`.
- [ ] Add `POST /moderation/appeals/:appealId/resolve` with the four decision states.
- [ ] Require `moderation.appeal.resolve` for decisions and `moderation.appeal.read` for listing.
- [ ] Return stable `401`, `403`, `404`, `409`, and `422` errors and prevent reason/text leakage in logs.

### Task 5: Realtime and moderation web UI

**Files:**
- Modify: `services/api/src/realtime/realtime.hub.ts`
- Modify: `apps/moderation-web/index.html`
- Modify: `apps/moderation-web/src/main.js`
- Modify: `apps/moderation-web/src/styles.css`
- Test: `services/api/src/realtime/realtime.hub.test.ts`

- [ ] Add `moderation.sanction_created`, `moderation.sanction_revoked`, `moderation.appeal_created`, and `moderation.appeal_resolved` events with safe payloads.
- [ ] Broadcast only after the corresponding database transaction commits.
- [ ] Add permanent-ban controls with explicit confirmation and a second confirmation phrase.
- [ ] Add appeals queue/detail/decision controls visible only when capabilities allow them.
- [ ] Add smoke coverage for WebSocket payload shape and panel JavaScript syntax.

### Task 6: Documentation and full verification

**Files:**
- Modify: `docs/moderation-reports-api.md`
- Modify: `docs/prd-moderation-web-panel.md`
- Test: all API tests

- [ ] Document permanent-ban and appeal endpoints, decisions, idempotency, and realtime payloads.
- [ ] Run `npm run db:migrate`.
- [ ] Run `npm run api:typecheck`.
- [ ] Run `npm run api:test`.
- [ ] Run `node --check apps/moderation-web/src/main.js` and `git diff --check`.
