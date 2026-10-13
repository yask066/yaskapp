# Самостоятельное удаление аккаунта — план выполнения

> **Для исполнителя:** при реализации использовать `superpowers:executing-plans`; `superpowers:subagent-driven-development` — если пользователь выберет выполнение с подагентами. Шаги отмечаются через `- [ ]`.

**Цель:** дать пользователю возможность удалить аккаунт с немедленным закрытием доступа и устойчивой очисткой данных.

**Архитектура:** PostgreSQL хранит разрешения, операцию, этапы очистки и события для доставки после commit. Отдельный worker выполняет очистку порциями и повторяет ошибки; Flutter и web используют единый контракт проверки пароля, удаления и статуса. Журнал для восстановления из backup хранится отдельно от восстанавливаемой основной БД.

**Стек:** Fastify / TypeScript, PostgreSQL, Redis / WebSocket, S3 / MinIO, Flutter, React / TanStack Query.

**PRD:** [Самостоятельное удаление аккаунта и очистка данных](../../prd-account-deletion.md).

**Статус:** AD-01–AD-13 выполнены; AD-14–AD-15 ещё не реализованы. Все задачи обязательны для первого релиза. Существующие изменения в `apps/web/vite.config.ts` не относятся к этой работе.

## Общие ограничения

- Очистка происходит вместе с удалением аккаунта; отдельной очистки с сохранением аккаунта нет.
- После принятия нет отмены или восстановления. Административное удаление и старые административно удалённые аккаунты не мигрировать автоматически.
- План использует предложенные сроки PRD: действующие хранилища — 24 часа, backup — 30 дней, завершённые служебные записи — 35 дней, минимальная история модерации — 30 дней.
- `deletionToken` действует 10 минут; `statusToken` — 48 часов. Пароли и токены не попадают в логи, URL или служебный журнал.
- Не более 5 неуспешных проверок пароля за 15 минут на аккаунт; отдельно ограничить IP. `429` содержит `Retry-After`.
- Голоса удаляются и в закрытых опросах. В чужих сохраняемых опросах чужие ответы остаются; собственные опросы удаляются вместе с обсуждением.
- UI на английском в соответствии с существующими клиентами; не добавлять обязательную причину ухода или экраны удержания.
- До завершения серверных задач и настройки worker вход в новый сценарий выключен. Отключение входа не останавливает уже принятые удаления.
- Каждая задача заканчивается проверкой своего результата и отдельным commit только её файлов. Тесты API выполняются на отдельной тестовой БД.

## Области особого внимания

1. Вложенная цепочка комментариев с несколькими удаляемыми предками: сохранить чужие ответы без циклов и потери корневой связи — AD-07.
2. Загрузка файла, начатая до закрытия аккаунта: после принятия объект нельзя привязать или оставить вне очистки — AD-04, AD-10.
3. Redis недоступен в момент принятия: аккаунт остаётся закрытым, открытые sockets не продолжают получать данные, события позже доставляются — AD-05.
4. Потеря ответа и перезапуск клиента: проверить результат по заранее сохранённой квитанции без восстановления сессии — AD-12, AD-13.
5. Восстановление старой БД и старых файлов: журнал вне backup предотвращает возвращение аккаунта до открытия трафика — AD-14.

## Порядок и зависимости

| ID | Задача | Область | Зависит от |
| --- | --- | --- | --- |
| AD-01 | Зафиксировать продуктовые решения и API-контракт | Product / Backend | — |
| AD-02 | Добавить модель операции и общие типы | Backend / DB | AD-01 |
| AD-03 | Проверка пароля и разрешения на удаление | Backend / Auth | AD-02 |
| AD-04 | Атомарное принятие и защита от новых записей | Backend | AD-03 |
| AD-05 | Закрытие доступа, скрытие данных и отзыв realtime | Backend | AD-04 |
| AD-06 | Устойчивый worker с этапами и повторами | Backend | AD-02, AD-04 |
| AD-07 | Опросы, комментарии и сохранение чужих ответов | Backend / DB | AD-05, AD-06 |
| AD-08 | Голоса, лайки, подписки и счётчики | Backend / DB | AD-07 |
| AD-09 | Уведомления, устройства, модерация и аудит | Backend / DB | AD-07, AD-08 |
| AD-10 | Медиа, версии и orphan-файлы | Backend / Storage | AD-04, AD-06 |
| AD-11 | Итоговая проверка, удаление идентичности и метрики | Backend | AD-08, AD-09, AD-10 |
| AD-12 | Сценарий удаления и очистка Flutter | Mobile | AD-03, AD-04, AD-05 |
| AD-13 | Сценарий удаления и очистка web | Web | AD-03, AD-04, AD-05 |
| AD-14 | Эксплуатация, сроки хранения и безопасный restore | DevOps / Backend | AD-06, AD-11 |
| AD-15 | Сквозная приёмка и выпуск | QA / Все области | AD-01–AD-14 |

