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

## Frontend Boundaries

The Flutter app is organized by feature. Shared models and contracts should stay aligned with `packages/shared`.
