# Realtime Notifications UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать единый realtime inbox уведомлений для web и Flutter с app-wide store, синхронизацией read-state, Redis fan-out и восстановлением состояния через HTTP.

**Architecture:** PostgreSQL остаётся источником истины; HTTP выдаёт inbox и подтверждает mutations, а версионированные события через Redis и локальный WebSocket hub ускоряют обновление всех активных клиентов пользователя. На каждой платформе один store и одно WebSocket-соединение живут на уровне авторизованной сессии; экран, badge и навигация только подписываются на store.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Redis/ioredis, React 19, TanStack Query, React Router, Vitest/Testing Library/MSW, Flutter/Dart, `web_socket_channel`, Node test runner.

**Spec:** `docs/prd-realtime-notifications-ui.md`

## Global Constraints

- Поддерживаемые типы: `poll_vote`, `comment`, `comment_reply`, `like`, `follow`; новые типы не добавлять.
- `NotificationItem` и realtime envelope имеют один канонический контракт; каждое realtime-событие содержит `version: 1`.
- PostgreSQL — единственный durable source of truth; WebSocket не заменяет HTTP reconciliation.
- Не добавлять FCM/APNs, email/SMS, quiet hours, OS badge, aggregation, archive/delete и transactional outbox.
- Не удалять существующие HTTP-поля до окончания миграционного окна; старые клиенты должны продолжать читать inbox.
- Badge показывает `1…99`, затем `99+`; открытие inbox само по себе не меняет read-state.
- Recipient всегда определяется сервером; list/read/read-all работают только с уведомлениями текущего пользователя.
- Web использует cookie-сессию и проверенный `Origin`; Flutter передаёт bearer token в заголовке, не в URL.
- Payload и логи не содержат email, приватные профильные поля, moderation reason, storage keys, tokens и полный текст приватного контента.
- Неизвестная версия или тип realtime-события игнорируется с технической метрикой и не закрывает соединение.

## Blocking Product Dependency

`docs/prd-poll-comments.md` требует не использовать `comments.parent_comment_id` в текущем comments MVP, но этот PRD требует пользовательское действие, создающее `comment_reply`, и smoke всех пяти типов. Эта декомпозиция реализует контракт, отображение и deep link уже существующего `comment_reply`, однако настоящий producer для reply должен прийти из отдельной задачи/PRD по ответам на комментарии либо требования smoke/acceptance должны быть скорректированы до старта Task 14. Не расширять comments API скрыто внутри notifications PR.

## File Map

- `packages/shared/src/notifications.ts` — канонические notification и realtime типы.
- `services/api/src/modules/notifications/notifications.repository.ts` — durable inbox, cursor, unread и read mutations.
- `services/api/src/modules/notifications/notifications.events.ts` — сборка безопасных versioned events.
- `services/api/src/modules/notifications/notifications.publisher.ts` — публикация событий после commit.
- `services/api/src/realtime/realtime.bus.ts` — Redis pub/sub между API-инстансами.
- `services/api/src/realtime/realtime.hub.ts` — только локальные recipient-scoped WebSocket-соединения.
- `apps/web/src/features/notifications/` — API, store, realtime lifecycle и UI web.
- `apps/mobile/lib/src/features/notifications/` — строгая модель, store, lifecycle и UI Flutter.
- `docs/realtime-notifications.md` — HTTP/realtime контракт, метрики и ручной smoke.

## Review Focus

- Дубликат или событие старее HTTP-страницы не создаёт вторую карточку и не откатывает более новое `readAt`.
- Logout/смена пользователя закрывает socket, отменяет reconnect и не переносит items/unreadCount в новую сессию.
- Timeout после read/read-all не удаляет карточку; reconciliation восстанавливает серверное состояние.
- Удалённая/невидимая цель остаётся в истории и открывает безопасный fallback вместо пустого экрана.
- Redis и локальный hub не доставляют событие другому recipient даже при двух API-инстансах и нескольких вкладках.

---

### Task 1: Канонический shared-контракт

**Files:**
- Create: `packages/shared/src/notifications.ts`
- Modify: `packages/shared/src/index.ts`
- Test: TypeScript compilation in `packages/shared`