AD-05 и AD-06 можно разрабатывать независимо после AD-04. AD-10 можно
разрабатывать одновременно с AD-07–AD-09; порядок этапов worker остаётся
строгим. AD-12 и AD-13 могут выполняться независимо, пока серверная очистка
дорабатывается, но сценарий остаётся недоступен пользователям до AD-15.
Это возможности организации работы, а не указание запускать подагентов.

Рекомендуемый последовательный порядок: **AD-01 → AD-02 → AD-03 → AD-04 →
AD-05 → AD-06 → AD-07 → AD-08 → AD-09 → AD-10 → AD-11 → AD-12 → AD-13 →
AD-14 → AD-15**.

## Карта файлов и границы модулей

Новый серверный модуль: `services/api/src/modules/account-deletion/`.
Он оркестрирует очистку; существующие auth, polls, profiles и moderation
сохраняют свои обычные сценарии. Новые файлы в плане — предполагаемые места
реализации, существующие пути проверены по репозиторию.

- `account-deletion.repository.ts`: операции, разрешения, lease и прогресс.
- `account-deletion.verification.ts`, `.routes.ts`, `.service.ts`: проверка владения, HTTP и принятие.
- `account-activity.guard.ts`: проверка/блокировка аккаунта для конкурентных операций.
- `account-deletion.content.ts`, `.relationships.ts`, `.notifications.ts`, `.moderation.ts`, `.media.ts`: отдельные этапы очистки.
- `account-deletion.worker.ts`: выполнение этапов и повторные попытки; `account-deletion.completion.ts`: проверка остатков и финальное удаление.
- `account-deletion.metrics.ts`, `.retention.ts`: наблюдаемость и сроки хранения.
- `packages/shared/src/account-deletion.ts`: публичные DTO и типы состояния.
- `apps/mobile/lib/src/features/account_deletion/` и `apps/web/src/features/account-deletion/`: клиентские сценарии, независимые от обычной auth-сессии при проверке квитанции.

Новые миграции: `028_account_deletion_operations.sql`,
`029_account_deletion_content_targets.sql` и
`030_account_deletion_retention.sql` в `services/api/src/db/migrations/`.
При появлении параллельной миграции взять следующие свободные номера;
уже применённые миграции не редактировать.

## AD-01. Продуктовые решения и окончательный API-контракт

**Результат:** решения PRD превращены в однозначные правила для разработки и выпуска.

**Файлы:** обновить `docs/prd-account-deletion.md`; создать `docs/account-deletion-api.md` и `docs/account-deletion-data-map.md`.

- [x] Зафиксировать отдельным списком решения о сроках 24 часа / 30 / 35 дней, очистке модерации и отсутствии отдельной очистки без удаления. Отделить утверждённые решения от предложенных; не представлять отсутствие ответа как согласие.
- [x] Описать для каждой таблицы, JSON-поля, media prefix и клиентского хранилища владельца данных, действие очистки и проверку отсутствия остатков; включить `cover_object_key`, старый soft-delete и ссылки без FK.
- [x] Зафиксировать схемы трёх endpoints из PRD, ошибки, scopes и отсутствие общего logout при неверном пароле. Для проверки пароля выбрать `403 invalid_credentials`; `401` специальных токенов обрабатывать в отдельном клиенте.
- [x] Зафиксировать ответы: verification `{operationId, deletionToken, statusToken, deletionTokenExpiresAt, statusTokenExpiresAt}`; acceptance/status `{operationId, status, acceptedAt, deadlineAt, completedAt}`, nullable даты до соответствующего этапа. Статусы: `not_started | pending | processing | retrying | completed`.
- [x] Проверить отсутствие пропущенных категорий по разделу 6 PRD. Неподтверждённые сроки не блокируют разработку с предложенными значениями, но блокируют выпуск пользовательского обещания.

**Готово, когда:** контракт не содержит альтернативных названий полей; у каждой категории есть правило и проверка; открытые решения имеют явный статус. **Результат AD-01:** [решения и PRD](../../prd-account-deletion.md), [контракт API](../../account-deletion-api.md), [карта данных](../../account-deletion-data-map.md). Сроки, исключения модерации и отдельная очистка отмечены как требующие решения. **PRD:** разделы 2, 6, 7, 9, 12.

## AD-02. Операции, разрешения и shared-контракты

**Файлы:** создать миграцию `028_account_deletion_operations.sql`, `packages/shared/src/account-deletion.ts`, `account-deletion.repository.ts`, `account-deletion.repository.test.ts`; обновить `packages/shared/src/index.ts`.

**Интерфейс:** `getDeletionOperation(operationId: string): Promise<AccountDeletionStatusResponse | null>`; `AccountDeletionStatusResponse` и `AccountDeletionVerificationResponse` из AD-01. Внутренние записи не раскрываются клиенту.

- [x] Добавить тест `operation_survives_user_delete`: после удаления `users` запись операции и безопасные проверочные значения квитанции сохраняются; повторное принятие для прежнего `userId` не создаёт вторую операцию.
- [x] Создать таблицы операции, hashed разрешений, шагов, манифеста файлов и событий после commit. Запись операции не имеет каскадного FK на `users`; одна незавершённая принятая операция на аккаунт. `not_started` — подготовленная, ещё не принятая операция.
- [x] Добавить lease, `available_at`, попытки, технический код ошибки, accepted/deadline/completed timestamps. Не сохранять login, пароль, профиль, IP и сырые токены; манифест ограничить владельцем операции.
- [x] Реализовать repository и shared DTO, проверить точные значения полей, повторное применение миграции и тест с физическим удалением пользователя.

