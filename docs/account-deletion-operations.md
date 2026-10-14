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

The API writes a signed `prepared` entry before the database commit. After the
commit succeeds, it writes an `accepted` entry to the journal and a matching
checkpoint to a second S3-compatible service. The API confirms acceptance only
after both writes have been read back. A `prepared` entry without an `accepted`
entry is ambiguous because the database commit may have succeeded before the
process failed. Restore fails closed while any such intent is within the
35-day backup window. Both stores must be
independent of PostgreSQL backups and each other (separate storage services,
accounts, credentials, and failure domains).

Configure these variables in the secret store used by both API and worker:

```text
ACCOUNT_DELETION_JOURNAL_ENDPOINT=https://<independent-object-store>
ACCOUNT_DELETION_JOURNAL_REGION=<region>
ACCOUNT_DELETION_JOURNAL_BUCKET=<private-journal-bucket>
ACCOUNT_DELETION_JOURNAL_ACCESS_KEY_ID=<write-and-list credential>
ACCOUNT_DELETION_JOURNAL_SECRET_ACCESS_KEY=<secret>
ACCOUNT_DELETION_JOURNAL_ID=<stable-unique-deployment-identity>
ACCOUNT_DELETION_JOURNAL_HMAC_KEY=<at-least-32-random-characters>
ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ENDPOINT=https://<independent-checkpoint-store>
ACCOUNT_DELETION_JOURNAL_CHECKPOINT_REGION=<region>
ACCOUNT_DELETION_JOURNAL_CHECKPOINT_BUCKET=<private-checkpoint-bucket>
ACCOUNT_DELETION_JOURNAL_CHECKPOINT_ACCESS_KEY_ID=<write-and-list credential>
ACCOUNT_DELETION_JOURNAL_CHECKPOINT_SECRET_ACCESS_KEY=<secret>
```

For this staging deployment, use the non-secret key names and endpoint templates
in `services/api/.env.account-deletion-cloud.staging.example`: Backblaze B2's
S3-compatible endpoint for the journal, AWS S3 for the checkpoint, and a separate
AWS backup bucket. Keep checkpoint and backups in separate AWS accounts when
possible; they must not share a failure domain with the B2 journal. A bucket
name or endpoint check cannot prove account ownership, so record the AWS account
IDs during provisioning. Enable bucket versioning and Object Lock in COMPLIANCE
mode with default retention of at least 35 days for both journal and checkpoint.
Do not attach a lifecycle expiration rule to either journal prefix.

After credentials and buckets are ready, run the read-only configuration check:

```sh
docker compose -f infra/docker/docker-compose.staging.yml run --rm --build --no-deps api \
  node services/api/dist/jobs/account-deletion-staging-storage-check.js
```

It verifies S3 API access, versioning, default Object Lock retention, and backup
lifecycle rules. It does not upload/delete probe objects, prove separate cloud
accounts, or exercise recovery. Those still require the staging restore exercise.

Initialize the stable identity markers once, before enabling account deletion:

```sh
npm run account-deletion:journal-init -w @yaskapp/api
```

Do not reinitialize a missing marker during recovery. Its absence means the
configured store is uninitialized, replaced, or incomplete and must block
traffic until the intended store is restored.

Give API credentials read, list, and write access to the journal and checkpoint
prefixes, including Object Lock retention on writes. Copy
`services/api/.env.account-deletion-retention.example` to
`services/api/.env.account-deletion-retention.staging` and set separate
read/list-versions/delete-versions credentials there; Compose passes that file
to the deletion worker and retention exporter. The role must not write or alter
retention.
Enable versioning and S3 Object Lock in compliance mode on both buckets. Keep
`prepared`, accepted, and checkpoint records locked for 35 days from acceptance.
The retention worker removes unresolved prepared-only intents after the backup
window and removes accepted/checkpoint records only for completed operations
after the lock expires; it never removes unfinished accepted records. Do not add
an unconditional lifecycle rule to these prefixes.
Alert on any retention worker error. Preserve the HMAC key separately from both
stores and rotate only with an overlap procedure. Never copy journal objects into
the database backup.

`account-deletion-journal-exporter` runs every five minutes, including while
new deletion requests are disabled. It reconciles completed PostgreSQL rows into
both stores before applying the 35-day retention cleanup. Alert on its failure
log. The
`npm run account-deletion:journal-export -w @yaskapp/api` command reconciles
every accepted PostgreSQL row with both stores on demand. Recovery verifies the
entire journal/checkpoint inventory, so a pre-acceptance database backup still
detects a missing journal record. This check assumes each store's compliance
retention and independent failure domain remain intact.

## Staging Configuration

Copy `services/api/.env.staging.example` to
`services/api/.env.staging`, replace every `replace-with-*` value, and keep the
result out of Git. Provision PostgreSQL, Redis, and media credentials for the
staging host. Configure the journal and checkpoint endpoints as separate
services/accounts/failure domains, then use
`services/api/.env.account-deletion-retention.example` to create
`services/api/.env.account-deletion-retention.staging` with read/list/delete
versions credentials that cannot write or change retention. Keep
`ACCOUNT_DELETION_ENABLED=false` until the independent stores, identity markers,
Object Lock, backup lifecycle, and monitoring have passed the checks below.