**Interfaces:**
- Produces: `NotificationType`, `NotificationTargetType`, `NotificationItem`, `NotificationListResponse`, `NotificationRealtimeEventV1`, `RealtimeEvent`.
- Compatibility: существующие poll/moderation варианты `RealtimeEvent` сохраняются.

- [ ] Добавить строгие типы с полями из PRD; `actor` включает `id`, а `targetType` является обязательным.
- [ ] Описать versioned union:

```ts
type NotificationRealtimeEventV1 =
  | { version: 1; type: 'notification.created'; payload: { notification: NotificationItem; unreadCount: number } }
  | { version: 1; type: 'notification.read'; payload: { notificationId: string; readAt: string; unreadCount: number } }
  | { version: 1; type: 'notifications.read_all'; payload: { readAt: string; unreadCount: 0 } };
```

- [ ] Re-export типов из `index.ts` и удалить локальные дубли там, где shared уже может быть источником типов.
- [ ] Выполнить `npm run typecheck -w @yaskapp/shared` и `npm run api:typecheck`; ожидание: PASS.
- [ ] Commit: `feat(shared): define notification contracts`.

### Task 2: Полная модель inbox и точные HTTP read-ответы

**Files:**
- Modify: `services/api/src/modules/notifications/notifications.repository.ts`
- Modify: `services/api/src/modules/notifications/notifications.routes.ts`
- Modify: `services/api/src/modules/notifications/notifications.repository.test.ts`
- Modify: `services/api/src/modules/notifications/notifications.integration.test.ts`

**Interfaces:**
- Consumes: `NotificationItem` and response types from Task 1.
- Produces: `getNotificationForRecipient(id, recipientUserId, executor?)`, `markNotificationRead(...) -> { notificationId, readAt, unreadCount } | null`, `markAllNotificationsRead(...) -> { readAt, updatedCount, unreadCount: 0 }`.

- [ ] Написать failing tests на `targetType`, actor `id`, безопасный payload allowlist, стабильный `created_at DESC, id DESC`, unavailable target и owner-scoped `404`.
- [ ] Написать failing endpoint tests на `GET /notifications/unread-count` и точные JSON-ответы read/read-all, включая повторные идемпотентные запросы.
- [ ] Обновить mapping/query так, чтобы `profile` использовал actor, `comment` — `commentId`, остальные poll-события — `pollId`; отсутствие/невидимость цели выставляет `isTargetAvailable: false`.
- [ ] Сделать read-one атомарным и возвращать исходный `readAt` при повторе; read-all присваивает один timestamp всем изменённым строкам.
- [ ] Выполнить `npm run test -w @yaskapp/api -- --test-name-pattern=notifications` и `npm run api:typecheck`; ожидание: PASS.
- [ ] Commit: `feat(api): complete notification inbox contracts`.

### Task 3: Безопасные события после commit и недостающий comment-like producer

**Files:**
- Create: `services/api/src/modules/notifications/notifications.events.ts`
- Create: `services/api/src/modules/notifications/notifications.events.test.ts`
- Create: `services/api/src/modules/notifications/notifications.publisher.ts`
- Modify: `services/api/src/modules/polls/polls.repository.ts`
- Modify: `services/api/src/modules/profiles/follows.repository.ts`
- Modify: `services/api/src/modules/polls/polls.integration.test.ts`
- Create: `services/api/src/modules/profiles/follows.repository.test.ts`

**Interfaces:**
- Consumes: `NotificationItem` and repository transactions.
- Produces: `buildNotificationCreatedEvent(item, unreadCount)`, `publishNotificationEvent(userId, event)` и post-commit hooks для vote/comment/poll-like/comment-like/follow; Task 4 меняет транспорт publisher с локального hub на Redis bus без изменения вызывающего кода.

- [ ] Написать tests, доказывающие: до `COMMIT` публикации нет; rollback не публикует; duplicate/self/disabled-inApp не публикуются.
- [ ] Заменить вручную собранные неполные realtime payloads на чтение полной `NotificationItem` после commit.
- [ ] Добавить `like` notification для первого like комментария с `commentId`; unlike и повторный like не создают дубль.
- [ ] Сохранить существующие dedup keys и block/privacy/visibility проверки; payload ограничить display allowlist.
- [ ] Зафиксировать отдельную зависимость для producer `comment_reply`, не добавляя reply API в эту задачу.
- [ ] Выполнить targeted integration tests и `npm run api:typecheck`; ожидание: PASS.
- [ ] Commit: `feat(api): publish complete notifications after commit`.

