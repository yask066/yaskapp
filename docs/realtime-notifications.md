# Realtime notifications operations

## Data flow

PostgreSQL is the durable source for inbox items, unread counts, and read state. A committed notification is read back as a complete `NotificationItem`, then published to Redis. Redis pub/sub carries the envelope `{ recipientUserId, event }` on `yaskapp:realtime:v1`. Each API process sends the event only to its local sockets for that recipient. Redis delivery is best effort; clients recover missed changes from HTTP. There is no transactional outbox.

All API replicas in one environment must point to the same Redis instance with `REDIS_URL`. The staging Compose stack runs two API replicas and one shared Redis service. Local Redis health is available through the Compose health check.

## HTTP contract

Notification endpoints below require the current user's session or bearer token; a caller can only list or mutate their own notifications. Poll comment reads may be anonymous, while comment creation requires authentication as noted in its row.

| Request | Response |
| --- | --- |
| `GET /notifications?limit=25&cursor=<opaque>&unreadOnly=false` | `{ items: NotificationItem[], nextCursor: string \| null, unreadCount: number }` |
| `GET /notifications/unread-count` | `{ unreadCount: number }` |
| `POST /notifications/:id/read` | `{ notificationId: string, readAt: ISO-8601, unreadCount: number }` |
| `POST /notifications/read-all` | `{ readAt: ISO-8601, updatedCount: number, unreadCount: 0 }` |
| `GET /notification-preferences` | Per-type `{ inApp, push }` settings for `poll_vote`, `comment`, `comment_reply`, `like`, and `follow` |
| `PATCH /notification-preferences` | Partial per-type `{ inApp?, push? }` updates |
| `GET /polls/:pollId/comments?limit=50` | Root comments only; each item includes `parentCommentId: null` and `repliesCount` |
| `GET /polls/:pollId/comments/:commentId/replies?limit=20&cursor=<opaque>` | One root's replies in ascending order, `{ items, nextCursor }`; `limit` is 1–50 and the opaque cursor is passed back unchanged |
| `POST /polls/:pollId/comments` | Authenticated `{ body, parentCommentId? }`; omission creates a root, while the optional parent must be an active root on this same public poll. Replies to replies are rejected. The returned poll `commentsCount` includes roots and replies. |

Comment and reply listing is available only for an existing public poll; deleted polls, roots, and replies are excluded. The reply endpoint returns not found for a missing, deleted, cross-poll, or non-root parent. Comment creation, the all-comments counter, and any durable notification are committed together. Deleting a root soft-deletes its direct replies and subtracts all removed rows from `commentsCount`; deleting one reply subtracts one.

`NotificationItem` contains `id`, `type`, nullable `actor` (including `id`), `targetType`, nullable `pollId` and `commentId`, safe display `payload`, nullable `readAt`, `createdAt`, and `isTargetAvailable`. Clients use the opaque `nextCursor` unchanged. The supported notification types are `poll_vote`, `comment`, `comment_reply`, `like`, and `follow`.

For `comment_reply`, `commentId` identifies the reply and `pollId` its poll. The sole recipient is the root comment's author when their `comment_reply.inApp` preference is enabled; self-replies and disabled preferences create no notification. The notification payload is empty and never includes reply text. Realtime publication happens after the transaction commits. Opening the notification should resolve the root, expand the thread, and focus the exact reply; a deleted/unavailable target stays in inbox history and uses the client's safe fallback.

Keep existing HTTP response fields available through the compatibility window. This plan does not set an expiry date: remove legacy fields only after the minimum supported web and mobile clients have migrated and product has approved the cutoff.

## WebSocket contract and security

Connect to `GET /realtime` after authentication. Web uses the `yaskapp_session` cookie and must send a trusted `Origin`. Flutter sends `Authorization: Bearer <token>`. Tokens in the query string are rejected. The handshake is limited to 20 requests per IP per minute.

Version 1 notification envelopes are:

```json
{"version":1,"type":"connection.ready"}
{"version":1,"type":"notification.created","payload":{"notification":{"id":"…","type":"follow","actor":null,"targetType":"profile","pollId":null,"commentId":null,"payload":{},"readAt":null,"createdAt":"2026-09-27T10:00:00.000Z","isTargetAvailable":false},"unreadCount":1}}
{"version":1,"type":"notification.read","payload":{"notificationId":"…","readAt":"2026-09-27T10:00:00.000Z","unreadCount":0}}
{"version":1,"type":"notifications.read_all","payload":{"readAt":"2026-09-27T10:00:00.000Z","unreadCount":0}}
```

The server accepts `ping` and answers with `{ "version": 1, "type": "pong" }`. The client must ignore unknown event types and unsupported versions while keeping the connection open. Events never contain the recipient ID; that ID exists only in the Redis envelope.

## Reconciliation and recovery

Clients are intended to reconcile through HTTP after `connection.ready`, every successful reconnect, browser return to `visible`, Flutter resume, and an explicit inbox refresh. Read and read-all mutations update the local store optimistically, then accept the server response or reconcile after an ambiguous failure. Opening the inbox does not mark items read. Realtime is an acceleration path; it is not a durable queue.

