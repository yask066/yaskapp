# Self-hosted PostgreSQL account deletion journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cloud-backed account-deletion journaling, backup upload, and log shipping with a separate owner-operated PostgreSQL journal and owner-controlled backups.

**Architecture:** Keep the application PostgreSQL as the live account database and deletion work queue. Add a dedicated journal PostgreSQL on a different physical machine, with signed append-only `prepared` and `accepted` entries, reconciliation, restore replay, and separate owner-controlled backups. Keep API responses and deletion status semantics unchanged; remove AWS/B2/Grafana Cloud dependencies from this workflow after importing any existing records.

**Tech Stack:** Fastify, TypeScript, Node.js `node:test`, PostgreSQL (`pg`), Docker Compose, Bash backup scripts, existing HMAC implementation, and the AWS S3 SDK only for the one-time legacy importer and existing self-hosted MinIO media storage.

**Spec:** `docs/superpowers/specs/2026-10-15-account-deletion-postgres-journal-design.md`

## Global Constraints

- The journal PostgreSQL runs on a separate owner-controlled physical machine and failure domain from the application PostgreSQL.
- The account-deletion runtime must not require AWS, Backblaze B2, or Grafana Cloud.
- Journal events contain only operation/user identifiers, state, timestamps, and integrity signature; never passwords, verification/session tokens, or user-generated content.
- Preserve the current API contract and status receipt behavior; return `202 Accepted` only after the application transaction and journal acceptance are durable.
- Journal unavailability, missing/invalid journal state, and unresolved restore state fail closed; do not fall back to the application database as the journal.
- Retain completed journal records for at least 35 days, application database backups for no more than 30 days, and unfinished operations until completion.
- Keep media storage on the existing self-hosted MinIO and retain Firebase Push behavior; neither is the journal or backup target.

## Review Focus

- **Journal outage before or after the application transaction:** no false `202`; accepted operations are reconciled. Pin in Tasks 3 and 8.
- **Prepared-only event after rollback or process loss:** do not silently replay or discard an unresolved intent. Pin in Tasks 4 and 8.
- **Missing, tampered, duplicate, or conflicting journal entries:** fail closed during read, import, or recovery. Pin in Tasks 2, 6, and 8.
- **Retention boundary and unfinished operation:** do not delete before day 35 or while unfinished. Pin in Task 5.
- **Restore from an older application backup:** accepted deletions are reapplied before API traffic opens. Pin in Tasks 4 and 8.

---

### Task 1: Provision the dedicated journal PostgreSQL schema and connection

**Files:**
- Create: `services/api/src/db/journal-migrations/001_account_deletion_journal.sql`
- Create: `services/api/src/db/migrate-account-deletion-journal.ts`
- Create: `services/api/src/config/account-deletion-journal-database.ts`
- Modify: `services/api/src/config/env.ts`
- Modify: `services/api/package.json`
- Test: `services/api/src/db/migrate-account-deletion-journal.test.ts`
- Test: `services/api/src/config/account-deletion-journal-database.test.ts`

**Interfaces:**
- Produce lazy `getAccountDeletionJournalDatabase(): pg.Pool` and `getAccountDeletionJournalRetentionDatabase(): pg.Pool` accessors, `checkAccountDeletionJournalDatabase(): Promise<{ connected: true; serverTime: string }>`, and `closeAccountDeletionJournalDatabase(): Promise<void>`. If deletion is disabled and the URLs are absent, app startup remains valid; calling an unconfigured accessor fails with `account_deletion_journal_unavailable`.
- Parse `ACCOUNT_DELETION_JOURNAL_DATABASE_URL` and `ACCOUNT_DELETION_JOURNAL_ID`; when `ACCOUNT_DELETION_ENABLED=true`, require both plus `ACCOUNT_DELETION_JOURNAL_HMAC_KEY` of at least 32 characters. Parse the separate `ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL` for the retention worker and require it when that job runs.
- Require TLS certificate verification (`sslmode=verify-full`) for production connections to the remote journal host; permit local test URLs only under test configuration.
- Create `account_deletion_journal_meta` and `account_deletion_journal_entries`. Entry columns: generated row ID, `operation_id`, `intent_id`, `user_id`, `state` (`prepared` or `accepted`), `accepted_at`, `deadline_at`, JSON payload, HMAC, and `created_at`; enforce unique `(state, operation_id, intent_id)`, at most one accepted row per operation, and an index by operation/state.
- The migration assumes pre-provisioned PostgreSQL roles: runtime role gets `SELECT, INSERT`, retention role gets only the documented retention operation, and neither application role gets `UPDATE` or unrestricted `DELETE`.

