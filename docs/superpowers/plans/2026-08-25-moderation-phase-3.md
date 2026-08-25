# Moderation Phase 3 Sanctions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-authorized warnings, strikes, restrictions, and temporary bans with policy evaluation, session revocation, idempotency, and moderation-panel controls.

**Architecture:** Sanctions are append-only decisions linked to a moderation case. A shared backend enforcement query calculates active restrictions for each user, while transactional mutation services create sanctions, update strikes, revoke sessions, and write audit records atomically. Repeated mutations are protected by an idempotency key stored with the response result.

**Tech Stack:** Fastify, TypeScript, PostgreSQL migrations/transactions, existing JWT auth, existing moderation web app, Node test runner.

**Spec:** `docs/prd-moderation-web-panel.md`, sections 9, 12, 14, 15, and 16.

## Global Constraints

- Backend permissions are authoritative; UI capability checks are only presentation logic.
- Every destructive mutation requires a non-empty reason and is rate limited.
- Sanction mutation, strike state, session revocation, and audit insertion must commit or roll back together.
- Repeating the same `Idempotency-Key` with the same request fingerprint returns the original result without a second sanction or audit record.
- Ordinary users receive `403` for moderation endpoints.
- Permanent bans and appeal workflows remain Phase 4; Phase 3 implements temporary bans only.

---

### Task 1: Sanction and policy schema

**Files:**
- Create: `services/api/src/db/migrations/014_moderation_sanctions.sql`
- Create: `services/api/src/db/migrations/015_moderation_idempotency.sql`
- Test: `services/api/src/modules/moderation/sanctions.integration.test.ts`

- [ ] Add `sanction_type`, `sanction_status`, and `strike_status` constraints through text checks for `warning`, `strike`, `posting_restriction`, `comment_restriction`, and `temporary_ban`.
- [ ] Create `sanctions` with user/case/creator references, reason, metadata, starts/expires/revoked timestamps, and indexes for active user sanctions and expiry.
- [ ] Create `user_strikes` with severity, status, optional expiry, and unique source sanction.
- [ ] Create `moderation_policies` as a singleton policy row containing strike thresholds, default durations, and revision timestamps.
- [ ] Create `moderation_idempotency_keys` keyed by actor and key, storing request fingerprint, status code, JSON response, and expiry.
- [ ] Write failing migration/integration assertions for schema constraints and cleanup-safe foreign keys.

### Task 2: Enforcement and idempotency primitives

**Files:**
- Create: `services/api/src/modules/moderation/sanctions.repository.ts`
- Create: `services/api/src/modules/moderation/sanctions.service.ts`
- Create: `services/api/src/modules/moderation/idempotency.repository.ts`
- Modify: `services/api/src/modules/auth/auth.utils.ts`
- Modify: `services/api/src/modules/auth/auth.service.ts`
- Test: `services/api/src/modules/moderation/sanctions.integration.test.ts`

- [ ] Implement `getActiveUserSanctions(userId)` using `starts_at <= now()` and non-expired/non-revoked status.
- [ ] Implement `enforceUserAccess(userId, capability)` for login, poll creation, and comment creation; temporary ban rejects authentication and content restrictions reject only their capability.
- [ ] Add a database-backed session/revocation version to users and include it in JWT claims; increment it for temporary bans and compare it during authentication.
- [ ] Implement idempotency claim/finalize/replay in one transaction-safe repository API; reject a reused key with a different fingerprint using `409`.
- [ ] Add failing tests for login rejection, posting/comment restrictions, revoked JWTs, replay, and key conflict.

### Task 3: Transactional sanction actions and policy evaluation

**Files:**
- Modify: `services/api/src/modules/moderation/moderation.repository.ts`
- Modify: `services/api/src/modules/moderation/moderation.service.ts`
- Create: `services/api/src/modules/moderation/policy.repository.ts`
- Test: `services/api/src/modules/moderation/sanctions.integration.test.ts`

- [ ] Implement warning, strike, posting restriction, comment restriction, temporary ban, and sanction revoke mutations.
- [ ] Require the case target to be a user for user sanctions and require an open/in-review case.
- [ ] Update active strike state and evaluate policy thresholds in the same PostgreSQL transaction.
- [ ] For temporary bans, increment the user session version and ensure login/authentication is rejected until expiry.
- [ ] Record `moderation.sanction_issued`, `moderation.sanction_revoked`, and `moderation.policy_evaluated` audit events with bounded reasons and metadata.
- [ ] Ensure all mutation failures, including audit failures, roll back sanction and strike changes.

### Task 4: Protected moderation API

**Files:**
- Modify: `services/api/src/modules/moderation/moderation.routes.ts`
- Modify: `services/api/src/modules/admin/admin.routes.ts`
- Modify: `services/api/src/modules/admin/audit.repository.ts`
- Modify: `services/api/src/modules/auth/permissions.ts`
- Test: `services/api/src/modules/moderation/sanctions.integration.test.ts`

- [ ] Add `POST /moderation/users/:userId/warning`.
- [ ] Add `POST /moderation/users/:userId/strike`.
- [ ] Add `POST /moderation/users/:userId/restriction`.
- [ ] Add `POST /moderation/users/:userId/temporary-ban`.
- [ ] Add `POST /moderation/sanctions/:sanctionId/revoke`.
- [ ] Require `Idempotency-Key`, reason, caseId, and typed duration where applicable; apply the existing admin destructive rate limit.
- [ ] Map validation, permission, conflict, not-found, and idempotency errors to stable responses.
- [ ] Add tests proving regular users cannot call endpoints and duplicate requests do not duplicate sanctions/audit entries.

### Task 5: Moderation web sanctions UI

**Files:**
- Modify: `apps/moderation-web/index.html`
- Modify: `apps/moderation-web/src/main.js`
- Modify: `apps/moderation-web/src/styles.css`
- Modify: `apps/moderation-web/README.md`

- [ ] Add case actions for warning, strike, posting restriction, comment restriction, and temporary ban.
- [ ] Require a case-linked reason and explicit confirmation before sending destructive actions.
- [ ] Generate a fresh `Idempotency-Key` per user action and display server responses/errors.
- [ ] Render active sanctions in case details and allow revoke only when the capability is returned by backend.
- [ ] Keep token handling and authorization boundaries unchanged; regular users must never receive panel routes through Flutter.

### Task 6: Documentation and verification

**Files:**
- Modify: `docs/moderation-reports-api.md`
- Modify: `docs/prd-moderation-web-panel.md`
- Test: all API tests

- [ ] Document sanction endpoints, request headers, response shapes, and enforcement behavior.
- [ ] Run `npm run db:migrate`.
- [ ] Run `npm run api:typecheck`.
- [ ] Run `npm run api:test` and verify zero failures.
- [ ] Run `node --check apps/moderation-web/src/main.js` and `git diff --check`.
- [ ] Report any deployment validation blocked by unavailable local environment files separately from code verification.