### Task 4: Redis recipient-scoped fan-out

**Files:**
- Create: `services/api/src/realtime/realtime.bus.ts`
- Create: `services/api/src/realtime/realtime.bus.test.ts`
- Modify: `services/api/src/config/redis.ts`
- Modify: `services/api/src/realtime/realtime.hub.ts`
- Modify: `services/api/src/app.ts`
- Modify: `services/api/src/server.ts`
- Modify: `services/api/src/realtime/realtime.hub.test.ts`

**Interfaces:**
- Produces: `RealtimeBus.start(onMessage)`, `RealtimeBus.publish(recipientUserId, event)`, `RealtimeBus.close()`.
- Consumes: local `sendToUser(recipientUserId, event)` and versioned shared events.

- [ ] Написать unit tests на envelope `{ recipientUserId, event }`, malformed Redis messages, duplicate subscription start и recipient isolation.
- [ ] Использовать отдельные Redis connections для publisher/subscriber; не подписывать shared command connection.
- [ ] После старта API подписаться на один namespaced channel; полученное событие передавать только локальным sockets нужного пользователя.
- [ ] Подключить publisher из Task 3 и read/read-all routes; ошибки publish считать метрикой, не откатывать уже committed DB mutation.
- [ ] Добавить integration test с двумя hub/bus экземплярами: publish через первый доставляет только recipient socket второго.
- [ ] Выполнить `npm run test -w @yaskapp/api -- --test-name-pattern="realtime|notification"`; ожидание: PASS.
- [ ] Commit: `feat(api): add redis notification fanout`.

### Task 5: WebSocket handshake, heartbeat и backend observability

**Files:**
- Modify: `services/api/src/realtime/realtime.routes.ts`
- Modify: `services/api/src/realtime/realtime.hub.ts`
- Modify: `services/api/src/modules/notifications/notifications.metrics.ts`
- Modify: `services/api/src/config/rate-limit.ts`
- Modify: `services/api/src/realtime/realtime.hub.test.ts`
- Create: `services/api/src/realtime/realtime.routes.test.ts`

**Interfaces:**
- Produces: versioned `connection.ready`, ping/pong contract, connection counters and disconnect/publish metrics.

- [ ] Написать failing tests на cookie auth + allowed Origin, bearer auth header, token-in-query rejection, unauthenticated/rate-limited handshake.
- [ ] Отправлять `connection.ready` только после регистрации socket и включить `version: 1`.
- [ ] Добавить server heartbeat/idle cleanup без раскрытия recipient в клиентском payload.
- [ ] Расширить метрики: active sockets, disconnect reason, Redis publish/subscribe errors, commit-to-client timestamps, read/read-all results и rate-limit responses.
- [ ] Проверить redaction логов тестом: notification payload, comment body, cookie/token не появляются в log fields.
- [ ] Выполнить realtime/backend test suite и typecheck; ожидание: PASS.
- [ ] Commit: `feat(api): harden notification websocket lifecycle`.

### Task 6: Web API decoder и canonical target resolver

**Files:**
- Create: `apps/web/src/api/notifications.ts`
- Modify: `apps/web/src/api/models.ts`
- Create: `apps/web/src/api/notifications.test.ts`
- Create: `apps/web/src/features/notifications/notification-target.ts`
- Create: `apps/web/src/features/notifications/notification-target.test.ts`

**Interfaces:**
- Produces: `listNotifications`, `getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationPreferences`, `patchNotificationPreferences`, `notificationHref(item)`.

- [ ] Написать decoder tests на все обязательные поля, nullable actor, неизвестный type/version и malformed timestamp.
- [ ] Реализовать API-функции с cookie credentials через существующий `apiClient`.
- [ ] Реализовать canonical URLs: poll `/polls/:pollId`, comment `/polls/:pollId?comment=:commentId`, profile `/users/:actorId`.
- [ ] Для `isTargetAvailable: false` resolver возвращает `null`, а не фиктивный URL.
- [ ] Выполнить `npm run test -w @yaskapp/web -- notifications` и `npm run typecheck -w @yaskapp/web`; ожидание: PASS.
- [ ] Commit: `feat(web): add notification api contracts`.