**Готово, когда:** миграция проходит на свежей и существующей БД; разрешения и журнал переживают удаление аккаунта. **PRD:** AC-10, AC-11.

**Результат AD-02:** миграция 028, shared DTO и repository реализованы в ветке `codex/account-deletion-ad02`, commit `3cfecaf`, отдельный worktree. Восемь тестов прошли на PostgreSQL 16 для свежей БД и обновления с 027; повторное применение SQL/runner и `api:typecheck` прошли. Ревью не выявило замечаний. Полный набор API: 173/174; существующий тест `logout clears the cookie session and mutating cookie requests require a trusted origin` падает и на исходном коде: logout очищает cookie, но не отзывает старую сессию. Проверка выполнялась на отдельных тестовых БД, с Redis 3.2 и эмулятором S3 для общей регрессии; рабочая БД не изменялась.

## AD-03. Проверка пароля и разрешения с ограниченными правами

**Файлы:** создать `account-deletion.verification.ts`, `account-deletion.routes.ts`, `account-deletion.routes.test.ts`; обновить `services/api/src/app.ts`, `services/api/src/config/env.ts` и `services/api/.env.example`.

**Интерфейс:** `verifyAccountDeletion(input: { userId?: string; login?: string; password: string }): Promise<AccountDeletionVerificationResponse>`; `getAccountDeletionStatus(statusToken: string): Promise<AccountDeletionStatusResponse>`.

- [x] Добавить тесты `wrong_password_preserves_session`, `blocked_user_gets_only_deletion_scope`, `status_token_cannot_delete`, `token_expiry_10m_48h`, `fifth_failure_rate_limits` и `untrusted_cookie_origin_rejected`.
- [x] Реализовать `POST /auth/account-deletion/verification` и `GET /auth/account-deletion/status`: для сессии брать server-side identity, без сессии проверять login/password без выдачи обычного JWT. Не раскрывать существование аккаунта разными credential-ошибками.
- [x] Хранить только хэши случайных токенов, ограничить scopes, добавить rate limit и редактирование логов. Отдельный флаг `ACCOUNT_DELETION_ENABLED=false` закрывает verification/новые acceptance, но не status и выполнение принятых задач.
- [x] Запустить тесты маршрутов; fake clock подтверждает сроки; в сохранённых записях и логах нет паролей и сырых токенов.

**Готово, когда:** активный и заблокированный пользователь подтверждают только свой аккаунт, неверный пароль не отзывает обычную сессию. **PRD:** AC-02, AC-10, AC-14.

**Результат AD-03:** реализованы маршруты verification/status, случайные deletion/status tokens с независимыми scopes и сроками 10 минут/48 часов, лимиты неуспешных проверок на аккаунт и IP, лог-редактирование и выключенный по умолчанию флаг. Маршрутные и auth-cookie тесты: 12 passed; `npm run api:typecheck` прошёл. Тесты маршрутов используют тестовые подмены БД/Redis. Миграция и database-backed API suite не запускались: `services/api/.env` указывает на `yaskapp`, отдельная test DB не настроена, Docker Engine недоступен; рабочую БД не меняли.

## AD-04. Атомарное принятие и защита от конкурентных записей

**Файлы:** создать `account-deletion.service.ts`, `account-activity.guard.ts`, `account-deletion.acceptance.integration.test.ts`; обновить маршруты AD-03, `polls.repository.ts`, `profiles.repository.ts`, `avatars.service.ts`, `poll-images.service.ts`, `notification-devices.repository.ts`, `notification-push-worker.ts`, `moderation.repository.ts`, `sanctions.repository.ts`, `services/api/src/modules/admin/admin.users.repository.ts`.

**Интерфейс:** `acceptAccountDeletion(deletionToken: string, confirm: true): Promise<AccountDeletionStatusResponse>`; `lockActiveAccount(client: PoolClient, userId: string): Promise<void>` для транзакционных записей.

- [x] Добавить тесты `acceptance_rollback_leaves_active`, `parallel_acceptance_returns_one_operation`, `last_superadmin_role_race`, `write_started_before_deletion_cannot_commit_after_acceptance`, `upload_finalize_after_close_is_rejected`.
- [x] Реализовать `DELETE /auth/me`: под блокировкой аккаунта проверить разрешение, последний superadmin, установить deleted/status/session_version, сохранить задачу, текущие ссылки файлов и события; только после commit вернуть `202` и очистить cookie.
- [x] В мутациях применять совместимую транзакционную блокировку аккаунта и проверку состояния; при работе с несколькими пользователями соблюдать единый порядок блокировок. Проверку числа superadmin сериализовать с изменениями ролей/удалением.
- [x] Защитить асинхронные upload и внешнюю отправку push от начала нового действия после закрытия; результат upload после закрытия отправлять в устойчивую очистку AD-10. Уже переданные внешнему провайдеру доставки учитывать как начатые до принятия.
- [x] Выполнить конкурентные тесты с управляемыми барьерами; убедиться, что повтор acceptance после отзыва сессии возвращает ту же операцию.