- [x] **Step 1: Add migration-runner tests**

  In `migrate-account-deletion-journal.test.ts`, add `journal_migrations_apply_in_order_with_checksums`, `modified_applied_journal_migration_fails`, and `failed_journal_migration_rolls_back`. Assert sorted names/checksums, an error for a changed checksum, and `ROLLBACK` without a migration-ledger insert after a failed SQL statement.

- [x] **Step 2: Run the focused migration tests and confirm they fail**

  Run from `services/api`:

  ```sh
  node --import tsx --test src/db/migrate-account-deletion-journal.test.ts
  ```

  Expected: FAIL because the runner and migration do not exist.

- [x] **Step 3: Implement the journal schema and independent migration runner**

  Use a separate migration ledger and advisory-lock ID from the application database migrations. The journal meta row records a stable journal ID; migration must not silently recreate a missing or different identity during recovery.

- [x] **Step 4: Add connection and environment tests**

  Add `valid_journal_urls_create_separate_pools`, `deletion_enabled_requires_journal_settings`, and `deletion_disabled_does_not_require_journal_settings`. Assert runtime and retention pools use their distinct URLs and partial config produces a Zod error only when the corresponding feature/job is enabled.

- [x] **Step 5: Run focused tests and commit**

  ```sh
  node --import tsx --test src/db/migrate-account-deletion-journal.test.ts src/config/account-deletion-journal-database.test.ts
  ```

  Expected: PASS. Commit as `feat: add dedicated account deletion journal database`.

### Task 2: Replace the S3 journal adapter with PostgreSQL

**Files:**
- Modify: `services/api/src/modules/account-deletion/account-deletion.journal.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.journal.test.ts`
- Use: `services/api/src/config/account-deletion-journal-database.ts`

**Interfaces:**
- Preserve `AccountDeletionJournalAcceptance`, `AccountDeletionJournalEntry`, and the exported operations consumed by the service, routes, retention worker, and restore command.
- Export `createAccountDeletionJournal({ database: Pick<Pool, 'query' | 'connect'>; signingKey: string; journalId: string }): AccountDeletionJournal` so unit tests can inject a database fake; production uses `getAccountDeletionJournalDatabase()`.
- Preserve `createJournalEntry()` and `verifyJournalEntry()` HMAC behavior; new runtime states are only `prepared` and `accepted`.
- Keep `AccountDeletionJournal` operations: `initialize`, `assertReady`, `writePrepared`, `writeAccepted`, `deletePrepared`, `deletePreparedIntent`, `deleteAccepted`, `cleanupStalePrepared`, `readAll`, and `close`. Remove `writeCheckpoint` and all checkpoint-client options.
- `readAll()` verifies every row's HMAC and database state, returns accepted entries for replay, and fails if a prepared entry has no matching accepted row. Conflicting duplicate states fail with the existing journal error codes.

- [x] **Step 1: Replace S3 tests with PostgreSQL-journal behavior tests**

  Add `journal_write_is_idempotent_for_identical_entry`, `journal_conflict_rejects_changed_entry`, `journal_read_rejects_tampered_hmac`, `journal_identity_must_match_initialized_id`, `accepted_requires_matching_prepared`, `prepared_only_blocks_inventory_read`, and `journal_close_closes_pool`. Assert duplicate identical inserts return one logical entry, conflicts and invalid inventory reject, and the injected pool is closed once.

- [x] **Step 2: Run the journal tests and confirm the new cases fail**

  ```sh
  node --import tsx --test src/modules/account-deletion/account-deletion.journal.test.ts
  ```

  Expected: FAIL because the PostgreSQL adapter is not implemented yet.

- [x] **Step 3: Implement the PostgreSQL journal repository**

  Use parameterized SQL and the dedicated pool. Writes insert the signed JSON/payload, read back the stored row, and compare its HMAC and identity before reporting success. `assertReady()` checks the persistent journal identity without creating it.

