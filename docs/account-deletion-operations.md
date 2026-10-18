# Account Deletion Operations

## Runtime and health

The application PostgreSQL stores live account state and the deletion work
queue. A separate owner-operated PostgreSQL server on another physical host
stores the signed account-deletion journal. The API and worker require the
journal at runtime; journal failure blocks new acceptance. The journal is never
stored in or substituted with the application database. Media remains on the
existing self-hosted MinIO service.

Keep `ACCOUNT_DELETION_ENABLED=false` until the journal has been initialized,
legacy records (if any) have been imported and checked, the backups are
verified, and the restore drill has passed. The API's `/health/ready` endpoint
checks the journal connection and identity when deletion is enabled. It also
checks application PostgreSQL, Redis, and media storage. `/health` is a basic
process liveness check; use `/health/ready` before routing traffic.

The worker emits structured `account_deletion.metrics` records and
`account_deletion.alert` errors to local container logs. Inspect the API,
worker, and journal-reconciler logs locally. Alert on worker/reconciler exits,
repeated retries, overdue work, and missing worker heartbeats using the host's
Docker health and log monitoring. Do not put request bodies, credentials,
tokens, user content, or journal payloads in logs or evidence.

```sh
docker compose -f infra/docker/docker-compose.staging.yml ps
docker compose -f infra/docker/docker-compose.staging.yml logs --since 15m api
docker compose \
  -f infra/docker/docker-compose.staging.yml \
  -f infra/docker/docker-compose.account-deletion.staging.yml \
  logs --since 15m account-deletion-worker account-deletion-journal-reconciler
curl --fail-with-body http://127.0.0.1:3000/health/ready
curl --fail-with-body http://127.0.0.1:3000/health/metrics
```

## Local integration-test services

The dedicated local stack provides the application test database, an independent
journal test database, Redis, and RustFS as an S3-compatible media test server.
It is not the staging stack: every service publishes ports only on `127.0.0.1`
and uses volumes under the `yaskapp-account-deletion-test` Compose project.
Production/staging media remains on the configured self-hosted MinIO service.

The three `services/api/.env.*` files used below are local test credentials and
are git-ignored. Do not copy them to staging or use their database URLs outside
this Compose project.

```sh
docker compose \
  --env-file services/api/.env.staging \
  --env-file services/api/.env.account-deletion-journal \
  --env-file services/api/.env.account-deletion-journal-retention \
  -f infra/docker/docker-compose.account-deletion-test.yml up -d
docker compose \
  --env-file services/api/.env.staging \
  --env-file services/api/.env.account-deletion-journal \
  --env-file services/api/.env.account-deletion-journal-retention \
  -f infra/docker/docker-compose.account-deletion-test.yml ps
curl --fail-with-body http://127.0.0.1:59000/health
```

The mapped ports are app PostgreSQL `55432`, journal PostgreSQL `55433`, Redis
`56379`, RustFS S3 API `59000`, and RustFS console `59001`. The test stack has
separate app and journal credentials, plus independent journal runtime and
retention roles. Run migrations and the journal role/identity check before the
integration suite; create only the named test bucket in the local S3 service.

## First-time journal provisioning

Run the journal Compose file only on its separate physical host. Bind PostgreSQL
to that host's private interface, provision its TLS certificate/key/CA files,
and restrict network access to the API, worker, and operator hosts. Do not add
this PostgreSQL service to the application Compose stack.

```sh
docker compose -f infra/docker/docker-compose.account-deletion-journal.yml config --quiet
docker compose -f infra/docker/docker-compose.account-deletion-journal.yml up -d
docker compose -f infra/docker/docker-compose.account-deletion-journal.yml ps
```