**Готово, когда:** отсутствует состояние «аккаунт закрыт, задача потеряна» и новые записи после принятия. **PRD:** AC-02, AC-10–AC-12, AC-14.

## AD-05. Закрытие всех сессий, скрытие данных и realtime

**Файлы:** обновить `auth.utils.ts`, `profiles.repository.ts`, `profiles.routes.ts`, `polls.repository.ts`, `poll-image.routes.ts`, `search.repository.ts`, `notifications.repository.ts`, `notifications.publisher.ts`, `realtime.hub.ts`, `realtime.bus.ts`, `services/api/src/app.ts`, `packages/shared/src/index.ts`; создать `account-deletion.visibility.integration.test.ts`, `account-deletion.multinode.integration.test.ts`.

**Интерфейс:** событие `account.deleted` с `{userId, operationId}` без профиля; `disconnectUser(userId: string, reason: 'account_deleted'): void`. Изменения содержимого/счётчиков используют существующие события и revisions; отдельно инвалидация профиля и связей.

- [x] Добавить тесты `bearer_cookie_optional_auth_all_rejected`, `deleted_owner_hidden_before_purge`, `redis_outage_does_not_leak_socket_delivery`, `two_nodes_disconnect_same_account`.
- [x] Проверять deleted/status и отзыв сессии во всех путях auth, включая optional auth. Проверять владельца/цель в выдаче лент, поиска, profiles, notifications, poll/avatars media до физической очистки.
- [x] Добавить межпроцессное закрытие sockets и устойчивую доставку событий AD-02. При сбое Redis использовать проверку статуса перед доставкой и проверку живых локальных сессий; одного Redis Pub/Sub недостаточно.
- [ ] Проверить прямые URL, soft-deleted контент, отсутствие новых push и доставку отложенных событий после восстановления Redis.

Проверка интеграционного сценария с PostgreSQL пока заблокирована: локальная тестовая БД недоступна (регистрация пользователя в integration test завершается HTTP 500). Unit-тесты, typecheck и тесты realtime/outbox проходят; пункт проверки прямых URL и реального восстановления Redis остаётся открытым.

**Готово, когда:** серверные запросы не возвращают закрытый аккаунт/контент, sockets на всех узлах прекращают доступ. **PRD:** AC-03, AC-04, AC-09, AC-11.

## AD-06. Worker с lease, этапами и повторными попытками

**Файлы:** создать `account-deletion.worker.ts`, `account-deletion.worker.test.ts`, `services/api/src/jobs/run-account-deletion-worker.ts`; обновить `services/api/package.json`.

**Интерфейс:** `processDeletionBatch(input: { limit: number; now: Date }): Promise<{processed: number; completed: number; retrying: number}>`; каждый шаг `(operationId: string) => Promise<{done: boolean}>`.

- [x] Добавить тесты `two_workers_claim_once`, `expired_lease_resumes`, `restart_keeps_step_progress`, `retry_does_not_repeat_committed_step`, `large_account_yields_between_batches`.
- [x] Реализовать claim через `FOR UPDATE SKIP LOCKED`, lease 2 минуты с продлением и обработку порциями по 100 объектов/записей. Retry: 5 секунд с удвоением до 15 минут, без удаления задачи после исчерпания попыток.
- [x] Зафиксировать порядок: discovery файлов/target IDs → уведомления и модерация по ещё существующим связям → комментарии и опросы → голоса/лайки/подписки и пересчёт → файлы → итоговая проверка → удаление user/profile → финальный статус. Артефакты AD-07–AD-10 подключать через интерфейс шага.
- [x] Добавить команду `account-deletion:worker`; до AD-11 отсутствие любого обязательного этапа запрещает `completed`. Проверить restart и дублирование worker.

**Готово, когда:** задача переживает остановку процесса и частичный прогресс, не блокируя API надолго. **PRD:** AC-10, AC-11.

**Результат AD-06:** PostgreSQL claim с `SKIP LOCKED`, двухминутным lease/renewal и ограниченными retry реализован в `account-deletion.worker.ts`; обработчики шагов подключаются отдельным реестром, завершение запрещено при отсутствии любого из семи обязательных шагов. Команда worker добавлена; пока AD-07–AD-11 не зарегистрируют обработчики, она завершается с явной ошибкой готовности. Семь unit-тестов прошли; `api:typecheck` прошёл. PostgreSQL integration не запускался.

## AD-07. Опросы и комментарии без потери чужих ответов

**Файлы:** создать `029_account_deletion_content_targets.sql`, `account-deletion.content.ts`, `account-deletion.content.integration.test.ts`; обновить worker и существующие DTO/read paths комментариев в `polls.repository.ts` при необходимости перепривязки.