### Task 7: Web app-wide notification store

**Files:**
- Create: `apps/web/src/features/notifications/notification-store.tsx`
- Create: `apps/web/src/features/notifications/notification-store.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/session-provider.tsx`

**Interfaces:**
- Produces: `NotificationProvider`, `useNotifications()`, normalized `itemsById`, ordered `ids`, `pendingIds`, `unreadCount`, cursors and actions.

- [ ] Написать reducer tests на merge/dedup, stable order, unread filter, optimistic read/read-all, rollback+reconcile и out-of-order stale events.
- [ ] При authenticated session загрузить только unread count; inbox page загружать по требованию.
- [ ] Реализовать `reconcile()` как merge первой страницы с authoritative `readAt`, `isTargetAvailable`, order и unread count при сохранении непротиворечивой истории.
- [ ] На logout/user change отменить requests, сбросить все maps/cursors/errors и увеличить session epoch, чтобы поздний ответ не загрязнил новую сессию.
- [ ] Выполнить store tests; ожидание: PASS.
- [ ] Commit: `feat(web): add app-wide notification store`.

### Task 8: Web app-wide realtime lifecycle

**Files:**
- Create: `apps/web/src/features/notifications/realtime-client.ts`
- Create: `apps/web/src/features/notifications/realtime-client.test.ts`
- Modify: `apps/web/src/features/notifications/notification-store.tsx`
- Modify: `apps/web/src/features/notifications/notification-store.test.tsx`

**Interfaces:**
- Produces: `NotificationRealtimeClient.start()`, `.stop()`, typed event subscription and connection status.

- [ ] Написать fake-WebSocket tests: один socket на session, no token in URL, heartbeat timeout, one reconnect timer, exponential backoff+jitter and stop-on-logout.
- [ ] На `connection.ready` всегда запускать HTTP reconciliation; `notification.created/read/read_all` передавать reducer.
- [ ] Неизвестный version/type игнорировать, считать метрикой и оставлять socket открытым.
- [ ] На `document.visibilityState === 'visible'` после background вызывать reconciliation с single-flight guard.
- [ ] Выполнить realtime/store tests; ожидание: PASS.
- [ ] Commit: `feat(web): add notification realtime lifecycle`.

### Task 9: Web `/notifications`, badge и inbox states