Copy `.env.account-deletion-cloud.staging.example` to
`.env.account-deletion-cloud.staging` and fill it with the B2 journal, AWS
checkpoint, and AWS backup credentials. Copy
`.env.grafana-cloud.staging.example` to `.env.grafana-cloud.staging` and set a
Grafana Cloud Loki URL, stack/tenant ID, and a token restricted to log writes.
Do not commit either file. AWS checkpoint and backup credentials should be
scoped separately; record account IDs to demonstrate the configured failure
domains.

Check the Compose file before applying it:

```sh
docker compose -f infra/docker/docker-compose.staging.yml config --quiet
```

Validate and start the Grafana Cloud log shipping overlay together with staging:

```sh
docker compose \
  -f infra/docker/docker-compose.staging.yml \
  -f infra/docker/docker-compose.account-deletion-observability.yml config --quiet
docker compose \
  -f infra/docker/docker-compose.staging.yml \
  -f infra/docker/docker-compose.account-deletion-observability.yml up -d
```

The overlay sends only the account-deletion worker and journal-exporter stdout
through the host-local syslog port to Alloy. Alloy has no Docker socket mount and
only reads those two service streams. Configure a Grafana Cloud contact point
and Grafana-managed Loki alert rules for:

* Any failure event, evaluated every minute with no pending delay:
  `sum(count_over_time({job="account-deletion"} |~ "account_deletion.alert|Account deletion journal export failed|Account deletion worker batch failed" [5m]))`
  greater than zero.
* Missing worker heartbeat, evaluated every minute with a 2-minute window:
  `sum(count_over_time({job="account-deletion", service="account-deletion-worker"} |= "account_deletion.metrics" [2m]))`
  below one. Set the rule's No Data behavior to Alerting so a stopped log
  pipeline also raises an alert.
* Any failure to finish an exporter run: use the failure query above. Missing
  exporter heartbeat, evaluated every minute with a 10-minute window:
  `sum(count_over_time({job="account-deletion", service="account-deletion-journal-exporter"} |= "account_deletion.journal_exporter.complete" [10m]))`
  below one. The exporter writes a success marker every five minutes. Set No
  Data behavior to Alerting and alert on worker/exporter container restarts at
  the VPS level as well.

Route all three rules to the staging on-call contact point. Test the contact
point from Grafana Cloud, then produce a staging-only worker alert and confirm
receipt before enabling account deletion. Grafana Cloud's Loki endpoint/token
does not create alert rules or contact points automatically; record their IDs
and the test delivery result in the staging evidence.

After installing the journal and checkpoint credentials, initialize the two
identity markers once and confirm readiness while deletion remains disabled.
Do not copy example credentials or placeholder URLs into a live staging
deployment.

## Retention

`backup-postgres.sh` rejects a local backup retention setting above 30 days. Keep
the staging dumps in protected storage outside the staging host as well as the
validated local copy. After verifying the local dump, `backup-postgres.sh` sends
it to the configured AWS S3 backup bucket and verifies uploaded size and SHA-256
metadata before pruning local copies. A failed upload fails the backup job and
leaves the local dump in place. Configure the external backup bucket's lifecycle
to expire current and noncurrent dump versions no later than 30 days. Keep the latest
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
include the result in the staging restore record. Both independent journal
stores use Object Lock for accepted records and checkpoints; the retention worker
removes them after 35 days only when the operation is completed.

The worker removes expired permission hashes and completed operation records
after their configured 35-day retention, and minimal moderation identifiers
after 30 days. The independent journal outlives the 30-day backup window.

## Restore gate

Treat every database or media restore as a traffic-blocking maintenance event.
Do not expose API traffic while data is being restored or journal reapply is
running. If either journal service or the HMAC key is unavailable, stop; do not start
API/web traffic against the restored snapshot.

1. Stop `https`, `web`, `moderation-web`, `api`, `notification-worker`,
   `account-deletion-worker`, and `account-deletion-journal-exporter`. Keep
   PostgreSQL and object storage available for the restore.
2. Restore PostgreSQL and the matching media snapshot, then run migrations.
3. Use the newly built API image and restored database to reconcile the
   restored accepted rows against the journal, then replay the full journal:

   ```sh
   docker compose -f infra/docker/docker-compose.staging.yml run --rm --no-deps --entrypoint node account-deletion-journal-exporter \
     services/api/dist/jobs/export-account-deletion-journal.js
   docker compose -f infra/docker/docker-compose.staging.yml run --rm --no-deps api \
     node services/api/dist/jobs/reapply-account-deletions.js
   ```

   Export must exit zero before reapply may run. It checks accepted rows in the
   restored database against the journal and compares the full journal ID set
   against the independently stored checkpoint set. This detects records missing
   from either store even when the restored database predates acceptance.
   Independently verify Object Lock retention and the journal object inventory
   before continuing. Reapply lists every journal object, checks its HMAC, key/ID agreement,
   timestamps, checkpoint completeness, and duplicate IDs, and reopens every matching deletion as pending
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