**Интерфейс:** `purgeAccountContent(operationId: string): Promise<{done: boolean}>`; сохраняет IDs затронутых оставшихся опросов/родителей для AD-08 и события после commit.

- [x] Добавить fixture: удаляемый автор в собственном опросе и в чужом; дерево «чужой A → свой B → свой C → чужой D». В тесте `surviving_reply_reparents_to_nearest_ancestor` проверить `D.parent = A`; если A отсутствует, `D.parent = null`.
- [x] До удаления своих комментариев перепривязать чужие ответы, очистить реакции на удаляемые комментарии и пересчитать surviving parents. Не создавать tombstone с сохранённым авторством/текстом.
- [x] Удалить собственные опросы и их обсуждения целиком, включая hidden/soft-deleted; перед каскадом использовать манифесты файлов и целей AD-06/AD-10.
- [ ] Проверить повтор порции после crash, цикл/несколько удаляемых предков, чужой корневой ответ и правильные counts/revisions после AD-08.

**Готово, когда:** собственный контент исчез, чужие ответы в оставшихся опросах сохранены и читаются. **PRD:** AC-05, AC-08, AC-09, AC-12.

## AD-08. Голоса, лайки, подписки и пересчёт счётчиков

**Файлы:** создать `account-deletion.relationships.ts`, `account-deletion.relationships.integration.test.ts`; обновить worker и публикацию существующих событий poll state.

**Интерфейс:** `purgeAccountRelationships(operationId: string): Promise<{done: boolean}>`; использует affected IDs AD-07, сохраняет состояние шага и события в одной транзакции.

- [ ] Добавить тест `closed_poll_vote_removed`: удалить 1 из 3 голосов, получить 2, правильный option count и проценты; второй запуск не уменьшает результат снова.
- [ ] Удалить голоса независимо от `ends_at`, свои лайки, follows обоих направлений; пересчитать голоса, реакции, комментарии/replies и followers/following по оставшимся фактическим записям.
- [ ] Согласовать блокировки с обычными vote/like/follow мутациями, увеличить применимые revisions, публиковать результат только после commit.
- [ ] Проверить конкурентный чужой голос/лайк/follow во время пересчёта, отсутствие отрицательных значений, правильность feed/profile/detail после reconnect.

**Готово, когда:** агрегаты соответствуют оставшимся данным, retries и конкурентные действия не портят счётчики. **PRD:** AC-07, AC-08, AC-12.

## AD-09. Уведомления, push, модерация и аудит

**Файлы:** создать `account-deletion.notifications.ts`, `account-deletion.moderation.ts`, `account-deletion.notifications.integration.test.ts`, `account-deletion.moderation.integration.test.ts`; обновить `notification-push-worker.ts`, `moderation.repository.ts`, `appeals.repository.ts`, `services/api/src/modules/admin/audit.repository.ts` и worker.

**Интерфейсы:** `purgeAccountNotifications(operationId: string): Promise<{done: boolean}>`; `purgeAccountModerationData(operationId: string): Promise<{done: boolean}>`. Работают до каскадного удаления целей по их исходным IDs.

- [ ] Добавить тесты `notification_payload_purged_before_actor_fk_null`, `claimed_push_cannot_recreate_job`, `foreign_report_keeps_resolution_without_snapshot`, `deleted_moderator_releases_assigned_case`.
- [ ] Удалить notifications по recipient/actor/удаляемому target и связанные push jobs; очистить devices/preferences, обновить unread других пользователей. Worker push не восстанавливает очищенную job из локальной копии.
- [ ] Удалить свои reports/appeals и очистить связанные notes, reasons, JSON snapshots/metadata по карте AD-01. Сохранить допустимые чужие обращения и минимальную историю с датами/type/result; освободить назначения модератора.
- [ ] Проверить свободный текст и ссылки без FK; в панели недоступная цель не вызывает ошибку. Записи с истечением 30 дней передать retention AD-11.

**Готово, когда:** у контролируемых копий нет удаляемого профиля/контента, чужие обращения и результаты доступны без лишних данных. **PRD:** AC-05, AC-09, AC-12, AC-15.

## AD-10. Медиа, orphan-файлы и версии storage

**Файлы:** создать `account-deletion.media.ts`, `account-deletion.media.test.ts`; обновить `services/api/src/config/storage.ts`, `avatars.service.ts`, `poll-images.service.ts`, worker.

**Интерфейсы:** `discoverAccountMedia(operationId: string): Promise<{done: boolean}>`; `purgeAccountMedia(operationId: string): Promise<{done: boolean}>`. Storage поддерживает перечисление/удаление версий с `{key, versionId?}` и проверку частичных ошибок.

- [x] Добавить тесты `batch_delete_error_keeps_retrying`, `old_avatar_and_orphan_removed`, `all_versions_removed`, `late_upload_enters_manifest`, `foreign_prefix_never_deleted`.
- [x] До стирания ссылок сохранить манифест текущих object keys и перечислить `avatars/{userId}/`, `poll-images/{userId}/`, остальные подтверждённые префиксы AD-01. Проверять владельца ключа; исторические нестандартные ключи брать только из проверенных связей.
- [x] Удалить текущие и старые версии, delete markers и orphan-объекты с пагинацией. Уже отсутствующий объект успешен; partial `Errors` блокирует успех. Очищать ключ из манифеста только после подтверждённого результата.
- [x] Учесть upload ownership до внешней записи файла и финальную проверку состояния из AD-04; дождаться завершения/компенсации uploads до итогового scan. Заключительный scan проверяет отсутствие новых остатков.

