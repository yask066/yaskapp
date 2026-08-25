# Moderation Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundation for user reports and a protected moderation case queue.

**Architecture:** Add PostgreSQL tables for reports and cases, create reports in one transaction with target validation and active-report deduplication, and expose a cursor-paginated moderation queue protected by server-side permissions. Keep the existing admin permissions stable and add a separate moderation permission namespace.

**Tech Stack:** Node.js, TypeScript, Fastify, Zod, PostgreSQL, `node:test`, `tsx`.

**Spec:** `docs/prd-moderation-web-panel.md` (Phase 1 and sections 6–8, 12–16).

## Global Constraints

- Ordinary users may create reports but must receive `403` for moderation queue endpoints.
- Backend authorization is mandatory; frontend visibility is not a security boundary.
- Duplicate active reports from the same reporter for the same target must not be created.
- Case creation and report creation must be atomic.
- Use parameterized SQL and cursor pagination; do not add offset pagination.
- Do not implement sanctions, appeals, or a web frontend in this phase.

---

### Task 1: Add reports and moderation cases schema

**Files:**
- Create: `services/api/src/db/migrations/010_moderation_reports.sql`
- Test: `services/api/src/modules/moderation/moderation.integration.test.ts`

**Interfaces:**
- Produces tables `reports`, `moderation_cases`, and `moderation_case_reports`.
- Produces indexes for active duplicate reports, active target cases, queue status/priority, and created timestamps.

- [ ] **Step 1: Write integration assertions for persisted report/case data**

  The test will create a report through the API and query PostgreSQL to assert one report, one case, and one link row exist.

- [ ] **Step 2: Run the focused integration test and verify the schema is missing**

  Run from `services/api`: `node --import tsx --test --test-reporter spec src/modules/moderation/moderation.integration.test.ts`.

- [ ] **Step 3: Create migration 010**

  Use text columns with check constraints for `target_type`, report category, report status, case status, and priority. Add partial unique indexes for active duplicate reports and active cases per target.

- [ ] **Step 4: Run migration and focused test**

  Run `npm run db:migrate`, then rerun the focused test and confirm the persisted rows are created.

### Task 2: Add moderation permissions

**Files:**
- Modify: `services/api/src/modules/auth/permissions.ts`
- Test: `services/api/src/modules/auth/permissions.test.ts`

**Interfaces:**
- Add `ModerationPermission` and `Permission` types.
- Add `moderationPermissionsForRole(role: string)`.
- Update `requirePermission` to accept both admin and moderation permissions.

- [ ] **Step 1: Add failing permission assertions**

  Assert that `user` has no moderation queue permission, `moderator` can read/assign/resolve cases, and `superadmin` has every moderation permission.

- [ ] **Step 2: Run permission tests and verify the new permission names fail**

  Run `node --import tsx --test --test-reporter spec src/modules/auth/permissions.test.ts`.

- [ ] **Step 3: Implement the separate moderation permission matrix**

  Preserve the existing `permissionsForRole` admin-capabilities output so the current Flutter contract does not change unexpectedly; use a combined internal resolver for authorization.

- [ ] **Step 4: Rerun permission tests and existing admin integration tests**

  Confirm both the new moderation assertions and existing admin capability expectations pass.

### Task 3: Implement report creation and deduplication

**Files:**
- Create: `services/api/src/modules/moderation/moderation.repository.ts`
- Create: `services/api/src/modules/moderation/moderation.service.ts`
- Create: `services/api/src/modules/moderation/moderation.routes.ts`
- Modify: `services/api/src/app.ts`
- Test: `services/api/src/modules/moderation/moderation.integration.test.ts`

**Interfaces:**
- `POST /reports` accepts `{ targetType, targetId, category, description }` for an authenticated user.
- A new report returns `201` with `{ report, case, deduplicated: false }`.
- An existing active report by the same reporter and target returns `200` with `{ report, case, deduplicated: true }`.
- Invalid or deleted targets return `404 not_found`; invalid bodies return `400 validation_error`.