- [x] **Step 4: Remove runtime checkpoint and S3 journal behavior**

  Remove `S3Client` construction, bucket prefixes, Object Lock assumptions, checkpoint reads/writes, and `ACCOUNT_DELETION_JOURNAL_*_ENDPOINT` settings from this module. Keep `@aws-sdk/client-s3` in package dependencies because the app still uses it for MinIO media.

- [x] **Step 5: Run focused tests and commit**

  ```sh
  node --import tsx --test src/modules/account-deletion/account-deletion.journal.test.ts
  ```

  Expected: PASS. Commit as `feat: persist deletion journal in PostgreSQL`.

### Task 3: Preserve acceptance semantics and fail readiness when the journal is unavailable

**Files:**
- Modify: `services/api/src/modules/account-deletion/account-deletion.service.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.routes.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.acceptance-protocol.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.acceptance-protocol.test.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.routes.test.ts`
- Modify: `services/api/src/modules/health/health.routes.ts`
- Test: `services/api/src/modules/health/health.routes.test.ts`

**Interfaces:**
- Keep acceptance order `writePrepared → commitDatabase → writeAccepted` and keep `202 Accepted` gated on all three completing.
- Keep status-token behavior and status endpoint response unchanged. Status reconciliation writes the accepted event to the PostgreSQL journal and returns `503 account_deletion_unavailable` if that cannot be confirmed.
- When `ACCOUNT_DELETION_ENABLED=true`, `/health/ready` checks the journal's `assertReady()` in addition to application PostgreSQL, Redis, and media storage. With deletion disabled, journal readiness is not required for unrelated app startup.

- [x] **Step 1: Add failing tests for both journal failure points and readiness**

  Add `prepare_failure_never_commits_application_transaction`, `accepted_failure_never_confirms_request`, `status_returns_503_when_journal_cannot_confirm`, and `ready_requires_journal_only_when_deletion_enabled`. Assert event order, `202` is never returned after either failure, and `/health/ready` returns `503` only for an enabled deletion feature with an unavailable journal.

- [x] **Step 2: Run focused tests and confirm they fail**

  ```sh
  node --import tsx --test src/modules/account-deletion/account-deletion.acceptance-protocol.test.ts src/modules/account-deletion/account-deletion.routes.test.ts src/modules/health/health.routes.test.ts
  ```

  Expected: FAIL on the new failure and readiness assertions.

- [x] **Step 3: Wire acceptance and status to the PostgreSQL journal**

  Preserve the existing database transaction boundary and public response/status contracts. Do not add a fallback journal in the application database.

- [x] **Step 4: Add journal readiness to `/health/ready`**

  Run the journal check only when deletion is enabled; return the existing generic unavailable response and log the underlying error without credentials or journal payloads.

- [x] **Step 5: Run focused tests and commit**

  Expected: all commands in Step 2 pass. Commit as `fix: fail closed when deletion journal is unavailable`.

### Task 4: Reconcile accepted operations and gate restore replay

**Files:**
- Modify: `services/api/src/modules/account-deletion/account-deletion.journal.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.restore.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.restore.test.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.restore.integration.test.ts`
- Modify: `services/api/src/jobs/export-account-deletion-journal.ts`
- Modify: `services/api/src/jobs/reapply-account-deletions.ts`
- Modify: `services/api/package.json`

**Interfaces:**
- Expose `readAcceptedDeletionsFromJournal(): Promise<AccountDeletionJournalEntry[]>` backed only by the dedicated PostgreSQL.
- Replace `exportAcceptedDeletionsToJournal()` with or adapt it as `reconcileAccountDeletionJournal(executor): Promise<{ reconciled: number; journalEntries: number }>`; it repairs accepted application rows missing from the journal and fails on owner/timestamp conflicts.
- Keep `reapplyAcceptedDeletions(entries, database)` idempotent. The restore command must verify the complete journal before applying entries and exit nonzero on any inconsistency.

- [x] **Step 1: Add failing reconciliation and replay tests**

  Add `reconcile_restores_missing_accepted_entry`, `reconcile_fails_on_journal_outage`, `restore_rejects_duplicate_operation_or_user`, `restore_rejects_invalid_signature`, and `restore_replay_is_idempotent`. Assert a valid accepted DB row is inserted once, all listed corrupt states reject before replay, and the second replay does not create duplicate steps/events.

