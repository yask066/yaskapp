# Notifications Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a secure, persistent backend notifications inbox with cursor pagination, unread counts, read mutations, and duplicate protection.

**Architecture:** Extend the existing PostgreSQL `notifications` table with an application-generated deduplication key. Add a focused notifications repository and authenticated Fastify routes; all reads are scoped to `request.user.sub`, and mutations are idempotent.

**Tech Stack:** Fastify, TypeScript, PostgreSQL, node:test, existing auth and database helpers.

**Spec:** `docs/prd-notifications.md`

## Global Constraints

- Do not add domain-event producers in Phase 1; those belong to Phase 2.
- Use opaque cursor pagination ordered by `created_at DESC, id DESC`.
- Never accept recipient identity from the client.
- Return only notification data owned by the authenticated user.
- Preserve existing migration immutability: add a new migration file.

### Task 1: Migration and repository contracts

**Files:**
- Create: `services/api/src/db/migrations/003_notifications_foundation.sql`
- Create: `services/api/src/modules/notifications/notifications.repository.ts`
- Create: `services/api/src/modules/notifications/notifications.repository.test.ts`

- [x] Write failing repository tests for deduplicated insert, cursor listing, unread count, mark-one-read, and mark-all-read.
- [x] Run the focused tests and verify they fail because the repository is missing.
- [x] Add the migration with nullable `deduplication_key`, unique partial index, and cursor/unread indexes.
- [x] Implement repository methods using parameterized SQL and existing pool helpers.
- [x] Run focused repository tests against PostgreSQL.

### Task 2: Authenticated HTTP API

**Files:**
- Create: `services/api/src/modules/notifications/notifications.routes.ts`
- Modify: `services/api/src/app.ts`
- Create: `services/api/src/modules/notifications/notifications.integration.test.ts`

- [x] Write failing endpoint tests for list, unread filter, read-one, read-all, ownership, invalid cursor/limit, and unauthenticated requests.
- [x] Register the notifications routes with the app.
- [x] Implement validation, stable error responses, and idempotent mutations.
- [x] Return `items`, `nextCursor`, and `unreadCount` from list.
- [x] Run endpoint tests and the full API test suite.

### Task 3: Documentation and verification

**Files:**
- Modify: `docs/database.md`
- Modify: `docs/prd-notifications.md`

- [x] Document the new deduplication key and Phase 1 endpoint status.
- [x] Run formatting, typecheck, migration, focused tests, full tests, and `git diff --check`.
- [x] Review the diff for ownership leaks, offset pagination, and pre-commit side effects.