- [ ] **Step 1: Add failing endpoint tests**

  Cover unauthenticated access, successful poll/comment/user reports, invalid category/description, missing target, duplicate active report, and report creation by a normal user.

- [ ] **Step 2: Run the focused integration test and verify the routes are missing**

  Run `node --import tsx --test --test-reporter spec src/modules/moderation/moderation.integration.test.ts`.

- [ ] **Step 3: Implement repository transaction**

  Lock the target row, verify it is reportable, find or create the active target case, insert the report, and insert the case link before `COMMIT`. Roll back all writes on any error.

- [ ] **Step 4: Implement service errors and Zod route validation**

  Use the existing `authenticate` middleware. Keep report creation available to authenticated `user`, `moderator`, and `superadmin`; do not use admin UI permissions for this public action.

- [ ] **Step 5: Register routes and rerun the focused tests**

  Confirm all report creation and deduplication assertions pass.

### Task 4: Implement cursor-paginated moderation queue

**Files:**
- Create: `services/api/src/modules/moderation/pagination.ts`
- Modify: `services/api/src/modules/moderation/moderation.repository.ts`
- Modify: `services/api/src/modules/moderation/moderation.service.ts`
- Modify: `services/api/src/modules/moderation/moderation.routes.ts`
- Test: `services/api/src/modules/moderation/moderation.integration.test.ts`

**Interfaces:**
- `GET /moderation/cases?status=&category=&priority=&assigneeId=&targetType=&limit=&cursor=`.
- Response is `{ items, nextCursor }`.
- Endpoint requires `moderation.queue.read`.

- [ ] **Step 1: Add failing queue tests**

  Assert `user` receives `403`, moderator receives a filtered list, `limit=1` returns a cursor, the next cursor returns the next page, and invalid cursor/date/filter values return `400`.

- [ ] **Step 2: Run the focused test to verify queue behavior is absent**

  Run `node --import tsx --test --test-reporter spec src/modules/moderation/moderation.integration.test.ts`.

- [ ] **Step 3: Implement repository query**

  Filter by status/category/priority/assignee/target type, order by priority rank then `created_at DESC, id DESC`, fetch `limit + 1`, and encode/decode the existing `{ createdAt, id }` cursor format.

- [ ] **Step 4: Implement route schemas and permission guard**

  Validate `limit` from 1 to 100, cursor length, enum filters, and UUID assignee. Return the existing consistent error shapes.

- [ ] **Step 5: Rerun queue tests and verify ordinary users remain blocked**

  Confirm cursor pagination and server-side authorization pass.

### Task 5: Add transaction and security regression coverage

**Files:**
- Modify: `services/api/src/modules/moderation/moderation.integration.test.ts`
- Modify: `services/api/src/modules/auth/permissions.test.ts`

**Interfaces:**
- Tests must prove report insert + case creation rollback together when the link/audit-side write fails.
- Tests must prove deleted/blocked users cannot create reports and ordinary users cannot read the moderation queue.

- [ ] **Step 1: Add failing rollback/security assertions**

  Use a database constraint failure after the report write and assert that neither report nor case remains. Add blocked-user and direct unauthorized queue requests.

- [ ] **Step 2: Run focused tests and confirm failures expose missing coverage/behavior**

  Run the moderation integration and permissions test files.

- [ ] **Step 3: Adjust only the implementation needed for atomicity and authorization**

  Keep mutations inside one client transaction and use the authenticated current-user status check.

- [ ] **Step 4: Run all backend tests**

  From the repository root run `npm run api:test` and require zero failures.

### Task 6: Update Phase 1 documentation and verification

**Files:**
- Modify: `docs/prd-moderation-web-panel.md`
- Create: `docs/moderation-reports-api.md`

- [ ] **Step 1: Document report and queue request/response examples**
- [ ] **Step 2: Document migration command and permission behavior**
- [ ] **Step 3: Run `npm run api:typecheck`, `npm run api:test`, and `git diff --check`**
- [ ] **Step 4: Record any environment limitation without claiming unrun tests passed**
