# Yaskapp

Social network focused on polls, voting, and real-time discussion.

## Stack

- Frontend: Flutter
- Backend: Node.js + TypeScript
- Database: PostgreSQL
- Cache and queues: Redis
- Object storage: S3-compatible storage
- Real-time: WebSocket

## Repository Layout

```text
apps/
  mobile/              Flutter client
services/
  api/                 Node.js API and WebSocket service
packages/
  shared/              Shared contracts and types
infra/
  docker/              Local infrastructure configuration
docs/                  Product and architecture notes
```

## Local Infrastructure

Copy the API env example and start the local dependencies:

```bash
cp services/api/.env.example services/api/.env
docker compose -f infra/docker/docker-compose.yml up -d
```

The initial Compose file starts PostgreSQL, Redis, and MinIO for local development.
The local stack remains separate from staging and continues to publish the
development ports `5432`, `6379`, `9000`, and `9001` for local tools.

The API also has a staging container definition. Copy the staging environment
example to `services/api/.env.staging`, fill in real staging credentials, and
replace `STAGING_API_DOMAIN` with a DNS name pointing to the staging host, then
start it from the repository root:

```bash
docker compose -f infra/docker/docker-compose.staging.yml up -d --build
```

Before a domain is available, set `STAGING_PUBLIC_IP` in
`services/api/.env.staging` to the VPS public IP. The staging stack then serves
the moderation panel at `http://<STAGING_PUBLIC_IP>/` (with the legacy
`/admin` path retained). Pass the same address to Flutter through
`API_BASE_URL` and `API_WEBSOCKET_URL`. This is an HTTP-only development
route; switch to the domain-based HTTPS configuration before production use.

PowerShell example:

```powershell
$env:YASKAPP_BACKEND_HOST = "5.44.44.197"
flutter run `
  --dart-define=API_BASE_URL="http://$env:YASKAPP_BACKEND_HOST" `
  --dart-define=API_WEBSOCKET_URL="ws://$env:YASKAPP_BACKEND_HOST/realtime"
```

The staging Compose flow runs the `migrate` job after PostgreSQL is healthy and
starts the API only after that job exits successfully.

API readiness is available at `/health/ready`. It returns `200` only when the
process, PostgreSQL, and Redis are ready; otherwise it returns `503`. Docker
uses this endpoint before allowing Caddy to depend on the API.

API logs use structured output and redact authorization/cookie headers,
passwords, tokens, JWT secrets, and S3/MinIO secret values. Do not add raw
request bodies or environment dumps to staging logs.

The staging services use `restart: unless-stopped`. They recover after a
process crash and after a host reboot when Docker is enabled at boot. Verify
recovery with:

```bash
docker compose -f infra/docker/docker-compose.staging.yml ps
docker compose -f infra/docker/docker-compose.staging.yml logs --tail=100 api
```

Staging service operations:

```bash
# Start or update the full staging stack
docker compose -f infra/docker/docker-compose.staging.yml up -d --build

# Inspect service state
docker compose -f infra/docker/docker-compose.staging.yml ps

# Follow API logs
docker compose -f infra/docker/docker-compose.staging.yml logs -f api

# Restart the API only
docker compose -f infra/docker/docker-compose.staging.yml restart api

# Stop the staging stack without deleting named volumes
docker compose -f infra/docker/docker-compose.staging.yml down
```

Staging API rollback:

```bash
# Before deploying, preserve the current image under a release tag
docker tag yaskapp-api:staging yaskapp-api:previous-2026-07-23

# Build and deploy the new API image
docker compose -f infra/docker/docker-compose.staging.yml up -d --build

# If the new release fails smoke testing, restore the previous image
docker tag yaskapp-api:previous-2026-07-23 yaskapp-api:staging
docker compose -f infra/docker/docker-compose.staging.yml up -d --no-build
```

Keep the previous image tag until the new release passes migrations, health
checks, and the staging smoke checklist.

Database backup and restore instructions are in
[docs/staging-database-backups.md](docs/staging-database-backups.md). The
PostgreSQL volume is persistent, but backups must be exported to protected
storage outside the repository.

If a migration fails, the job exits with a non-zero status. Because the API
depends on `migrate` with `service_completed_successfully`, the new API
container is not started and the deployment must be fixed or rolled back.

The resulting endpoints are:

```text
https://<STAGING_API_DOMAIN>
wss://<STAGING_API_DOMAIN>/realtime
```

Caddy terminates TLS on ports `80` and `443` and reverse-proxies both HTTP and
WebSocket traffic to the internal `api:3000` service. The API container is not
published directly to the host. PostgreSQL is also internal-only and persists
its data in the `postgres-staging-data` named volume.
Redis is also internal-only, uses `redis://redis:6379`, and persists its AOF
data in the `redis-staging-data` named volume.
MinIO provides the private S3-compatible staging storage and creates the
configured bucket through the `minio-init` service. Its data persists in the
`minio-staging-data` named volume.

Only Caddy publishes host ports in staging (`80` and `443`). PostgreSQL,
Redis, the MinIO API, and the MinIO console remain private to the Compose
network and are not reachable directly from the public internet.

The API service receives its staging dependencies from
`services/api/.env.staging`: `DATABASE_URL` points to `postgres`, `REDIS_URL`
points to `redis`, and the `S3_*` settings point to the private `minio`
service and the configured staging bucket.

`JWT_SECRET` must be replaced with a randomly generated value before starting
staging. The `.env.staging` file is ignored by Git, and production mode rejects
the development default or a `replace-with` placeholder.

## Database

The first schema migration is in `services/api/src/db/migrations/001_initial_social_schema.sql`.
It creates users, profiles, polls, poll options, votes, comments, likes, follows, and notifications.

Run migrations after PostgreSQL is available:

```bash
npm run db:migrate
```

Check the API database connection:

```bash
npm run db:check
```

## Auth MVP

Initial auth endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

Use the returned access token as a bearer token:

```http
Authorization: Bearer <accessToken>
```

## Flutter API Environment

The mobile app reads backend addresses at compile time. For a local phone run:

```bash
flutter run \
  --dart-define=API_BASE_URL=http://192.168.0.10:3000 \
  --dart-define=API_WEBSOCKET_URL=ws://192.168.0.10:3000/realtime
```

In PowerShell, use one line:

```powershell
flutter run --dart-define=API_BASE_URL=http://192.168.0.10:3000 --dart-define=API_WEBSOCKET_URL=ws://192.168.0.10:3000/realtime
```

Both values should point to the same backend environment.

For staging, replace the example domain with the real staging DNS name:

```powershell
flutter run --dart-define=API_BASE_URL=https://api-staging.example.com --dart-define=API_WEBSOCKET_URL=wss://api-staging.example.com/realtime
```

Use [docs/staging-smoke-test.md](docs/staging-smoke-test.md) to verify the
complete MVP flow after a staging deployment. A staging release is complete
only after the checklist passes and its release record is filled in.
