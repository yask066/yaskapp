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
  --dart-define=API_BASE_URL=http://192.168.0.5:3000 \
  --dart-define=API_WEBSOCKET_URL=ws://192.168.0.5:3000/realtime
```

In PowerShell, use one line:

```powershell
flutter run --dart-define=API_BASE_URL=http://192.168.0.5:3000 --dart-define=API_WEBSOCKET_URL=ws://192.168.0.5:3000/realtime
```

Both values should point to the same backend environment.