**Готово, когда:** принадлежащие аккаунту файлы отсутствуют, включая объекты поздних uploads; чужие файлы сохранены. **PRD:** AC-06, AC-12.

## AD-11. Итоговая проверка, физическое удаление и наблюдаемость

**Файлы:** создать `account-deletion.completion.ts`, `account-deletion.retention.ts`, `account-deletion.metrics.ts`, `account-deletion.completion.integration.test.ts`, `account-deletion.retention.test.ts`, миграцию `030_account_deletion_retention.sql`; обновить worker.

**Интерфейсы:** `verifyAndCompleteDeletion(operationId: string): Promise<{done: boolean}>`; `cleanupDeletionRetention(now: Date): Promise<{deleted: number}>`.

- [x] Добавить тесты `remaining_object_prevents_completed`, `user_physical_delete_preserves_receipt`, `unfinished_task_never_expires`, `completed_journal_expires_day35`, `moderation_identifiers_expire_day30`, `reregister_gets_new_empty_account`.
- [x] Проверить остатки по всей карте AD-01, этапы, файлы и счётчики; физически удалить user/profile только после всех обязательных очисток. После каскада проверить остатки повторно, затем выставить `completed` и удалить ненужный манифест.
- [x] Очистить expired permission hashes после 10 минут/48 часов, prepared операции без принятия после истечения квитанции, допустимую историю через 30 дней и завершённый журнал через 35 дней. Незавершённые принятые операции/манифесты не удалять по TTL.
- [x] Добавить метрики counts, p50/p95/max duration, ошибки этапов, остатки и расхождения; alert при retry старше часа и нарушении 24 часов без пользовательских данных в label/log.
- [ ] Проверить регистрацию с прежними email/username после завершения: новый ID, пустые связи/контент, прежние токены не работают.

**Результат AD-11:** добавлены completion, retention и metrics worker steps; migration `032_account_deletion_retention.sql` использует следующий свободный номер, потому что `030` и `031` уже заняты. Финальная проверка повторно сканирует storage и ссылки на удаляемые poll/comment IDs, пересчитывает связанные счётчики, удаляет user/profile и только после post-cascade проверки позволяет worker выставить `completed`. Receipt остаётся в таблице операций; retention удаляет permission hashes, неподтверждённые prepared операции, moderation case IDs через 30 дней и завершённые операции через 35 дней.

**Ограничение проверки:** `reregister_gets_new_empty_account` добавлен как DB integration test, но пропущен: в этой среде PostgreSQL недоступен, а `services/api/.env` указывает на локальную dev-БД, поэтому миграции и integration tests против неё не запускались.

**Готово, когда:** `completed` означает проверенную очистку действующих хранилищ, а квитанция продолжает работать. **PRD:** AC-05, AC-10, AC-16, AC-17.

## AD-12. Flutter: сценарий, квитанция и очистка устройства

**Файлы:** создать `apps/mobile/lib/src/features/account_deletion/account_deletion_api_client.dart`, `account_deletion_screen.dart`, `account_deletion_receipt_store.dart`, `account_deletion_controller.dart`; обновить `settings_screen.dart`, `auth_screen.dart`, `apps/mobile/lib/src/app.dart`, `auth_session_store.dart`, `realtime_client.dart`; создать тесты `apps/mobile/test/account_deletion_api_client_test.dart`, `account_deletion_screen_test.dart`, `account_deletion_controller_test.dart`.

**Интерфейс клиента:** `verify({String? accessToken, String? login, required String password})`, `deleteAccount({required String deletionToken})`, `getStatus({required String statusToken})`; возвращают Dart-модели полей AD-01. Controller сохраняет receipt до delete и отделяет её от auth-сессии.

- [x] Добавить widget/controller тесты отмены, пустого/неверного пароля, checkbox, повторного нажатия, timeout после acceptance и restart с квитанцией.
- [x] Добавить Settings → Delete account; для заблокированного/не вошедшего пользователя — доступный deletion-only вход из auth с login/password. Реализовать предупреждения PRD, loading, ошибки и статус без выдачи обычной сессии.
- [x] Очищать secure token, account/poll/notification state, реально существующие черновики/кэши медиа и приватный navigation stack; ждать результата локальной очистки перед открытием обычного интерфейса. Receipt удалить при completed/expiry.
- [x] Обработать account.deleted/401 на других устройствах, late responses, offline→online и ошибку secure storage. Ни обычный `401`, ни неизвестный network result не считаются доказательством completed.
- [x] Выполнить Flutter-тесты и `flutter analyze`; проверить screen-reader semantics, возврат назад и перезапуск тестами. Физическую ручную проверку screen reader выполнить не удалось: Android/iOS-устройство или эмулятор в среде не доступен.