- [x] **Step 2: Run focused tests and confirm they fail**

  ```sh
  node --import tsx --test src/modules/account-deletion/account-deletion.restore.test.ts src/modules/account-deletion/account-deletion.restore.integration.test.ts
  ```

  Expected: FAIL for missing PostgreSQL reconciliation and integrity cases.

- [x] **Step 3: Implement journal reconciliation**

  Read accepted operations from the application DB, write/reverify their matching `prepared` entry before inserting any missing signed `accepted` entry idempotently, then compare all eligible operations against the complete verified journal inventory. Do not remove or auto-resolve unresolved `prepared` records.

- [x] **Step 4: Adapt restore replay to read PostgreSQL journal entries**

  Reapply all accepted deletions to the restored application DB. Keep API traffic and the worker stopped until this command succeeds; update the command output to include the number of verified/reapplied entries and use nonzero exit on failure.

- [x] **Step 5: Run focused tests and commit**

  Expected: all commands in Step 2 pass. Commit as `feat: reconcile and replay PostgreSQL deletion journal`.

### Task 5: Enforce journal retention without cloud Object Lock

**Files:**
- Modify: `services/api/src/modules/account-deletion/account-deletion.journal.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.retention.ts`
- Modify: `services/api/src/modules/account-deletion/account-deletion.retention.test.ts`
- Create: `services/api/src/db/journal-migrations/002_account_deletion_journal_retention.sql`
- Test: `services/api/src/modules/account-deletion/account-deletion.journal.permissions.integration.test.ts`

**Interfaces:**
- The retention process selects application operations with `status = 'completed'` and `accepted_at <= now - 35 days`, then calls a journal database retention function with only those operation IDs. The function itself enforces the 35-day journal timestamp boundary before deleting accepted and matching prepared entries.
- Unfinished accepted operations are never removed. Unresolved prepared-only intents are retained for operator reconciliation rather than silently pruned.
- Use the restricted journal retention role only for the eligible delete function; the API runtime role remains unable to delete rows. Add a new migration rather than editing the already-applied `001` migration.

- [x] **Step 1: Add failing boundary and role tests**

  Add `completed_entry_expires_at_day_35`, `completed_entry_younger_than_35_days_is_retained`, `unfinished_entry_never_expires`, and `runtime_role_cannot_update_or_delete_journal`. Assert only completed entries at or before the 35-day cutoff are pruned; verify the permission case against the dedicated test journal DB.

- [x] **Step 2: Run the retention tests and confirm they fail**

  ```sh
  node --import tsx --test src/modules/account-deletion/account-deletion.retention.test.ts src/modules/account-deletion/account-deletion.journal.permissions.integration.test.ts
  ```

  Expected: FAIL for the journal PostgreSQL role and age boundary behavior.

- [x] **Step 3: Implement cross-database retention**

  Keep the application database's existing retention of completed operation rows at day 35. Delete journal rows only after the application query proves the operation is completed and past the same boundary; never use unconditional journal cleanup.

- [x] **Step 4: Run retention tests and commit**

  Expected: PASS. Commit as `feat: retain deletion journal records for 35 days`.

### Task 6: Import existing cloud journal records for cutover

**Files:**
- Create: `services/api/src/jobs/import-account-deletion-cloud-journal.ts`
- Create: `services/api/src/jobs/import-account-deletion-cloud-journal.test.ts`
- Create: `services/api/src/modules/account-deletion/account-deletion.legacy-s3-journal.ts`
- Modify: `services/api/package.json`
- Modify: `services/api/src/modules/account-deletion/account-deletion.journal.ts`

**Interfaces:**
- Add `importLegacyAccountDeletionJournal(source, target): Promise<{ prepared: number; accepted: number; conflicts: number }>`; the importer reads legacy journal and checkpoint stores read-only and writes only to the new PostgreSQL journal.
- Verify legacy HMACs before import. Import `prepared` and `accepted` entries, validate legacy checkpoints against accepted entries, and do not create a new accepted entry from an invalid or checkpoint-only record.
- Make duplicate identical imports idempotent. Abort on same operation/state with different user, timestamps, intent, or signature.

