# Account Deletion Operations

## Current runtime: application database

Self-service deletion is enabled by default (`ACCOUNT_DELETION_ENABLED=true`).
Keep `ACCOUNT_DELETION_JOURNAL_ENABLED=false`: acceptance, account access
revocation, cleanup steps, media manifest and outbox events are committed in
one transaction in the application's existing PostgreSQL database. Neither a
separate journal server nor cloud credentials are required. Redis and the
existing self-hosted media storage remain the application's usual dependencies.

The client verifies the password, explicitly confirms deletion with
`DELETE /auth/me`, and retains a limited status receipt. Acceptance immediately
revokes sessions and hides the account's content. The durable worker completes
the existing seven cleanup steps and removes the user row. A retry returns the
same operation. A process restart does not discard queued work.

## Deployment

The normal staging stack includes `account-deletion-worker`; no extra overlay
or journal env files are needed:

```sh
docker compose -f infra/docker/docker-compose.staging.yml up -d --build
docker compose -f infra/docker/docker-compose.staging.yml ps
docker compose -f infra/docker/docker-compose.staging.yml logs --since 15m api account-deletion-worker
```

The deployment runs database migrations before starting the API and worker.
The older `docker-compose.account-deletion.staging.yml` remains a compatibility
overlay for database-only deletion. If an old journal reconciler container
exists, stop that service before applying the updated stack; it is no longer
part of the deployment. Do not remove application or media volumes.

For local development, start the normal PostgreSQL, Redis and media services,
run the migrations and API, then run the worker in another terminal:

```sh
npm run db:migrate
npm run api:dev
# In another terminal, from services/api so dotenv reads its .env:
npm run account-deletion:worker
```

The staging API can temporarily stop accepting new deletions with the Compose
interpolation variable `ACCOUNT_DELETION_ENABLED=false`. Keep the worker running
to finish already accepted requests. Outside Compose the API reads the same
variable from its environment. `/health/ready` checks the usual application
services; a separate journal is not checked in database-only mode.

## Verification

Use a dedicated database whose name contains `test` and a dedicated media test
bucket. Set `DATABASE_URL` and `ACCOUNT_DELETION_TEST_DATABASE_URL` to that same
database, plus the test Redis/media configuration. Apply migrations and run:

```sh
cd services/api
node --import tsx --test --test-reporter spec src/modules/account-deletion/account-deletion.local.e2e.integration.test.ts
```

This test uses real runtime adapters without journal settings. It checks native
bearer sessions, browser cookies, blocked-account credentials, retries,
cross-instance access revocation, hidden content, API restart, all cleanup
steps, removed database rows, rejected login and retention.

## Closed moderation archive (30 days)

Migration `033_deleted_account_archive.sql` adds the archive, IP history,
archive access log, independent IP bans and ban action log to the application
database. Both self-service acceptance and administrative deletion snapshot
the record in the same transaction as the account closure. A failed closure
rolls the archive back; a repeated closure does not extend its expiry.

Superadmins see **Deleted accounts** and **IP bans** in the moderation panel.
Ordinary users and moderators have no archive/ban permission. Lists can be
searched by username, email or account UUID. Opening a record is audited; all
archive/ban API responses are marked `Cache-Control: no-store`. The browser
keeps no archive in local storage and clears displayed records on logout.

The archive contains account identifiers/profile text, recently recorded IPs,
related moderation cases, reported text content, report descriptions, notes,
sanctions and appeals as they stood at deletion. It excludes passwords,
password hashes, sessions, tokens, avatars, media objects and unreported
content. It cannot restore an account. Client deletion notices explain this
30-day exception.

IP encounters are recorded at successful registration/login and deletion
verification, with a rolling 30-day history. Old IPs and already deleted
accounts cannot be reconstructed retrospectively. IPv4-mapped IPv6 addresses
are normalized. The API trusts forwarding headers only from private,
link-local and loopback proxy peers; keep the API container private behind
Caddy, which establishes the client forwarding chain.

Archives are excluded from reads and ban creation at `expires_at`, even when
the cleanup worker is stopped. The existing worker purges expired archives,
their access logs and stale live IP history during its periodic retention
pass. That pass runs before optional independent-journal retention, so a
journal outage does not extend archive retention. Worker outages can delay
physical cleanup; keep the worker running and monitor its errors.

An IP ban can be created only for an address in an unexpired archive, with an
explicit reason. Blocking the operator's current address is rejected. Bans
and their action logs are independent of the archive and remain until revoked
in **IP bans**. Enforcement checks incoming API requests, including
registration/login and new realtime handshakes; existing upgraded connections
are not forcibly disconnected by this change. Health and deletion-only routes
remain available. A shared IP may belong to other people, so the UI asks for
explicit confirmation. This is an IP restriction, not proof of a person's
identity or a restriction on their future addresses.

Run the additional integration test using the same isolated environment:

```sh
node --import tsx --test --test-reporter spec src/modules/account-deletion/account-deletion.archive.integration.test.ts
```

## Backups and previous journal tooling

Deletion state now shares the application's database and backup lifecycle.
Restoring an older database backup also restores its older deletion state;
there is no independent replay guarantee in this mode. Apply the application's
backup and restore policy accordingly.

The independent PostgreSQL journal code and offline migration/restore tools
remain available for existing installations. They are not used in the normal
deployment. An installation deliberately retaining that older architecture must
explicitly set `ACCOUNT_DELETION_JOURNAL_ENABLED=true` and configure its journal
URL, identity, signing key and worker retention credentials; missing settings
fail closed. Historical separate-journal release drills in the smoke-test
record describe that optional architecture, not database-only acceptance.