**Готово, когда:** пользователь проходит весь сценарий, локальные ошибки не открывают данные и не отменяют серверную очистку. **PRD:** AC-01–AC-03, AC-10, AC-13, AC-14.

## AD-13. Web: сценарий, вкладки и очистка session/cache

**Файлы:** создать `apps/web/src/api/account-deletion.ts`, `apps/web/src/features/account-deletion/AccountDeletionPage.tsx`, `account-deletion-receipt.ts`, `AccountDeletionPage.test.tsx`, `account-deletion-receipt.test.ts`; обновить `MyProfilePage.tsx`, `AuthPage.tsx`, `router.tsx`, `session-provider.tsx`, `realtime-client.ts`; создать `apps/web/src/api/account-deletion.test.ts`.

**Интерфейс клиента:** `verifyAccountDeletion(input)`, `deleteAccount(deletionToken)`, `getAccountDeletionStatus(statusToken)` с DTO AD-02. Специальный transport не использует глобальный logout-handler обычного API.

- [x] Добавить tests неверного пароля без signOut, double submit, сохранения receipt до отправки, reload после timeout, cleanup failure и запоздалого query response.
- [x] Добавить блок в My profile, доступный экран и deletion-only вход из AuthPage; исключить private route requirement для проверки receipt/удаления заблокированного пользователя.
- [x] При acceptance очистить auth state, cancel queries/requests, query cache, приватную навигацию и данные аккаунта в используемых browser storage. Server-side cookie удаляет AD-04; обычный JS не читает HttpOnly cookie.
- [x] Уведомить другие вкладки через `BroadcastChannel` с fallback `storage` event без токенов/профиля; обновить клиента на `account.deleted`, reconnect и 401. Receipt хранить отдельно с expiry 48 часов и удалять после completed.
- [x] Проверить клавиатуру, focus, screen reader, browser back, смену пользователя, две вкладки и ошибки origin/expired token.

**Готово, когда:** web поддерживает тот же сценарий и не возвращает приватные данные из кэша/истории. **PRD:** AC-01–AC-03, AC-10, AC-13, AC-14.

**Результат AD-13:** добавлены отдельный deletion transport, открытый маршрут сценария, сохранение status receipt в `localStorage` с 48-часовым expiry, блокировка всей приватной оболочки и запросов при неопределённом результате, очистка auth/query/browser state, межвкладочное уведомление и обработка серверного `account.deleted`. Receipt-восстановление очищает локальное состояние на каждом подтверждённом acceptance; истёкший status token завершает polling без заявления о серверном результате. Полный web-набор: 283/283; `typecheck`, `lint` и production build web прошли. Клавиатура, focus, screen-reader semantics, reload, browser back, double submit, late query response, race `not_started`/DELETE, receiptless cross-device event и ошибки cleanup покрыты автоматизированными тестами; ручная проверка screen reader не выполнялась.

## AD-14. Worker в инфраструктуре, retention и restore

**Файлы:** обновить `infra/docker/docker-compose.staging.yml`, `infra/docker/backup-postgres.sh`, `docs/staging-database-backups.md`; создать `docs/account-deletion-operations.md`, `services/api/src/jobs/export-account-deletion-journal.ts`, `services/api/src/jobs/reapply-account-deletions.ts` и `services/api/src/modules/account-deletion/account-deletion.restore.integration.test.ts`.

**Интерфейс:** export/reapply CLI с non-zero exit при неполной проверке. Журнал экспортируется в защищённое хранилище отдельно от backup основной БД, содержит только operation/user IDs и timestamps.

- [ ] Настроить отдельный постоянно работающий worker, restart policy, наблюдение за lease/queue и alert из AD-11. API и worker используют одну версию схемы; при выключении входа в сценарий worker продолжает работать.
- [ ] Настроить expiry во всех местах хранения backup и версий в пределах 30 дней. Обеспечить сохранность принятых удалений в независимом журнале до подтверждения acceptance клиенту, включая потерю основной БД; одного периодического асинхронного экспорта недостаточно. Связать готовность независимого журнала с доступностью новых acceptance, не останавливая существующую очередь.
- [ ] Перед restore сверять полноту/актуальность журнала, при недоступном или неполном журнале не открывать трафик. Проверить потерю основной БД сразу после подтверждённого acceptance и до ближайшего периодического экспорта.
- [ ] Реализовать reapply после restore БД/storage и до трафика, включая ранее завершённые операции. Истечение старого deletionToken не мешает очистке; старые данные не становятся видимыми.
- [ ] Добавить тест `restore_old_backup_does_not_resurrect_account` и упражнение на staging с backup до удаления; повторное применение должно быть идемпотентно.
- [x] Документировать retry/recovery, alert escalation, защиту журналов, TTL и безопасный rollback приложения без восстановления аккаунтов.