- [x] **Step 1: Add importer tests with in-memory legacy stores and a fake PostgreSQL target**

  Add `legacy_import_accepts_empty_inventory`, `legacy_import_preserves_valid_entries`, `legacy_import_is_idempotent`, `legacy_import_rejects_invalid_hmac`, `legacy_import_rejects_missing_prepared_or_checkpoint`, and `legacy_import_rejects_conflicting_operation`. Assert no target write occurs for an invalid or conflicting source inventory. Keep a `LegacyAccountDeletionJournalEntry` type and checkpoint HMAC validation in the migration-only adapter; runtime entries remain `prepared`/`accepted` only.

- [x] **Step 2: Run importer tests and confirm they fail**

  ```sh
  node --import tsx --test src/jobs/import-account-deletion-cloud-journal.test.ts
  ```

  Expected: FAIL because the importer does not exist.

- [x] **Step 3: Implement the read-only legacy adapter and importer**

  Keep legacy S3 access isolated to this one-time command. Print only counts and operation IDs; never print user credentials, tokens, journal payloads, or HMAC keys.

- [x] **Step 4: Run importer tests and commit**

  Expected: PASS. Commit as `feat: import legacy deletion journal into PostgreSQL`.

### Tasks 1–6 retrospective verification (2026-10-18, Europe/Minsk)

The implementation and required test cases for Tasks 1–6 are present in the
task commits. Focused verification on the current branch passed: Task 1, 8/8;
Task 2, 9/9; Task 3, 23/23; Task 4, 11/11; Task 5, 10/10; Task 6, 6/6.
API typecheck passed. The first Task 3 attempt inherited `CORS_ORIGINS` from
the developer `.env` and failed one cookie-origin assertion; rerunning with the
test's configured `http://localhost:5173` origin passed all 23 tests. Original
pre-implementation RED console output was not retained in the task ledger; the
Step 2 checkboxes record retrospective completion based on the committed test
and implementation changes, while the counts above record current GREEN runs.

### Task 7: Replace cloud deployment and backup paths with self-hosted operations

**Files:**
- Create: `infra/docker/docker-compose.account-deletion-journal.yml`
- Modify: `infra/docker/docker-compose.account-deletion.staging.yml`
- Modify: `infra/docker/backup-postgres.sh`
- Create: `infra/docker/backup-account-deletion-journal.sh`
- Delete or replace: `infra/docker/docker-compose.account-deletion-observability.yml`
- Delete or replace: `infra/grafana/account-deletion.alloy`
- Modify: `services/api/.env.example`
- Create: `services/api/.env.account-deletion-journal.example`
- Create: `services/api/.env.account-deletion-journal-retention.example`
- Delete: `services/api/.env.account-deletion-cloud.staging.example`
- Delete: `services/api/.env.account-deletion-retention.example`
- Modify: `services/api/package.json`
- Delete: `services/api/src/jobs/upload-staging-backup.ts`
- Delete: `services/api/src/jobs/upload-staging-backup.test.ts`

**Interfaces:**
- Deploy the journal PostgreSQL compose file on its own physical host with a persistent volume, private-IP-only host binding, health check, and separate runtime/retention credentials. Require `sslmode=verify-full` from API hosts.
- Mount operator-provisioned PostgreSQL TLS certificates into the journal host deployment and require TLS for remote connections.
- Main API compose receives only `ACCOUNT_DELETION_JOURNAL_DATABASE_URL`, `ACCOUNT_DELETION_JOURNAL_ID`, and `ACCOUNT_DELETION_JOURNAL_HMAC_KEY`; it does not start the journal DB beside the application DB.
- Runtime and retention env examples are `services/api/.env.account-deletion-journal.example` and `services/api/.env.account-deletion-journal-retention.example`.
- Backup scripts create and verify local PostgreSQL dumps, enforce maximum 30-day retention, and copy them to an owner-controlled `BACKUP_REPLICA_DIR` mounted from separate/offline storage without cloud credentials. Fail if the configured replica directory is missing or not mounted. Journal backups run on or connect to the journal host and are copied to storage separate from that host.
- Remove the AWS S3 backup uploader, Grafana Cloud Alloy overlay, cloud journal/checkpoint env keys, and cloud storage check. Do not remove `@aws-sdk/client-s3`; media still uses self-hosted MinIO.

- [ ] **Step 1: Add deployment and backup tests**

  Add `infra/docker/backup-postgres.test.sh` with stubbed `docker`, `pg_restore`, and filesystem paths. Assert journal compose has a persistent volume and health check without a public host port; backup scripts verify dump readability and copied checksums, reject retention above 30 days, fail when `BACKUP_REPLICA_DIR` is not mounted, and never invoke the AWS uploader.

