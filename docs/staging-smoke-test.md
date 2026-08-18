# Staging MVP Smoke Test

Run this checklist after deploying a new staging API version. Replace the
example domain with the real staging DNS name. The Flutter client must use the
same values through `--dart-define`.

## Configuration

```powershell
$baseUrl = 'https://api-staging.example.com'
$websocketUrl = 'wss://api-staging.example.com/realtime'
```

Start the mobile app with:

```powershell
flutter run `
  --dart-define=API_BASE_URL=$baseUrl `
  --dart-define=API_WEBSOCKET_URL=$websocketUrl
```

## Checklist

- [ ] `GET $baseUrl/health/ready` returns HTTP `200` with database, Redis, and
      storage status set to connected.
- [ ] Register a fresh staging user.
- [ ] Log in and confirm the Flutter home screen loads the feed.
- [ ] Create a public poll from Flutter and confirm it appears in the feed.
- [ ] Vote in the poll and verify the selected option, total votes, and
      percentages update without a full feed reload.
- [ ] Like the poll and unlike it; verify the count and icon update.
- [ ] Open the poll comments, post a comment, and confirm the comments count
      updates when returning to the feed.
- [ ] Open the profile and confirm the user profile and `My polls` load.
- [ ] From a second client, vote on the same poll and confirm the first client
      receives the real-time poll update over `wss://`.
- [ ] Submit an invalid comment or unauthenticated request and confirm the API
      returns a safe error without exposing secrets.
- [ ] Review API logs and confirm authorization headers, passwords, tokens,
      JWT secrets, and storage secrets are redacted.

## Operations

Inspect recent service logs from the staging host:

```bash
docker compose -f infra/docker/docker-compose.staging.yml logs --tail=100 api
docker compose -f infra/docker/docker-compose.staging.yml logs --tail=100 https
```

Docker rotates each service's JSON logs at 10 MB per file and keeps five files.
The API readiness endpoint checks PostgreSQL, Redis, and the MinIO bucket.

## Release Record

Run this checklist after the API image, migrations, and reverse proxy have
started successfully. Do not mark the deployment complete until every required
item passes and the release record contains `Result: PASS`.

Record these values with each staging verification:

```text
API version:
Database migration version:
Staging domain:
Smoke test date:
Tester:
Result:
```
