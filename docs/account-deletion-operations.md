# Account Deletion Operations

## Runtime

`account-deletion-worker` is a separate, continuously running Compose service. It
uses the API image and the same migrated PostgreSQL schema. Docker's
`unless-stopped` restart policy starts it again after process failure or host
reboot. Keep `ACCOUNT_DELETION_ENABLED=false` until the independent journal,
worker, alerts, and backup lifecycle are configured. Disabling new requests does
not stop this worker from finishing accepted operations.

The worker emits structured `account_deletion.metrics` records every minute.
Alert on `account_deletion.alert`, journal exporter failures, worker container
exits/restarts, and missing metrics for more than two minutes. Page the on-call
operator for retrying work older than one hour or a deadline breach. Inspect the
operation and step error code, repair the dependency, then allow the worker to
retry; do not mark work completed manually. Preserve logs without request
bodies, credentials, tokens, or journal payloads.

## Independent acceptance journal

The API writes one signed JSON object per operation to a separate S3-compatible
service before committing acceptance. The entry contains only operation ID,
user ID, accepted time, deadline, format version, and HMAC. If that write fails,
the PostgreSQL transaction rolls back and the API returns an unavailable error.
The journal endpoint must be independent of PostgreSQL backups and the media
bucket (separate storage service/account, credentials, and failure domain).

Configure these variables in the secret store used by both API and worker:

```text
ACCOUNT_DELETION_JOURNAL_ENDPOINT=https://<independent-object-store>
ACCOUNT_DELETION_JOURNAL_REGION=<region>
ACCOUNT_DELETION_JOURNAL_BUCKET=<private-journal-bucket>
ACCOUNT_DELETION_JOURNAL_ACCESS_KEY_ID=<write-and-list credential>
ACCOUNT_DELETION_JOURNAL_SECRET_ACCESS_KEY=<secret>
ACCOUNT_DELETION_JOURNAL_HMAC_KEY=<at-least-32-random-characters>
```

Give API credentials read, list, and write access to the journal prefix. Restrict
deletion and lifecycle administration to a separate operator role. Enable bucket
versioning and protect current objects from deletion for at least 35 days. Do
not configure expiration shorter than 35 days. Keep the HMAC key in the secret
manager separately from PostgreSQL and object-store credentials; preserve it
for the full journal retention window and rotate only with an overlap procedure.
Never copy journal objects into the main database backup.

`account-deletion-journal-exporter` runs every five minutes while deletion is
enabled. Alert on its failure log. The
`npm run account-deletion:journal-export -w @yaskapp/api` command reconciles
every accepted PostgreSQL row with the independent journal on demand. These
exports are repair/check mechanisms; the synchronous write in the acceptance
transaction is what protects the gap before the next export.

## Retention

`backup-postgres.sh` rejects a local backup retention setting above 30 days. Keep
the staging dumps in protected storage outside the staging host as well as the
validated local copy. Configure the external backup bucket's lifecycle to expire
current and noncurrent dump versions no later than 30 days. Keep the latest
seven daily and four weekly recovery points within that 30-day window.

The media bucket must retain active current objects. For a versioned MinIO
bucket, enable versioning and expire only noncurrent versions after 30 days; do
not set current-object expiry on the live media bucket. For example, with an
`mc` alias named `staging`, apply once and verify with `mc ilm rule ls`:

```sh
mc version enable staging/$S3_BUCKET
mc ilm rule add staging/$S3_BUCKET --noncurrent-expire-days 30 --expire-delete-marker
```

For a separate backup bucket, configure expiry for both current dumps and
noncurrent versions at 30 days. Verify lifecycle rules after applying them and
include the result in the staging restore record. The journal bucket is separate
and must retain records for at least 35 days.

The worker removes expired permission hashes and completed operation records
after their configured 35-day retention, and minimal moderation identifiers
after 30 days. The independent journal outlives the 30-day backup window.

## Restore gate

Treat every database or media restore as a traffic-blocking maintenance event.
Do not expose API traffic while data is being restored or journal reapply is
running. If the journal service or HMAC key is unavailable, stop; do not start
API/web traffic against the restored snapshot.

1. Stop `https`, `web`, `moderation-web`, `api`, and both worker services. Keep
   PostgreSQL and object storage available for the restore.
2. Restore PostgreSQL and the matching media snapshot, then run migrations.
3. Use the newly built API image and restored database to reconcile the
   restored accepted rows against the journal, then replay the full journal:

   ```sh
   docker compose -f infra/docker/docker-compose.staging.yml run --rm --no-deps api \
     node services/api/dist/jobs/export-account-deletion-journal.js
   docker compose -f infra/docker/docker-compose.staging.yml run --rm --no-deps api \
     node services/api/dist/jobs/reapply-account-deletions.js
   ```

   Export must exit zero before reapply may run. Reapply lists every journal object, checks its HMAC, key/ID agreement,
   timestamps, and duplicate IDs, and reopens every matching deletion as pending
   cleanup. It marks any surviving account row deleted, resets cleanup steps,
   and recreates the media manifest. It exits non-zero on missing credentials,
   incomplete listing, malformed or tampered data, owner mismatch, or database
   error. A zero exit and `reapplied` count equal to the verified journal entry
   count are required before traffic is opened.
4. Start `account-deletion-worker`, wait for it to become healthy in logs, then
   start API and frontends. Run the staging smoke test and check that deleted
   IDs remain invisible before removing the maintenance block.

Reapplying completed operations is intentional: a backup can predate the
cleanup, so every journal record is replayed as pending cleanup. The process is
idempotent and never relies on the former deletion token's expiry. Roll back an
application image by redeploying it against the restored/current database; do
not restore an old database to roll back application code.

## Staging restore exercise

Use a disposable account and a backup taken before its deletion. Accept deletion,
verify the independent journal object exists, restore the old database and
matching media snapshot while traffic is blocked, then run the reapply command.
Confirm the account is inaccessible before and after worker completion, all
cleanup steps complete, and repeating reapply does not create duplicate work.
Record the backup time, journal entry ID, command exit code, counts, worker
result, and smoke-test result. Never use a production account or open traffic
between restore and reapply.