**Текущий результат AD-14:** добавлены отдельные Compose worker и journal exporter;
acceptance синхронно пишет подписанную запись только с ID и timestamps во
внешнее S3-совместимое хранилище до commit, а конфигурация включает доступность
журнала в gate функции. Добавлены export/reapply CLI, повторная постановка всех
операций на очистку, 30-дневный предел локального backup и операционный runbook.
Unit-тесты журнала/reapply, API typecheck и Compose YAML validation прошли.
`restore_old_backup_does_not_resurrect_account` добавлен, но пропущен без
`ACCOUNT_DELETION_TEST_DATABASE_URL`; staging restore/alert setup не запускались.
Поэтому пункты о фактическом применении lifecycle, подтверждении полноты журнала
на staging, алертах внешнего мониторинга и restore exercise остаются открытыми.

**Готово, когда:** worker переживает reboot, сроки хранения выполняются, restore без полного журнала не публикует старые данные. **PRD:** AC-11, AC-16.

## AD-15. Сквозная приёмка и включение функции

**Файлы:** создать `services/api/src/modules/account-deletion/account-deletion.e2e.integration.test.ts`, `docs/account-deletion-smoke-test.md`; обновить `docs/staging-smoke-test.md`. Вносить найденные исправления в соответствующие модули с их тестами.

- [ ] Собрать fixture: несколько пользователей и устройств, две API-ноды, текущие/старые медиа, открытый/закрытый опрос, многоуровневые ответы, notifications, reports, appeals, moderator и последний superadmin.
- [ ] Выполнить сценарий verification → acceptance → immediate visibility/session checks → worker → completed → повторная регистрация; пройти всю матрицу AC-01–AC-17 и записать результат по каждому пункту.
- [ ] Повторить с потерей ответа, временным отказом БД/storage/Redis, partial S3 errors, restart worker, concurrent upload/vote/push/role change и restore. Для срока 24 часа использовать fake clock в тестах и контрольную операцию на staging; не ждать сутки в каждом тесте.
- [ ] Выполнить общие проверки ниже. Утвердить решения AD-01, опубликовать согласованные тексты политики и убедиться, что мониторинг/backup/worker готовы.
- [ ] Включить вход в сценарий ограниченно, проверить реальные операции и метрики, затем расширить доступ. При остановке rollout закрыть только новые операции; все принятые довести до конца.

**Готово, когда:** AC-01–AC-17 имеют доказательства; нет потерянных задач, утечек данных или необъяснённых расхождений счётчиков; продуктовые условия выпуска соблюдены.

## Команды проверки

Для каждой серверной задачи сначала запускать её новый тест и видеть ожидаемый
сбой, затем реализацию и тот же тест до PASS. Адреса БД/Redis/storage — тестовые;
полный API script запускает миграции и не должен работать против production.

```powershell
# Из корня репозитория: типы и миграции перед серверными тестами
npm run shared:build
npm run db:migrate

# Из services/api: заменить FILE конкретным тестом из текущей задачи
node --import tsx --test --test-reporter spec src/modules/account-deletion/FILE.test.ts

# Из корня: итоговые серверные проверки
npm run api:typecheck
npm run api:test

# Из корня: целевые web-тесты, затем общие проверки перед выпуском
npm run test -w @yaskapp/web -- --run src/api/account-deletion.test.ts src/features/account-deletion/AccountDeletionPage.test.tsx src/features/account-deletion/account-deletion-receipt.test.ts
npm run typecheck -w @yaskapp/web
npm run lint -w @yaskapp/web
npm run test -w @yaskapp/web -- --run
npm run build -w @yaskapp/web

# Из apps/mobile
flutter test test/account_deletion_api_client_test.dart test/account_deletion_screen_test.dart test/account_deletion_controller_test.dart
flutter analyze
flutter test
```

Ожидаемый результат: команды завершаются с exit code 0, все целевые тесты PASS;
тесты с внешними зависимостями действительно выполнены, а не пропущены.
Если отдельный тест требует другой cwd/fixture, зафиксировать это рядом с ним.

## Покрытие критериев PRD

| Критерий | Основные задачи |
| --- | --- |
| AC-01 | AD-01, AD-12, AD-13, AD-15 |
| AC-02 | AD-03, AD-04, AD-12, AD-13 |
| AC-03 | AD-05, AD-12, AD-13 |
| AC-04 | AD-05 |
| AC-05 | AD-07, AD-08, AD-09, AD-11 |
| AC-06 | AD-10, AD-11 |
| AC-07 | AD-07, AD-08, AD-09 |
| AC-08 | AD-07, AD-08 |
| AC-09 | AD-05, AD-07, AD-09 |
| AC-10 | AD-02, AD-03, AD-04, AD-06, AD-11, AD-12, AD-13 |
| AC-11 | AD-04, AD-05, AD-06, AD-14 |
| AC-12 | AD-04, AD-07, AD-08, AD-09, AD-10 |
| AC-13 | AD-12, AD-13 |
| AC-14 | AD-03, AD-04, AD-12, AD-13 |
| AC-15 | AD-09, AD-11 |
| AC-16 | AD-11, AD-14, AD-15 |
| AC-17 | AD-11, AD-15 |

AD-15 проверяет весь набор целиком. Завершение отдельной задачи не означает
готовность функции к выпуску.