- [ ] **Step 2: Run focused tests and validate Compose files before implementation changes**

  ```sh
  bash infra/docker/backup-postgres.test.sh
  docker compose -f infra/docker/docker-compose.staging.yml config --quiet
  ```

  Expected: the replica-destination assertions fail before the backup refactor; base Compose config parses.

- [ ] **Step 3: Add the separate-host journal PostgreSQL deployment**

  Include documented role bootstrap and migration commands. Do not add the journal service as a dependency of the main application Compose stack.

- [ ] **Step 4: Replace cloud backup upload with owner-controlled backup copies**

  Keep local backup verification and the 30-day retention bound. Produce and verify an independent backup for the journal database as well as the main database.

- [ ] **Step 5: Remove account-deletion cloud overlays and config**

  Update example env files and scripts, remove the cloud uploader/observability services and cloud checks, and keep the ordinary self-hosted MinIO media config intact.

- [ ] **Step 6: Run focused tests and Compose validation; commit**

  ```sh
  bash infra/docker/backup-postgres.test.sh
  docker compose -f infra/docker/docker-compose.staging.yml config --quiet
  docker compose -f infra/docker/docker-compose.account-deletion-journal.yml config --quiet
  ```

  Expected: PASS. Commit as `ops: self-host account deletion journal and backups`.

### Task 8: Cut over operations docs and run local release checks

**Files:**
- Modify: `docs/account-deletion-operations.md`
- Modify: `docs/account-deletion-smoke-test.md`
- Modify: `services/api/src/modules/account-deletion/account-deletion.e2e.integration.test.ts`
- Modify: `services/api/src/jobs/account-deletion-staging-storage-check.ts`
- Modify: `services/api/src/jobs/account-deletion-staging-storage-check.test.ts`

**Interfaces:**
- The e2e integration test requires dedicated test application and journal PostgreSQL databases, Redis, and test media storage; it must not require AWS, B2, or Grafana Cloud credentials.
- Replace cloud storage readiness checks with journal PostgreSQL connectivity, identity, role, and retention checks.
- Document first-time journal initialization, legacy import, API/worker cutover, backup/restore of both databases, restore replay before traffic, and local log/health-check operations.

- [ ] **Step 1: Add or update e2e assertions for PostgreSQL journal behavior**

  Name the tests `e2e_acceptance_persists_prepared_and_accepted_rows`, `e2e_journal_outage_rejects_acceptance`, and `e2e_restore_replays_deletion_before_readiness`. Assert acceptance writes both journal states, closes sessions across API nodes, completes worker cleanup, permits re-registration with a new user ID, rejects the outage case without `202`, and keeps the restored account closed before readiness is enabled.

- [ ] **Step 2: Run the focused e2e tests against dedicated local test services**

  ```sh
  node --import tsx --test src/modules/account-deletion/account-deletion.e2e.integration.test.ts
  ```

  Expected before implementation: FAIL on the new PostgreSQL-journal assertions when local test services are configured. Without those services, report a clear skip reason; never fall back to cloud services.

- [ ] **Step 3: Replace cloud staging checks and update operations documentation**

  Document that a restore keeps API traffic and the worker stopped until `account-deletion:journal-reapply` verifies and reapplies every accepted deletion. State that journal errors and unresolved prepared records require operator action.

- [ ] **Step 4: Run the complete API verification set and cutover checks**

  ```sh
  npm run api:typecheck
  npm run test -w @yaskapp/api
  docker compose -f infra/docker/docker-compose.staging.yml config --quiet
  docker compose -f infra/docker/docker-compose.account-deletion-journal.yml config --quiet
  ```

  Expected: all tests pass; Compose configs parse; a config scan finds no AWS/B2/Grafana Cloud credentials or endpoints in the account-deletion runtime. The S3 endpoint for MinIO media is expected and remains self-hosted.

- [ ] **Step 5: Commit the release docs without a live staging drill**

  The live staging restore drill, shared-staging acceptance, separate physical journal-host check, and two-replica run are excluded from this task. Keep them recorded as `NOT RUN` in `docs/account-deletion-smoke-test.md`; they are not completion criteria. Commit the operations and test documentation after the local release checks pass as `docs: document PostgreSQL journal cutover and restore checks`.

