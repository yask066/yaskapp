# Architecture

Yaskapp is split into a Flutter mobile client, a Node.js API service, shared contracts, and local infrastructure.

## Core Domains

- Users and profiles
- Polls and voting
- Feed and discovery
- Comments and reactions
- Media uploads
- Notifications
- Real-time poll updates

## Backend Boundaries

The API service owns HTTP endpoints, WebSocket sessions, persistence, background jobs, and object storage integration.

PostgreSQL is the source of truth. Redis is used for caching hot poll/feed data, pub/sub fanout, rate limits, and queues.

### Realtime Notifications

Notification records and read state are persisted in PostgreSQL. Each API process publishes versioned recipient-scoped events to the shared Redis channel `yaskapp:realtime:v1`; every process forwards an event only to its own WebSocket connections for that recipient. All API replicas must use the same `REDIS_URL`.

Web and Flutter keep one notification store and WebSocket connection per authenticated session. A connection-ready event, reconnect, browser visibility change, or Flutter foreground resume triggers HTTP reconciliation. The inbox APIs remain authoritative when realtime delivery is missed. See [the realtime notifications runbook](realtime-notifications.md) and [the manual smoke checklist](realtime-notifications-smoke.md).

## Frontend Boundaries

The Flutter app is organized by feature. Shared models and contracts should stay aligned with `packages/shared`.