Create separate `account_deletion_journal_runtime` and
`account_deletion_journal_retention` roles on the journal host. The runtime role
can read and append entries but cannot update, delete, truncate, or prune them. The retention
role can invoke only the 35-day completed-operation pruning function and has no
direct table update/delete grants. The schema migration requires a controlled
operator/admin database URL to create the schema and grants. The commands below
use a POSIX shell from the repository root. Load the restricted connection
settings into the process environment; the scripts use `dotenv/config`, which
otherwise reads `.env` from the process working directory. Source the base
staging environment too; `env.ts` requires application PostgreSQL, Redis, and
media settings even for journal utilities. Before replay, verify that
`DATABASE_URL` points to the restored application database; do not rely on a
developer `.env` file. Keep the admin URL in a short-lived shell variable,
never in a service env file:

```sh
set -a
. services/api/.env.staging
. services/api/.env.account-deletion-journal
set +a
export ACCOUNT_DELETION_JOURNAL_ADMIN_DATABASE_URL='postgres://...'
ACCOUNT_DELETION_JOURNAL_DATABASE_URL="$ACCOUNT_DELETION_JOURNAL_ADMIN_DATABASE_URL" npm run account-deletion:journal-migrate -w @yaskapp/api
npm run account-deletion:journal-init -w @yaskapp/api
npm run build -w @yaskapp/api
set -a
. services/api/.env.account-deletion-journal-retention
set +a
node services/api/dist/jobs/account-deletion-staging-storage-check.js
```

Set `ACCOUNT_DELETION_JOURNAL_DATABASE_URL`, a stable
`ACCOUNT_DELETION_JOURNAL_ID`, and an HMAC key of at least 32 characters in
`services/api/.env.account-deletion-journal`. The connection URL must use
`sslmode=verify-full` and a hostname covered by the journal server certificate.
Set `ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL` only in
`services/api/.env.account-deletion-journal-retention` on the worker host. Keep
the HMAC key separate from both database hosts and backups. The staging check
confirms connectivity, the stored identity, the append-only runtime role, and
the restricted retention role/function. It does not initialize or repair a
missing identity. Run it on the worker host, where both restricted connection
files are available; do not copy the retention credential to API hosts. A
missing or different identity requires operator recovery.

The database migration creates the identity row. Do not rerun initialization
with a new identity after journal data exists. An empty, newly provisioned
journal may be initialized once with the intended stable ID.

## Legacy journal import and cutover

If the previous cloud journal contains records, export/import them once before
enabling new deletion requests. The importer reads legacy journal and checkpoint
objects, validates their signatures and inventory, and writes to the new
PostgreSQL journal. It is the only cutover command that needs the old S3
credentials; those credentials are not used by the account-deletion API or
worker after import.

1. Keep `ACCOUNT_DELETION_ENABLED=false` and stop the old deletion worker,
   exporter, and new acceptance traffic.
2. Provision and migrate the new journal database, set the intended journal ID
   and HMAC key, and run the staging storage check.
3. For the one-time import process only, supply the legacy
   `ACCOUNT_DELETION_JOURNAL_ENDPOINT`, bucket, access key, checkpoint endpoint,
   checkpoint bucket, and read-only credentials alongside the new PostgreSQL
   journal settings. Run:

   ```sh
   set -a
   . services/api/.env.staging
   . services/api/.env.account-deletion-journal
   set +a
   npm run account-deletion:journal-import-legacy -w @yaskapp/api
   ```

4. Record the import counts and compare prepared/accepted counts and operation
   IDs with the old inventory. An incomplete, tampered, duplicate-conflicting,
   or checkpoint-only record aborts import and blocks cutover. Do not delete or
   alter the legacy inventory until the new journal and restore drill are
   verified.
5. Remove the temporary cloud variables and old credentials from API/worker
   hosts. The importer code remains migration-only; runtime journal reads use
   PostgreSQL exclusively.

Copy `services/api/.env.account-deletion-journal.example` to
`services/api/.env.account-deletion-journal` on each API host, and copy the
retention example only to the deletion worker. Keep both files out of Git. The
base staging stack can run with deletion disabled. After import and all release
checks pass, deploy the account-deletion overlay to start the worker and
periodic journal reconciler, and enable the API feature:

```sh
docker compose -f infra/docker/docker-compose.staging.yml config --quiet
docker compose \
  -f infra/docker/docker-compose.staging.yml \
  -f infra/docker/docker-compose.account-deletion.staging.yml config --quiet
docker compose \
  -f infra/docker/docker-compose.staging.yml \
  -f infra/docker/docker-compose.account-deletion.staging.yml up -d --build
```

