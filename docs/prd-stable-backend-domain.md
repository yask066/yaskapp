# PRD: Stable Backend Domain and VPS Deployment

## Summary

Yaskapp currently connects the Flutter application to the backend through a
developer-machine IP address. This is suitable for local development but is
fragile for phone testing and unsuitable for a closed release. This project
will deploy the backend to a stable VPS or managed host and expose HTTP and
WebSocket endpoints through a domain with HTTPS.

The existing local Docker Compose workflow must remain available for
development. The mobile application must select the environment through
`--dart-define`, without requiring source-code changes when switching between
local, staging, and production-like environments.

## Goals

- Make the backend reachable without the developer computer's local IP.
- Provide stable HTTPS and secure WebSocket endpoints for mobile clients.
- Run the existing Node.js API and required infrastructure on a remote host.
- Keep PostgreSQL, Redis, and object storage private from the public internet.
- Make deployments, migrations, health checks, and rollback repeatable.
- Keep local development unchanged.
- Verify the existing MVP flows from a real phone over the deployed domain.

## Non-goals

- Implementing new product features such as subscriptions or admin tools.
- High availability, multi-region deployment, or Kubernetes.
- Full zero-downtime deployment orchestration.
- Migrating local development data into the remote environment.
- Publishing the application to public app stores.

## User Stories

- As a developer, I can run the Flutter app on a phone without connecting to
  the developer computer's Wi-Fi.
- As a tester, I can use one stable API URL for authentication, polls, votes,
  likes, comments, profiles, and real-time updates.
- As an operator, I can deploy a new backend version, run migrations, inspect
  health, and recover from a failed deployment.
- As a maintainer, I can continue using the local Docker Compose environment
  without depending on the remote host.

## Functional Requirements

1. The backend must run on a VPS or managed host with a persistent hostname.
2. DNS must point an API subdomain to the deployment host.
3. The API must bind to `0.0.0.0` inside its runtime environment.
4. The deployment must expose a stable HTTPS base URL, for example
   `https://api.example.com`.
5. The deployment must expose a secure WebSocket URL using `wss://`, for
   example `wss://api.example.com/realtime`.
6. A reverse proxy or equivalent edge service must terminate TLS and forward
   both HTTP and WebSocket traffic to the API.
7. TLS certificates must renew automatically or have a documented renewal
   procedure.
8. Only required public ports, normally `80` and `443`, may be open on the
   host. SSH access must be restricted where the provider supports it.
9. PostgreSQL, Redis, and object-storage administration ports must not be
   publicly exposed.
10. The API must use remote environment-specific values for `DATABASE_URL`,
    `REDIS_URL`, S3 settings, and `JWT_SECRET`.
11. Production-like secrets must not be committed to source control, embedded
    in Flutter source, or printed in logs.
12. The deployment must run `npm run db:migrate` before accepting traffic from
    a new API version.
13. A failed migration or failed health check must stop the deployment from
    being marked healthy.
14. The API must expose a health endpoint that verifies process availability
    and required dependency connectivity.
15. The API process must restart after a crash and after a host reboot.
16. Logs must include request status and duration while redacting passwords,
    JWTs, cookies, and storage credentials.
17. Flutter must accept `API_BASE_URL` and `API_WEBSOCKET_URL` through
    `--dart-define`.
18. Flutter must not require a source change to switch between local and
    deployed endpoints.
19. The deployed backend must support register, login, authenticated profile
    loading, poll creation, voting, liking, comments, and real-time vote
    updates.
20. A deployment smoke test must verify the core flows from a phone or an
    external client.
21. The deployment must document start, stop, restart, status, logs, and
    migration commands.
22. The deployment must document rollback to the previous API image or build.
23. The remote database must have documented backup and restore instructions.
24. The existing local Docker Compose setup and local API configuration must
    continue to work.

## Technical Direction

The first implementation should use Docker Compose on a single VPS with a
reverse proxy:

```text
Internet
   |
DNS -> TLS reverse proxy
          |
       Node.js API + WebSocket
          |        |        |
      PostgreSQL  Redis  S3-compatible storage
```

The reverse proxy may be Caddy, Nginx, or an equivalent managed edge service.
The choice must support WebSocket upgrades and automatic HTTPS. PostgreSQL,
Redis, and object storage should use private Docker networks or managed
services with private connectivity.

## Configuration

Local development remains configurable with the existing defaults. A deployed
Flutter build must receive its endpoints explicitly:

```powershell
flutter run `
  --dart-define=API_BASE_URL=https://api.example.com `
  --dart-define=API_WEBSOCKET_URL=wss://api.example.com/realtime
```

The exact domain is selected during implementation. The API must not depend on
the developer's LAN address after deployment.

## Deployment Flow

1. Select a VPS or managed host and configure the firewall.
2. Register a domain or subdomain and create the DNS record.
3. Install Docker and the reverse proxy on the host.
4. Provision protected environment variables and production-like secrets.
5. Start PostgreSQL, Redis, and object storage with persistent volumes or
   managed equivalents.
6. Run database migrations and verify migration status.
7. Build and start the API image.
8. Configure TLS and verify HTTP and WebSocket proxying.
9. Run health checks and the external smoke test.
10. Build Flutter with the deployed HTTPS and `wss` endpoints.
11. Record the deployed version, migration version, and recovery instructions.

## Smoke Test Scope

- Open the HTTPS health endpoint from outside the developer LAN.
- Register a test account and log in.
- Load the authenticated profile.
- Create a poll.
- Vote and verify the updated count and percentages.
- Like and unlike the poll.
- Open comments and post a comment.
- Verify a real-time vote update from a second client.
- Restart the API and confirm data remains available.
- Confirm an invalid request returns a safe error.
- Confirm the Flutter phone build connects without the computer's IP address.

## Acceptance Criteria

- The mobile app works against the deployed domain from a phone on a separate
  network.
- All HTTP requests use HTTPS and all real-time connections use `wss://`.
- No Flutter source change is needed when switching environments.
- The backend survives an API restart without losing database or media data.
- PostgreSQL, Redis, and storage admin ports are not publicly reachable.
- Secrets are absent from source control and normal logs.
- Migrations run before a new API version is considered healthy.
- The complete smoke-test checklist passes.
- A failed deployment can be rolled back using documented commands.
- Local Docker Compose still starts and serves the local API.

## Risks and Mitigations

- **DNS or TLS misconfiguration:** verify DNS, certificate validity, and
  WebSocket upgrades before building the phone client.
- **Exposed infrastructure ports:** use a firewall and bind internal services
  only to private Docker networks.
- **Data loss on a small VPS:** enable persistent volumes and test backups and
  restore before closed testing.
- **Breaking migrations:** review migrations, back up before applying them, and
  keep the previous API build available for rollback.
- **Unexpected hosting costs:** set provider billing alerts and resource
  limits.
- **Endpoint accidentally hard-coded again:** require explicit environment
  configuration in the release build and add a configuration test.

## Open Questions

- Which domain and API subdomain should be used?
- Which VPS or managed provider will host the environment?
- Should PostgreSQL, Redis, and object storage run on the VPS or use managed
  services?
- Should this first deployment be called `staging` or `production`?
- Which reverse proxy should be standardized for the project?
- How will secrets be stored and rotated?
- How frequently should database backups run, and where should they be kept?

## Suggested Implementation Tasks

1. Choose the host, domain, and environment names.
2. Add deployment Compose files and a reverse-proxy configuration.
3. Add a documented environment/secrets template without real credentials.
4. Configure DNS, firewall, TLS, and WebSocket forwarding.
5. Deploy infrastructure and API, then run migrations.
6. Verify health, logs, persistence, backups, and restart recovery.
7. Run the external HTTP and WebSocket smoke tests.
8. Build and test Flutter with `--dart-define` endpoints.
9. Document rollback and operational commands.