**Files:**
- Create: `apps/web/src/features/notifications/NotificationsPage.tsx`
- Create: `apps/web/src/features/notifications/NotificationsPage.test.tsx`
- Create: `apps/web/src/features/notifications/NotificationCard.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/components/AppLayout.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `useNotifications()` and `notificationHref()`.
- Produces: protected `/notifications`, exact badge and responsive inbox.

- [ ] Написать route/layout tests, включая отсутствие `/search?view=notifications`, anonymous redirect и badge `99+`.
- [ ] Реализовать filters «Все/Непрочитанные», группы «Сегодня/Вчера/Ранее», skeleton/empty/error-retry/loading-more и cursor pagination.
- [ ] Открытие страницы не вызывает read mutation; «Прочитать все» — явная optimistic action.
- [ ] При top position вставлять событие сразу; ниже top складывать `pendingIds` и показывать плашку «Новые уведомления (N)».
- [ ] Сделать desktop central column и single-column narrow layout; reduced motion не должен менять scroll position неожиданно.
- [ ] Выполнить component tests и `npm run lint -w @yaskapp/web`; ожидание: PASS.
- [ ] Commit: `feat(web): build notifications inbox`.

### Task 10: Web deep links, unavailable target, settings и a11y

**Files:**
- Modify: `apps/web/src/features/comments/PollDetailPage.tsx`
- Modify: `apps/web/src/features/comments/CommentList.tsx`
- Create: `apps/web/src/features/notifications/NotificationPreferencesPage.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/features/notifications/NotificationCard.tsx`
- Modify: `apps/web/src/styles/global.css`
- Create: `apps/web/src/features/notifications/notifications.e2e.test.tsx`

**Interfaces:**
- Consumes: canonical query `?comment=<id>` and existing preferences endpoints.

- [ ] Написать navigation tests для всех пяти типов и обеих веток `like`; comment target получает focus/scroll/highlight.
- [ ] Card click сначала optimistic-read, затем navigate; ambiguous mutation запускает reconciliation и показывает ненавязчивую ошибку только в текущем контексте.
- [ ] Для unavailable target оставить карточку, показать понятный toast/status и не менять URL.
- [ ] Добавить защищённый in-app preferences route; показывать только `inApp` switches, не рекламировать и не расширять push.
- [ ] Проверить keyboard activation, visible focus, screen-reader name, semantic unread state, full timestamp и WCAG AA styles.
- [ ] Выполнить web tests/build; ожидание: PASS.
- [ ] Commit: `feat(web): complete notification navigation and settings`.

### Task 11: Flutter строгая модель, API и notification store

**Files:**
- Create: `apps/mobile/lib/src/features/notifications/notification_model.dart`
- Create: `apps/mobile/lib/src/features/notifications/notification_store.dart`
- Modify: `apps/mobile/lib/src/features/notifications/notifications_api_client.dart`
- Create: `apps/mobile/test/notification_model_test.dart`
- Create: `apps/mobile/test/notification_store_test.dart`

**Interfaces:**
- Produces: `NotificationItem`, `NotificationTarget`, `NotificationStore`, `NotificationStoreState`; API read methods возвращают typed responses.

- [ ] Написать parsing tests на обязательные поля, actor `id`, targetType, payload, unknown type и malformed timestamp; неизвестный type безопасно игнорируется.
- [ ] Написать store tests на merge/dedup/order/cursors, optimistic read/read-all, rollback+reconcile, pending new items и session reset.
- [ ] Добавить отдельный `unreadCount()` endpoint вместо `list(limit: 1)`.
- [ ] Реализовать authoritative reconciliation первой страницы с сохранением непротиворечивой истории.
- [ ] Выполнить `flutter test test/notification_model_test.dart test/notification_store_test.dart`; ожидание: PASS.
- [ ] Commit: `feat(flutter): add notification model and store`.

### Task 12: Flutter одно app-wide realtime-соединение

**Files:**
- Modify: `apps/mobile/lib/src/features/realtime/realtime_client.dart`
- Create: `apps/mobile/lib/src/features/realtime/realtime_session.dart`
- Modify: `apps/mobile/lib/src/app.dart`
- Modify: `apps/mobile/lib/src/features/home/home_screen.dart`
- Create: `apps/mobile/test/realtime_session_test.dart`
- Modify: `apps/mobile/test/widget_test.dart`

**Interfaces:**
- Produces: `RealtimeSession.start(AuthSession)`, `.stop()`, typed notification event stream; owns exactly one `RealtimeClient` and one `NotificationStore` per user session.

- [ ] Написать lifecycle tests на login/bootstrap, one connection, heartbeat timeout, exponential backoff+jitter, no parallel reconnect, foreground reconcile и logout cleanup.
- [ ] Поднять store/realtime ownership из `NotificationsScreen` в authenticated app/session scope.
- [ ] Передавать bearer token только header; на `connection.ready` и `AppLifecycleState.resumed` вызывать single-flight reconciliation.
- [ ] Удалить локальное `_notificationsViewed` обнуление badge: навигация подписывается только на `store.unreadCount`.
- [ ] Проверить, что поздние callbacks старой session epoch не меняют нового пользователя.
- [ ] Выполнить focused Flutter tests и analyzer; ожидание: PASS.
- [ ] Commit: `feat(flutter): add app-wide notification realtime session`.

### Task 13: Flutter inbox UI и scrolling behavior

**Files:**
- Refactor: `apps/mobile/lib/src/features/notifications/notifications_screen.dart`
- Modify: `apps/mobile/test/notifications_screen_test.dart`
- Modify: `apps/mobile/test/home_navigation_test.dart`

**Interfaces:**
- Consumes: injected `NotificationStore`; экран не создаёт API/realtime clients.

- [ ] Заменить существующий auto-read-all test на test «открытие inbox не меняет read-state».
- [ ] Покрыть filters, группы, skeleton/loading/empty/error-retry/loading-more, pull-to-refresh и cursor pagination.
- [ ] Реализовать unread background/title weight/semantic marker, relative time + полный timestamp и badge `99+`.
- [ ] Реализовать top insert и pending banner при прокрутке; tap баннера прокручивает наверх и materializes pending ids без дублей.
- [ ] «Прочитать все» доступно только явным действием и имеет pending/error state.
- [ ] Проверить touch targets `>= 44×44`, contrast и reduced-motion behavior.
- [ ] Выполнить widget tests; ожидание: PASS.
- [ ] Commit: `feat(flutter): rebuild notifications inbox UI`.

### Task 14: Flutter deep links, unavailable target и in-app settings

**Files:**
- Create: `apps/mobile/lib/src/features/notifications/notification_navigator.dart`
- Modify: `apps/mobile/lib/src/features/notifications/notifications_screen.dart`
- Modify: `apps/mobile/lib/src/features/polls/poll_comments_screen.dart`
- Modify: `apps/mobile/lib/src/features/profile/public_profile_screen.dart`
- Modify: `apps/mobile/lib/src/features/notifications/notification_preferences_screen.dart`
- Create: `apps/mobile/test/notification_navigation_test.dart`
- Modify: `apps/mobile/test/notification_preferences_api_client_test.dart`

**Interfaces:**
- Produces: `Future<void> openNotificationTarget(BuildContext, NotificationItem)`.

- [ ] Написать navigation tests для poll, comment, comment_reply, comment-like, poll-like и follow; comment screen scrolls/highlights id.
- [ ] Tap карточки оптимистично читает только её, запускает mutation и открывает target; failure вызывает reconcile без удаления карточки.
- [ ] Unavailable target показывает безопасный SnackBar/dialog и остаётся в истории.
- [ ] Удалить информационный bottom sheet как основное действие карточки.
- [ ] В settings оставить только пять `inApp` switches; существующие push controls не расширять и не позиционировать как часть этой задачи.
- [ ] Выполнить navigation/preferences tests; ожидание: PASS.
- [ ] Commit: `feat(flutter): add notification deep links and settings`.

### Task 15: Cross-client smoke, документация и release gates

**Files:**
- Create: `docs/realtime-notifications.md`
- Create: `docs/realtime-notifications-smoke.md`
- Modify: `docs/architecture.md`
- Modify: `infra/docker/docker-compose.yml`
- Modify: `infra/docker/docker-compose.staging.yml`
- Create: `services/api/src/modules/notifications/notifications.multinode.integration.test.ts`

**Interfaces:**
- Consumes: все предыдущие задачи; produces operational runbook and release evidence.

- [ ] Автоматизировать backend multi-node test: два API/hub экземпляра, один Redis, recipient isolation, read/read-all convergence и no publish before commit.
- [ ] Описать HTTP schemas, realtime envelopes, reconciliation triggers, auth/Origin policy и backwards compatibility window.
- [ ] Описать dashboards/alerts для active connections, reconnect/disconnect, Redis errors, commit→client latency, reconciliation и unknown events без payload labels.
- [ ] Выполнить ручной Flutter+web smoke: realtime badge/card, one-read, read-all, reconnect, foreground/visible, pagination, duplicate delivery и unavailable target.
- [ ] Проверить пять типов; `comment_reply` допускается к этому gate только после закрытия Blocking Product Dependency.
- [ ] Выполнить `npm run shared:build`, `npm run api:typecheck`, `npm run api:test`, `npm run build -w @yaskapp/web`, `npm run test -w @yaskapp/web -- --run`, Flutter analyze/tests и `git diff --check`; ожидание: все PASS.
- [ ] Commit: `docs: publish realtime notifications runbook`.

## Dependency Order

1. Task 1 → Task 2 → Task 3 → Task 4 → Task 5.
2. Tasks 2–5 → web Tasks 6–10 и Flutter Tasks 11–14.
3. Внутри web: 6 → 7 → 8 → 9 → 10.
4. Внутри Flutter: 11 → 12 → 13 → 14.
5. Tasks 10 и 14 плюс закрытый `comment_reply` dependency → Task 15.

## Suggested Review Gates

- Gate A: Tasks 1–2 — контракт и HTTP совместимость.
- Gate B: Tasks 3–5 — multi-instance delivery, auth и observability.
- Gate C: Tasks 6–10 — полностью тестируемый web vertical slice.
- Gate D: Tasks 11–14 — полностью тестируемый Flutter vertical slice.
- Gate E: Task 15 — двухклиентный smoke и готовность к выпуску.
