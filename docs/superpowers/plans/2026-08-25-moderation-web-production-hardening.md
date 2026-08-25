# Moderation Web Production Hardening Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with verification checkpoints.

**Goal:** Make the closed moderation web panel enforce staff-only access and expose capabilities-gated queue, appeals, audit, and policy workflows.

**Architecture:** Keep the existing static web app and in-memory token flow, but centralize request error handling and capability checks. Add narrowly scoped backend endpoints for moderation policy read/update, while reusing existing audit and appeal APIs. The backend remains authoritative for every permission and mutation.

**Tech Stack:** Fastify, PostgreSQL, TypeScript, vanilla JavaScript/CSS static web app, Node test runner.

**Spec:** `docs/prd-moderation-web-panel.md` and the approved block-2 design.

## Global Constraints

- Ordinary users must receive `403` from moderation APIs and must never see panel content.
- Web UI visibility is capability-based and cannot replace backend authorization.
- Policy writes require `moderation.policy.update`, reason, and idempotency protection.
- Audit records are immutable and read-only through the panel.
- MFA, httpOnly cookies, CSRF, and VPN/SSO remain deployment requirements documented separately.

### Task 1: Backend policy API

**Files:**
- Modify: `services/api/src/modules/moderation/moderation.routes.ts`
- Create: `services/api/src/modules/moderation/policy.repository.ts`
- Create: `services/api/src/modules/moderation/policy.service.ts`
- Test: `services/api/src/modules/moderation/moderation.integration.test.ts`

- [ ] Add `GET /moderation/policy` protected by `moderation.policy.read`.
- [ ] Add `PATCH /moderation/policy` protected by `moderation.policy.update`, requiring reason and `Idempotency-Key`.
- [ ] Validate thresholds against the database constraints and write `moderation.policy_updated` audit data in the same transaction.
- [ ] Add tests for moderator read, superadmin update, ordinary-user denial, invalid input, and repeated idempotency key.

### Task 2: Web authentication and route guard

**Files:**
- Modify: `apps/moderation-web/src/main.js`
- Modify: `apps/moderation-web/index.html`
- Modify: `apps/moderation-web/src/styles.css`
- Modify: `apps/moderation-web/README.md`

- [ ] Keep token only in memory and clear it on logout, `401`, and denied capability bootstrap.
- [ ] Gate all panel sections behind successful capability bootstrap and show a generic unauthorized screen for `403`.
- [ ] Disable mutation buttons while requests are in flight and handle `401`, `403`, `404`, `409`, and `429` with safe messages.
- [ ] Add visible staff-session and environment security warnings without exposing token data.

### Task 3: Appeals, audit, and policy views

**Files:**
- Modify: `apps/moderation-web/index.html`
- Modify: `apps/moderation-web/src/main.js`
- Modify: `apps/moderation-web/src/styles.css`

- [ ] Add tabs/navigation for Cases, Appeals, Audit, and Policy.
- [ ] Add cursor pagination and status filtering to Appeals and Audit.
- [ ] Show appeal decision controls only with `moderation.appeal.resolve`.
- [ ] Show audit only with `moderation.audit.read` and policy controls only with `moderation.policy.update`.
- [ ] Require reason/confirmation for policy changes and appeal decisions.

### Task 4: Verification and deployment documentation

**Files:**
- Create: `apps/moderation-web/test/smoke.test.mjs`
- Modify: `apps/moderation-web/README.md`
- Modify: `docs/prd-moderation-web-panel.md`

- [ ] Add browser-independent smoke tests for escaping, request error mapping, and capability visibility helpers.
- [ ] Run API typecheck and full API tests.
- [ ] Run static JavaScript syntax checks and diff checks.
- [ ] Document HTTPS, internal origin, VPN/SSO, MFA, httpOnly cookies, and CSRF requirements before production exposure.