If Redis publishing fails after a database commit, keep the database mutation and let client reconciliation recover the state. Investigate Redis connectivity and replica configuration; do not retry a committed user mutation as a substitute for reconciliation.

## Metrics, dashboards, and alerts

`GET /health/metrics` exposes process-local notification counters under `notifications`. Scrape every API replica separately and aggregate in the monitoring system; counters reset when a process restarts. The endpoint has no authentication, and the current staging Caddy API host proxies all paths to the API. Do not expose it as an operational dashboard source until that host is restricted to the private operations network or an access-control rule is added.

| Dashboard panel | Source | Alert guidance |
| --- | --- | --- |
| Active WebSocket connections | `notifications.activeSockets`, scraped per API replica | Alert on an unexpected sustained drop against the normal traffic baseline. |
| Reconnect attempts and disconnect reasons | Client reconnect-attempt telemetry (not currently exported); `notifications.disconnectsByReason` for server disconnects | Export reconnect count and reason by platform; alert on a sustained reconnect increase. Track `socket_error` and `idle_timeout`; treat `client_close` as expected. |
| Redis publish/subscribe errors | `notifications.publishErrors`, `publishFailed`, `subscribeErrors` | Page on a sustained publish-error increase or any replica that cannot subscribe. |
| Notification creation to server socket send | Deltas of `commitToClientTotalMs` / `commitToClientSamples` | These counters actually measure notification `createdAt` to server `socket.send`, not database commit to client receipt. They expose only an average, so they cannot verify the PRD's p95 commit-to-visible-within-2-seconds SLO. |
| Client receipt latency | No current exporter; add client receipt telemetry correlated with server commit/publish time | Required to verify the PRD's p95 latency SLO; do not infer it from server-send counters. |
| HTTP reconciliation success and duration | No current client exporter | Add success/failure and duration by platform; alert on sustained failures or p95 duration above the 5-second convergence target. |
| Unknown realtime version/type | No current client exporter | Count unsupported versions and unknown event types without logging or labeling the event payload. |
| Read outcomes and rate limiting | `readResults`, `rateLimitResponses` | Track failed/unchanged reads and sustained handshake or mutation throttling. |

The current API exports only backend counters. Reconnect attempts, client-visible latency, reconciliation success/duration, and unknown event telemetry remain instrumentation work and block claims that the operational dashboard covers the PRD SLOs. Do not use payload values as metric labels.

## Current release gates

- The staging web host now proxies `/notifications*`, `/notification-preferences*`, `/notification-devices*`, and `/realtime*` to the API before its SPA fallback. Validate these routes through the actual staging host before using it for smoke evidence.
- Web read/read-all requests now guard late success and rollback against a session epoch change. Duplicate creation and delayed read-all events preserve newer unread state; provider visibility reconciliation is wired. Focused regression tests cover these session and ordering cases.
- Flutter now decodes `notification.read` and `notifications.read_all` and applies them to the active notification store while preserving newer notifications. Focused store, client decoder, and session tests cover this behavior.
- One-level replies and the `comment_reply` producer are implemented according to the [poll comment replies plan](superpowers/plans/2026-09-27-poll-comment-replies.md). A real API-created reply must still pass the two-client smoke before the five-type release gate can be marked complete; this runbook does not claim that smoke has run.
- The previous baseline recorded a logout acceptance failure: `/auth/logout` clears the browser cookie while previously issued bearer JWTs remain valid. This execution could not confirm whether it still reproduces because the full API suite could not start without test `DATABASE_URL`, `REDIS_URL`, S3 settings, or an available Docker Engine. Server-side revocation would invalidate sessions across devices; keep that decision separate from replies.

## Staging multi-node operation

The staging Compose definition uses one PostgreSQL database, one Redis bus, and two API replicas. The web host proxies the notifications HTTP routes and WebSocket upgrade to the API before serving the SPA fallback. Apply migrations once, then start the stack:

Before starting it, provision `services/api/.env.staging` from the staging secret store. The API replicas use the Compose-internal `redis://redis:6379` URL; keep the database and storage settings consistent with the staging services.

```powershell
docker compose -f infra/docker/docker-compose.staging.yml up -d --build
docker compose -f infra/docker/docker-compose.staging.yml ps
```

Confirm both API containers are healthy and `/health/ready` reports database, Redis, and storage readiness. To inspect per-process notification counters, query `/health/metrics` on each replica from the private operations network. If one replica cannot subscribe, do not pass the multi-node release gate.

## Poll comment replies release gate

The [poll comment replies plan](superpowers/plans/2026-09-27-poll-comment-replies.md) defines the one-level comment thread contract, producer, and client behavior. Do not mark all five notification types passed until a real reply has been created through `POST /polls/:pollId/comments` with `parentCommentId` and the linked notification has been observed and opened in both web and Flutter using the manual smoke procedure. A synthetic event or direct database insert does not satisfy this gate.