The reconciler compares accepted application operations with the journal every
five minutes. Check its local logs and `/health/ready` before enabling new
acceptance. Do not add cloud backup credentials, cloud log shipping, or a
checkpoint service to the runtime configuration. The application's
S3-compatible media client continues to use the self-hosted MinIO endpoint.

## Backups and retention

Back up the application database on the application host with
`infra/docker/backup-postgres.sh`. Back up the journal database on its own host
with `infra/docker/backup-account-deletion-journal.sh`. Each script creates a
custom PostgreSQL dump, encrypts it with the operator-managed
`BACKUP_ENCRYPTION_KEY_FILE`, verifies that the encrypted copy can be decrypted
and listed by `pg_restore`, copies it to a mounted `BACKUP_REPLICA_DIR` on
separate/offline storage, and verifies matching SHA-256 checksums. A missing
replica mount, key, or valid dump fails the job and leaves the existing backup
files in place. Keep local and replica database backup retention at 30 days or
less. Store and recover the encryption key independently of the hosts and
replicas.

Journal entries are retained for at least 35 days. The application retention
worker removes journal entries only after the corresponding operation is
completed and older than 35 days; unfinished operations and unresolved
prepared-only intents require operator action and are retained. Never prune a
journal entry manually to clear an alert.

Schedule and monitor both backup jobs independently. Record their timestamps,
dump checks, replica checksums, and restore test results. A journal backup must
be recoverable independently of the application database host and its local
storage.

## Restore gate

Treat a restore as a traffic-blocking maintenance event. Keep public routing,
API, web clients, and the account-deletion worker stopped until the journal has
been verified and every accepted deletion has been replayed. If the journal,
its backup, the expected identity, or the HMAC key is unavailable, stop and
resolve that incident before opening traffic.

1. Stop API/web traffic and the account-deletion worker and reconciler. Leave
   PostgreSQL services available for restore operations.
2. Restore the application database and, if required, restore the journal
   database from its separate owner-controlled backup. Restore journal roles
   and TLS configuration first. Confirm the restored journal ID matches
   `ACCOUNT_DELETION_JOURNAL_ID`; do not create a replacement identity during
   recovery.
3. With the API and worker still stopped, use the restored application DB and
   the verified journal to replay all accepted deletions:

   ```sh
   set -a
   . services/api/.env.staging
   . services/api/.env.account-deletion-journal
   set +a
   npm run account-deletion:journal-reapply -w @yaskapp/api
   ```

   The command verifies every journal row present and its HMAC before replay,
   exits nonzero on conflicting or unresolved journal state, and reports
   verified and reapplied counts. Compare that inventory with the independently
   recorded accepted-operation inventory for the backup. A valid HMAC on the
   remaining rows does not prove that a backup contains every accepted entry;
   stop if the inventories differ. Require exit code zero and matching counts
   before proceeding. Every restored account covered by an accepted
   record must be closed and queued for cleanup before readiness is checked or
   traffic is opened. An unresolved prepared-only record blocks recovery and
   requires operator reconciliation.
4. Start the deletion worker and reconciler, verify their health/logs and
   `/health/ready`, then restore API and frontend traffic. Run the staging
   smoke test and confirm deleted account IDs and content remain inaccessible.

Replaying completed records is intentional: an application backup may predate
acceptance or cleanup. Replay is idempotent and resumes cleanup without using
the expired deletion token.

## Staging restore drill

Use a disposable account and an application backup captured before its
acceptance. Keep API traffic and the worker stopped, restore the application
backup, run `account-deletion:journal-reapply`, and verify the account remains
closed before starting API traffic. Then start the worker, verify cleanup
completes, and repeat replay to check idempotence. Record the backup time,
operation ID, journal identity, command exit code and counts, worker result,
and smoke-test result in `docs/account-deletion-smoke-test.md`. Never use a
production account or open traffic between restore and replay.
