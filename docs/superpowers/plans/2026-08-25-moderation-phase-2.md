# Moderation Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the protected moderation workspace backend and a separate web panel for reviewing and resolving moderation cases.

**Architecture:** Extend the existing moderation module with case detail, assignment/takeover, notes, resolution and content-removal actions. Reuse the existing transactional admin deletion services while authorizing through moderation permissions, and extend the append-only audit log. Add a standalone static web client under `apps/moderation-web` that never embeds moderation permissions in the mobile app.

**Tech Stack:** Fastify, TypeScript, PostgreSQL, Zod, vanilla browser JavaScript/CSS, Docker/Caddy deployment assets, `node:test`.

**Spec:** `docs/prd-moderation-web-panel.md` (Phase 2 and sections 8, 11–17).

## Global Constraints

- Ordinary users must receive `403` for every `/moderation/*` mutation and case read endpoint.
- Backend permissions remain the security boundary; the web client only renders server-issued capabilities.
- Case state changes, assignments, notes, content removals, and audit records must be consistent.
- Destructive actions require a non-empty reason and use existing rate-limit/idempotency protections where applicable.
- Existing `/admin/*` API behavior and Flutter contracts must remain compatible.
- No sanctions, strikes, appeals, or policy engine are implemented in Phase 2.

---

### Task 1: Extend audit and case schema

**Files:**
- Create: `services/api/src/db/migrations/011_moderation_case_workflow.sql`
- Modify: `services/api/src/modules/admin/audit.repository.ts`
- Test: `services/api/src/modules/moderation/moderation.integration.test.ts`

- [ ] Add failing assertions for moderation audit actions and case notes.
- [ ] Add `moderation_case_notes` and workflow fields/constraints needed by assignment and resolution.
- [ ] Extend the audit action constraint with normalized moderation actions.
- [ ] Run migration and focused tests.

### Task 2: Implement case detail and workflow repository/service

**Files:**
- Modify: `services/api/src/modules/moderation/moderation.repository.ts`
- Modify: `services/api/src/modules/moderation/moderation.service.ts`
- Test: `services/api/src/modules/moderation/moderation.integration.test.ts`

- [ ] Add failing tests for detail, assignment, takeover, notes, resolve, dismiss, and escalate.
- [ ] Implement `getModerationCase`, `assignModerationCase`, `takeoverModerationCase`, `addModerationNote`, and `transitionModerationCase`.
- [ ] Enforce allowed transitions and actor permissions in the route/service layer.
- [ ] Lock the case row with `FOR UPDATE`, write state and audit in one transaction, and reject stale/conflicting assignments with `409`.
- [ ] Return internal notes only to moderation staff.

### Task 3: Add moderation content-removal endpoints

**Files:**
- Modify: `services/api/src/modules/moderation/moderation.routes.ts`
- Modify: `services/api/src/modules/moderation/moderation.service.ts`
- Test: `services/api/src/modules/moderation/moderation.integration.test.ts`

- [ ] Add failing tests for poll/comment removal, repeat removal, missing target, and ordinary-user denial.
- [ ] Reuse existing transactional `deleteAdminPoll`/`deleteAdminComment` repository functions through moderation permission checks.
- [ ] Require case ID and reason, verify case target matches the content target, and resolve/update the case after successful removal.
- [ ] Keep existing realtime deletion events and audit records intact.

### Task 4: Add API routes and error contracts

**Files:**
- Modify: `services/api/src/modules/moderation/moderation.routes.ts`
- Modify: `services/api/src/app.ts`
- Test: `services/api/src/modules/moderation/moderation.integration.test.ts`

- [ ] Add `GET /moderation/cases/:caseId`.
- [ ] Add `POST /moderation/cases/:caseId/assign`, `/takeover`, `/notes`, `/resolve`, `/dismiss`, and `/escalate`.
- [ ] Add `POST /moderation/content/:type/:id/remove`.
- [ ] Add Zod schemas, UUID validation, reason limits, and consistent `400/403/404/409` responses.
- [ ] Verify all routes use `authenticate` plus the required moderation permission.

### Task 5: Build the separate moderation web panel

**Files:**
- Create: `apps/moderation-web/index.html`
- Create: `apps/moderation-web/src/main.js`
- Create: `apps/moderation-web/src/styles.css`
- Create: `apps/moderation-web/README.md`

- [ ] Add login/token entry flow and a server-capabilities check.
- [ ] Add queue table with status/category/priority filters and cursor loading.
- [ ] Add case detail view with report summary, assignment controls, notes, and action dialogs.
- [ ] Hide actions based on server capabilities while preserving backend enforcement.
- [ ] Render `401/403/404/409/429` as explicit recoverable UI states.
- [ ] Do not store admin tokens in localStorage; use session memory for the MVP and document production cookie/MFA hardening.

### Task 6: Add deployment and API documentation

**Files:**
- Create: `apps/moderation-web/Dockerfile`
- Modify: `infra/docker/docker-compose.staging.yml`
- Modify: `infra/docker/Caddyfile`
- Modify: `docs/moderation-reports-api.md`

- [ ] Add a static web image and a staging service isolated from the mobile app.
- [ ] Route a dedicated moderation host through Caddy with the API base URL configured.
- [ ] Document build, local static serving, environment configuration, and permissions.
- [ ] Verify the API and web assets build without changing the existing API container contract.

### Task 7: Full verification

- [ ] Run `npm run db:migrate`.
- [ ] Run `npm run api:typecheck`.
- [ ] Run `npm run api:test`.
- [ ] Run `git diff --check`.
- [ ] Record any Docker/browser environment limitation explicitly.
