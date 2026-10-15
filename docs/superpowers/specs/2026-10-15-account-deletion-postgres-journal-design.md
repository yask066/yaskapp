# Account deletion with a self-hosted PostgreSQL journal

**Status:** Approved in conversation; awaiting review of this written specification.
**Date:** 2026-10-15
**Scope:** Account-deletion acceptance, recovery, retention, backups, and operational visibility.

## Goal

Remove third-party cloud dependencies from the account-deletion workflow. Store
the durable deletion journal in a dedicated PostgreSQL instance operated by the
project owner. Keep deletion processing recoverable after failures of the main
application database, including restores from older backups.

The existing application PostgreSQL database remains the source of live account
state and the work queue used by the deletion worker. The journal PostgreSQL
instance is a separate, self-hosted service on a different physical machine and
failure domain. No AWS, Backblaze B2, or Grafana Cloud service is required at
runtime.

## Approved architecture

### Main application database

- Continue to store deletion operations, progress steps, retry state, and the
  queue consumed by `account-deletion-worker` in the existing application
  PostgreSQL database.
- Continue to close the account and invalidate its sessions in the existing
  database transaction when deletion is accepted.
- Keep the API and worker independently deployable as they are today.

### Dedicated journal PostgreSQL

- Deploy a PostgreSQL instance on a separate, owner-controlled machine.
- Connect to it using a dedicated database role and authenticated encrypted
  transport.
- Store deletion journal events in an append-only table. The API role can
  insert and read records for reconciliation; a separate restricted retention
  role can remove eligible completed records. Runtime application roles cannot
  update or delete journal entries.
- Journal entries contain the operation ID, user ID, event state, accepted and
  deadline timestamps, and integrity signature. They must not contain
  passwords, verification tokens, session tokens, or user-generated content.
- Preserve integrity verification with the existing HMAC approach. A
  external checkpoint store is removed; durability of the dedicated
  PostgreSQL journal is provided by its own backup and recovery procedure.

### Backups and operational visibility

- Back up the application database to owner-controlled storage on a separate
  node or removable/offline medium. Encrypt backups and verify restoration
  regularly.
- Back up the journal PostgreSQL instance separately from the application
  database and separately from its host. Keep the journal's recovery copy
  available before restoring an older application database.
- Retain completed journal entries for at least 35 days and application
  database backups for no more than 30 days. Keep unfinished deletion records
  until their operations complete. The 35-day and 30-day values are accepted
  for this design but remain subject to the product's retention-policy review.
- Remove AWS/B2 backup upload configuration and the optional Grafana Cloud log
  shipping overlay from the account-deletion runtime. Initially rely on
  structured local container logs and Docker health checks. A self-hosted
  dashboard or alerting service is outside this implementation scope.

## Acceptance protocol

Keep the existing externally visible API contract and status token behavior.
Accept a deletion in this order:

1. Write and verify a signed `prepared` event in the journal PostgreSQL.
2. In one transaction in the application PostgreSQL, close the account,
   invalidate sessions, and persist the deletion operation and work steps.
3. Write and verify a signed `accepted` event in the journal PostgreSQL.
4. Return `202 Accepted` only after both databases confirm their writes.

The account-deletion worker continues to perform the cleanup from the
application database. Its steps remain idempotent and retryable. A periodic
reconciler compares accepted application operations with journal records and
repairs missing `accepted` events after a process failure between steps 2 and
3.

If the journal is unavailable, the API must not accept new deletion operations.
An ambiguous response is resolved using the existing operation receipt and
status endpoint; it must not be interpreted as proof that deletion did or did
not start.

## Restore and recovery behavior

Restoring the application database from an older backup can restore account
rows that were deleted after that backup. Therefore:

- Keep API traffic and deletion processing closed during a database restore.
- Before opening traffic, run a recovery command that verifies the journal
  inventory and reapplies every accepted deletion to the restored database.
- Fail closed if the journal is missing, cannot be verified, or is incomplete.
  Do not reinitialize an absent journal identity marker during recovery.
- Preserve unresolved `prepared` events for operator reconciliation. They are
  ambiguous because the application transaction may have committed before a
  process failure; recovery must not silently discard them.
- Reopen API traffic only after reconciliation succeeds and the deletion worker
  is healthy.

The journal itself is recoverable from its separate owner-controlled backup.
Loss of both the journal host and its recovery copy is an operator recovery
incident and blocks account-deletion acceptance until the intended journal is
restored.

## Migration and cutover

1. Inspect the active cloud journal and checkpoint inventories, if configured.
2. Export existing `prepared`, `accepted`, and checkpoint records once and
   import the relevant signed records into the new journal PostgreSQL.
3. Verify record counts, operation IDs, states, signatures, and retention
   deadlines. Do not enable deletion if the import has conflicts or missing
   accepted records.
4. Point API, worker, reconciler, and recovery tooling at the self-hosted
   PostgreSQL journal and run a restore/reconciliation exercise before enabling
   new deletion requests.
5. Remove AWS/B2/Grafana Cloud runtime configuration, credentials, upload jobs,
   and observability overlays from the account-deletion deployment.

If no active cloud records exist, the export/import step is empty. Any existing
provider-side immutable records are retired according to their current
retention constraints; the application no longer reads or writes them after
cutover.

## Security and failure handling

- Keep the journal PostgreSQL network-private and accessible only to the API,
  worker/reconciler, and controlled operator tooling.
- Separate application, retention, and operator credentials. Do not expose
  journal credentials to clients or include them in logs.
- Treat loss of journal connectivity as a deletion-acceptance outage, not as a
  reason to fall back to the main database.
- Treat signature failures, operation conflicts, unresolved prepared events,
  and missing journal inventory as recovery blockers requiring operator
  review.
- Ensure the worker never reports completion until every required cleanup step
  has succeeded.

## Verification expectations for implementation

- Unit and integration coverage for journal writes, signature verification,
  append-only role permissions, duplicate delivery, reconciliation, and
  retention cleanup.
- Failure-injection coverage for journal outage before prepare, main database
  outage after prepare, journal outage after the application transaction, and
  worker retry after restart.
- A restore exercise from an application backup that predates an accepted
  deletion; verify that reconciliation removes the restored account before API
  traffic opens.
- A journal recovery exercise from its owner-controlled backup.
- Configuration checks confirming that AWS, B2, and Grafana Cloud credentials
  and endpoints are not required by the account-deletion deployment.

## Out of scope

- Replacing the application's existing self-hosted MinIO media store.
- Replacing Firebase push delivery or other application integrations unrelated
  to journal persistence, deletion recovery, backup, and monitoring.
- Building a new self-hosted dashboard/alerting stack in the first cutover.
- Changing user-facing deletion API semantics or product retention policy
  beyond the approved 35-day journal and 30-day backup targets.
