# PRD: Staging Backend Deployment

## Summary

Yaskapp currently runs its API and supporting services on a developer machine.
The Flutter client reaches the API through a local network IP, which is useful
for development but unsuitable for repeatable testing across devices. This
project will introduce a staging environment with a stable HTTPS API and
WebSocket endpoint.

## Goals

- Provide a stable staging API reachable outside the developer LAN.
- Keep PostgreSQL, Redis, and S3-compatible media storage available to the API.
- Run database migrations explicitly and safely during deployment.
- Configure Flutter for staging without changing application source code.
- Protect staging secrets and avoid development credentials in the deployed
  environment.
- Verify the existing MVP flow with an automated and manual smoke checklist.
- Document rollback and service recovery procedures.

## Non-goals

- Production deployment and production traffic.
- Multi-region or multi-node high availability.
- Kubernetes or a full CI/CD platform migration.
- Push notifications, background workers, or new product features.
- Migrating existing local development data to staging.

## User Stories

- As a developer, I can open the Flutter app on a phone without connecting it
  to the developer computer's Wi-Fi.
- As a tester, I can use a stable staging URL to verify auth, polls, votes,
  likes, comments, profiles, and real-time updates.
- As an operator, I can deploy a new API version, run migrations, inspect
  health, and roll back a failed release.

## Functional Requirements

1. A staging host must run the Node.js API from `services/api`.
2. The API must bind to `0.0.0.0` inside the staging runtime.
3. The staging API must expose a stable HTTPS base URL.
4. The staging environment must expose a stable secure WebSocket URL using
   `wss://`.
5. A reverse proxy or equivalent edge service must terminate TLS and forward
   HTTP and WebSocket traffic to the API.
6. PostgreSQL must run as a persistent staging service with a named volume or
   managed storage.
7. Redis must run as a staging service reachable by the API over a private
   network.
8. S3-compatible storage must be configured with a staging bucket and
   non-development credentials.
9. Staging services must not expose PostgreSQL, Redis, or object-storage admin
   ports publicly unless explicitly required for operations.
10. The API must use a staging `DATABASE_URL`, `REDIS_URL`, and S3 settings.
11. `JWT_SECRET` must be supplied through the staging secret store or protected
    environment configuration and must not use the development default.
12. The deployment must run `npm run db:migrate` before starting a new API
    version.
13. A migration failure must prevent the new API version from being considered
    healthy.
14. The API must expose or document a health check that verifies process
    availability and required dependency connectivity.
15. API logs must be available through the host or deployment runtime without
    printing JWT secrets, passwords, or access tokens.
16. The staging deployment must restart the API after a process crash or host
    reboot.
17. Flutter must accept staging endpoints through
    `API_BASE_URL` and `API_WEBSOCKET_URL` dart defines.
18. A documented staging command must use the HTTPS API URL and `wss` WebSocket
    URL.
19. The staging environment must support register, login, poll creation,
    voting, liking, comments, profile loading, and real-time vote updates.
20. A staging smoke checklist must verify the core flows after deployment.
21. The deployment must document how to stop, restart, and inspect service
    status.
22. The deployment must document rollback to the previous API image or build.
23. Backups or export instructions must be documented for the staging database.
24. Development Docker Compose and local IP configuration must continue to work
    unchanged.

## Technical Direction

The first staging implementation should be provider-agnostic and use Docker
Compose on a single host:

```text
TLS reverse proxy
        |
Node.js API + WebSocket
   |        |        |
PostgreSQL Redis  S3-compatible storage
```

The API remains the source of truth for HTTP and WebSocket contracts. The
staging host may use a managed PostgreSQL/Redis provider instead of containers,
but the runtime URLs and private connectivity requirements remain the same.

## Configuration

The mobile app must be launched against staging with values similar to:

```powershell
flutter run `
  --dart-define=API_BASE_URL=https://api-staging.example.com `
  --dart-define=API_WEBSOCKET_URL=wss://api-staging.example.com/realtime
```

The exact domain is selected during implementation. No staging secrets may be
embedded in Flutter source code.

## Deployment Flow

1. Provision the staging host and DNS record.
2. Install Docker and configure the firewall for HTTPS only.
3. Provision the staging environment variables and secrets.
4. Start PostgreSQL, Redis, and object storage.
5. Run database migrations.
6. Build and start the API image.
7. Configure TLS and reverse-proxy WebSocket upgrades.
8. Run health checks and the staging smoke checklist.
9. Record the deployed version and migration status.

## Smoke Test Scope

- Register a new staging user.
- Log in and call the authenticated endpoint.
- Create a public poll.
- Vote and verify the updated count and percentages.
- Like and unlike the poll.
- Open comments and post a comment.
- Verify the comments count after refresh.
- Open the profile and My polls.
- Verify a real-time vote update from a second client.
- Confirm an invalid request returns a safe error.

## Acceptance Criteria

- Flutter connects to staging using only `--dart-define` values.
- The API is reachable through HTTPS from a phone on a different network.
- WebSocket connections use `wss://` and deliver vote updates.
- PostgreSQL, Redis, and storage survive an API restart.
- A fresh deployment runs migrations successfully before serving traffic.
- Secrets do not appear in source control or normal logs.
- The staging smoke checklist passes for the full MVP flow.
- A failed API deployment can be rolled back using documented steps.
- Local Docker development still starts with the existing Compose file.

## Observability and Operations

- Record API version, deployment time, and migration version.
- Keep structured API logs with request method, path, status, and duration.
- Add a basic uptime check for the HTTPS health endpoint.
- Define a simple staging data reset procedure for test accounts and polls.
- Document disk usage, database backup location, and log retention.

## Risks and Mitigations

- Staging secrets leak through logs or shell history: use a protected env file
  or secret store and redact sensitive values.
- A migration is not backward-compatible: run migrations before switching
  traffic and keep the previous API version available for rollback.
- WebSocket proxying is misconfigured: include a dedicated `wss` smoke check.
- Staging data grows without control: add retention or a documented reset job.
- The host IP changes: use DNS rather than a hard-coded address.

## Open Questions

- Which VPS or managed hosting provider should host staging?
- Should PostgreSQL and Redis run on the same host or use managed services?
- Which S3-compatible provider and staging bucket should be used?
- Which domain name will be assigned to the staging API?
- Should deployments be manual initially or triggered from a Git branch?
