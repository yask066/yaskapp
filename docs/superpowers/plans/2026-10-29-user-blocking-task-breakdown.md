# Личная блокировка пользователей — Implementation Plan / Task Breakdown

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Подготовка backlog не запускает реализацию и не выбирает способ исполнения.

**Goal:** Дать пользователю двустороннюю личную блокировку с управлением списком и единым применением во всех API, Flutter и публичном web.

**Architecture:** Направленная связь `user_blocks` с двусторонним эффектом, общая серверная политика доступа и согласованная сериализация мутаций. Персонализированная выдача и доставка проверяют актуальные отношения; ревизии и устойчивые события очищают клиентские кэши. Личная блокировка независима от глобальных санкций.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Redis, WebSocket, Firebase push, React/TanStack Query/Vitest, Flutter/Dart; существующие миграции и CI.

**Spec:** [PRD: Личная блокировка пользователей](../../prd-user-blocking.md).

**Статус:** 32 задачи, 8 этапов; UB-01 и UB-03 выполнены, UB-02 и UB-04–UB-32 открыты (30 задач в backlog). UB-03 использует DTO-независимые scenario facts; их формат сверяется после завершения UB-02. Пользователь утвердил пакет D01–D08, L01 и C01: правила, Android/iOS/React web, английский интерфейс и тексты. Дата: 2026-10-29.

Карточку можно переносить в трекер целиком: заголовок, зависимости, файлы,
чек-лист, критерий готовности и проверка. Размер S/M/L — относительный
объём с учётом проверки, не обещание календарного срока. L требует
нескольких согласованных изменений, но имеет один принимаемый результат.

## Global Constraints

- Связь `A → B` имеет двусторонний эффект, если существует `A → B` или `B → A`; каждый снимает только своё решение.
- Не менять `users.status`, роли, административные санкции, сессии другой стороны и полномочия модерации.
- Самоблокировка запрещена; PUT/DELETE идемпотентны; активное отношение привязано к UUID.
- Снять обе подписки атомарно со счётчиками; после unblock подписки не восстанавливать.
- Не удалять исторические голоса/лайки и не пересчитывать глобальные результаты из-за личного блока.
- Скрытый корень обсуждения не должен лишать доступа к разрешённым ответам A/C; тело, автор и excerpt скрытого комментария не выдаются.
- Нет уведомления другой стороне о блокировке/разблокировке; нет полей встречного решения в пользовательском API.
- Старые недопустимые notifications не возвращаются после unblock; проверки обязательны при создании, чтении и отправке.
- Опрос, профиль, комментарий и взаимодействие по недоступному ID возвращают общий `404 not_found`; удаление своего комментария сохраняет `204 No Content`.
- Block-list: default `limit=20`, диапазон `1–50`, порядок `created_at DESC` и UUID tie-breaker; cursor привязан к владельцу.
- Существующие проверки `public / followers / private`, авторизации, санкций и удаления продолжают действовать.
- Flutter и публичный web входят в пользовательский релиз. Публичный guest-доступ и публичные аватары остаются за границей защиты из раздела 4.1 PRD.
- Блокировка действует с commit для последующих операций; offline-копии и уже переданный push нельзя считать отозванными.
- Серверная защита включена на всех API/worker до первого доступного пользователю PUT; rollback сохраняет применение записанных блоков.
- Предлагаемые ориентиры: block/unblock p95 ≤ 1 с; invalidation активных устройств p95 ≤ 2 с; регрессия основных чтений ≤ 20% к baseline при одинаковой нагрузке. Утвердить по замерам до пилота.

## Review Focus

Пять обязательных пограничных проверок распределены по владельцам кода:

1. Транзакция уже захватила пользователя A, затем пытается захватить меньший UUID B: общий порядок блокировок не допускает deadlock — UB-05, UB-17, UB-29.
2. Скрыт корень B, доступный ответ C лежит за первой страницей: ветка остаётся достижимой, ID корня не разрешает читать body или отвечать B — UB-12, UB-22, UB-26.
3. Block → мгновенный unblock до фоновой обработки уведомлений: старый inbox и push не возвращаются — UB-06, UB-16, UB-17, UB-29.
4. Гостевой media-кэш, Back и поздний запрос переживают вход/смену аккаунта: старые данные не обходят viewer-политику — UB-14, UB-23, UB-27.
5. Commit прошёл, Redis-событие потеряно, worker перезапущен: ограничение действует, повтор события идемпотентен, клиент сверяется до восстановления контента — UB-18, UB-19, UB-23, UB-27, UB-29.

## Карта работ и порядок

| Этап | Задачи | Проверяемый результат |
| --- | --- | --- |
| P0. Решения и основание | UB-01–UB-03 | Правила, контракты, карта endpoint и воспроизводимые fixtures |
| P1. Серверное ядро | UB-04–UB-07 | БД, политика, атомарные отношения и приватный API управления |
| P2. Поверхности продукта | UB-08–UB-15 | Профили, подписки, опросы, поиск, страницы, комментарии, media, reports и deletion |
| P3. Уведомления и realtime | UB-16–UB-19 | Подавление истории, send-time guards, безопасная рассылка и восстановление |
| P4. Flutter | UB-20–UB-23 | Клиентский контракт, UI, ветки и синхронизация |
| P5. Публичный web | UB-24–UB-27 | Эквивалентные возможности, вкладки и viewer-scoped кэш |
| P6. Проверка качества | UB-28–UB-31 | Наблюдаемость, конкуренция, нагрузка, сквозная приёмка |
| P7. Выпуск | UB-32 | Совместимая миграция, пилот и безопасный откат |

Основная цепочка: `UB-01 → UB-02/UB-03 → UB-04 → UB-05 → UB-06 → UB-07`.
Дальше развиваются P2 и P3; клиенты могут начинать на согласованном
контракте UB-02 и fixtures UB-03, но закрываются с реальным API и событиями.
`P2 + P3 + P4 + P5 → UB-29/UB-30 → UB-31 → UB-32`.
UB-28 можно начать после контракта и завершить после серверных работ.

Зависимости карточек нужны для их полного закрытия. Клиентские модели и
UI можно начинать по контракту/fixtures до готовности API, но закрывать
задачу следует после указанной интеграции с сервером.

Flutter и web допускают независимую разработку. Изменения общего
`polls.repository.ts`, API bootstrap и контракта shared нужно интегрировать
последовательно либо явно назначить их владельца. Описание независимых
веток не является командой запуска агентов или нескольких чатов.

**Готовность задачи не означает готовность функции к выпуску.** Все
UB-01–UB-32 входят в заявленный объём; частичный релиз с непроверенным
путём чтения или доставки не закрывает эпик.

## Карта файлов и границы ответственности

Пути ниже относительны корню репозитория. Префиксы позволяют не повторять
длинные пути в каждой карточке:

| Префикс | Каталог |
| --- | --- |
| API | `services/api/src/` |
| SH | `packages/shared/src/` |
| MOB | `apps/mobile/lib/src/` |
| MT | `apps/mobile/test/` |
| WEB | `apps/web/src/` |
| DOC | `docs/` |

| Зона | Существующие опорные файлы | Предлагаемые новые файлы |
| --- | --- | --- |
| Решения/контракты/evidence | `DOC/prd-user-blocking.md`, существующие smoke/CI docs | `DOC/superpowers/specs/2026-10-29-user-blocking-decisions.md`, `DOC/user-blocking-api.md`, `DOC/user-blocking-evidence/endpoint-matrix.md`, `release-record.md` |
| Общие DTO | `SH/index.ts`, `SH/notifications.ts` | `SH/user-blocks.ts`, `SH/user-blocks.type-test.ts` |
| БД/ядро | `API/db/migrations/`, `API/app.ts`, `API/config/env.ts`, `API/modules/account-deletion/account-activity.guard.ts` | `API/modules/user-blocks/user-blocks.{repository,service,routes,policy,events,outbox,metrics}.ts`; соответствующие целевые tests |
| Существующие продуктовые домены | `API/modules/profiles/`, `polls/`, `search/`, `moderation/`, `account-deletion/` | Отдельные integration suites для блокировок без переноса всей логики доменов в новый модуль |
| Доставка | `API/modules/notifications/`, `API/jobs/notification-push-worker.ts`, `API/realtime/realtime.{hub,bus,routes}.ts` | `API/jobs/run-user-blocks-outbox-worker.ts`, `user-blocks-outbox-worker.ts` |
| Flutter | `MOB/features/profile/`, `polls/`, `realtime/`, `notifications/`, `MOB/core/read_request_scope.dart`, `MOB/app.dart` | `MOB/features/user_blocks/{user_block,user_blocks_api_client,user_blocks_store,block_user_dialog,blocked_users_screen}.dart`; tests в MT |
| Web | `WEB/api/`, `WEB/app/`, `WEB/features/{profiles,comments,polls,notifications}/`, `WEB/components/PollCard.tsx`, `WEB/core/pagination/` | `WEB/api/user-blocks.ts`, `WEB/features/user-blocks/{user-blocks-store,visibility-coordinator}.tsx`, `BlockUserDialog.tsx`, `BlockedUsersPage.tsx`; tests рядом |
| Измерения/выпуск | `.github/workflows/ci.yml`, `services/api/package.json`, `infra/docker/`, клиентские env examples | `scripts/user-blocking-load.mjs`, `DOC/user-blocking-release-checklist.md` |

Имена новых файлов — решения декомпозиции, а не утверждение, что они уже
существуют. Миграции получают следующие свободные номера при реализации;
применённые миграции не редактируются. Новые пакеты, чат и переписывание
существующих store/пагинации в объём не входят.

## Общие интерфейсы между задачами

Это предлагаемые имена для согласования в UB-02. После её закрытия
исполнители используют один контракт; если он изменён, обновляются все
зависимые карточки и типы, а не создаются параллельные варианты.

| Владелец | Производимый интерфейс | Потребители |
| --- | --- | --- |
| UB-02 | `UserBlockState = { targetUserId: string; blockedByViewer: boolean; viewerVisibilityRevision: string }`; `BlockedUserItem`; `UserBlockListResponse = { items: BlockedUserItem[]; nextCursor: string \| null; viewerVisibilityRevision: string }` | UB-06/07, UB-20, UB-24 |
| UB-02 | `CommentListItem = { kind: 'comment'; comment: PollComment } \| { kind: 'unavailable'; rootId: string; availableRepliesCount: number }` для versioned/capability-выдачи | UB-12, UB-22, UB-26; старый PollComment не заменяется молча |
| UB-02 | `UserBlocksRealtimeEvent`: `user_blocks.changed` только владельцу исходящего решения; `viewer.visibility_invalidated` с одной ревизией затронутому viewer; snapshot ревизии через `GET /profiles/me/visibility` | UB-07, UB-18/19, UB-23, UB-27 |
| UB-05 | `hasEffectiveUserBlock(executor: QueryExecutor, firstUserId: string, secondUserId: string): Promise<boolean>`; `findBlockedUserIds(executor, viewerId: string, candidateIds: readonly string[]): Promise<Set<string>>` | UB-06, UB-08–UB-19 |
| UB-05 | `lockUserBlockParticipants(client: PoolClient, userIds: readonly string[]): Promise<void>`; `assertNoUserBlock(client, firstUserId: string, secondUserId: string): Promise<void>`; ошибки преобразуются в общий `not_found` | Все взаимодействия/доставки; блокировка не подменяет проверку active/deleted |
| UB-06 | `setUserBlock({ blockerId: string; blockedId: string; blocked: boolean }): Promise<UserBlockState>`; операции suppression и outbox внутри той же транзакции | UB-07; UB-16/19 читают сохранённые результаты |
| UB-07 | Четыре endpoint из раздела 10 PRD + приватная сверка текущей ревизии без чужих идентификаторов | Оба клиента |
| UB-20 | `UserBlocksApiClient.setBlocked(...)`, `.getState(...)`, `.listBlocked(...)`, `.getVisibilityRevision(...)`; `UserBlocksStore` с session epoch и numeric-safe revision | UB-21–UB-23 |
| UB-24 | `setUserBlocked(userId: string, blocked: boolean, signal?: AbortSignal): Promise<UserBlockState>`; `getUserBlockState`, `listBlockedUsers`, `getVisibilityRevision`; viewer-scoped provider | UB-25–UB-27 |

`GET /profiles/me/visibility` — техническое предложение декомпозиции для
обязательной сверки после reconnect; PRD оставлял этот способ детализации.
Ответ: `{ viewerVisibilityRevision: string }`, auth required, `no-store`.
UB-02 фиксирует также перенос ревизии на персонализированных HTTP-ответах
и безопасный ответ на старый клиент без поддержки заглушек. Этот документ
не объявляет новые предложения утверждёнными продуктом.

## Как выполнять и проверять

Для каждой задачи с изменением поведения:

1. Написать указанные регрессионные тесты с конкретными assertions карточки.
2. Запустить целевую проверку; убедиться, что она падает из-за отсутствующего
   поведения, а не из-за окружения.
3. Выполнить чек-лист изменения.
4. Повторить целевую проверку и typecheck/analyze; подтвердить PASS.
5. Проверить diff и сделать отдельный commit только файлов задачи.

Для документационных UB-01/02 не создавать тесты, зеркалирующие текст;
UB-02 проверяется type-tests, когда вводит типы. Интеграционные тесты
используют изолированные fixtures; миграции и destructive fixtures
запускаются только в тестовой БД. Код и тесты сейчас не изменяются.

| Код | Команда и ожидаемый результат |
| --- | --- |
| SHARED | Из корня: `npm run shared:build` — exit 0 |
| API-TARGET | Из `services/api`: `node --import tsx --test <пути tests из карточки относительно API>` — все tests passed; миграции предварительно применены к тестовой БД |
| API-TYPES | Из корня: `npm run api:typecheck` — exit 0 |
| API-FINAL | Из корня: `npm run api:test`, `npm run api:build` — все тесты passed / exit 0 |
| WEB-TARGET | Из корня: `npm run test -w @yaskapp/web -- --run <пути tests относительно WEB>` — passed |
| WEB-FINAL | Из корня: `npm run typecheck -w @yaskapp/web`, `npm run lint -w @yaskapp/web`, `npm run test -w @yaskapp/web -- --run`, `npm run build -w @yaskapp/web` — exit 0 |
| MOBILE-TARGET | Из `apps/mobile`: `flutter test <пути tests относительно apps/mobile>` — passed |
| MOBILE-FINAL | Из `apps/mobile`: `flutter analyze`, `flutter test`, `flutter build apk --debug` — exit 0; утверждённый пакет UB-01 включает iOS: сборка на macOS/Xcode и staging smoke на iPhone с VoiceOver/large text/push/reconnect/resume. Фактические проверки фиксируются в UB-31/32 |
| DOC-CHECK | Проверка local links, непрерывности UB-ID/зависимостей, покрытия AC-01…AC-24 и `git diff --check` для изменённых документов — без ошибок |

У каждой задачи ниже названы конкретные tests; подстановка в шаблоны —
способ не повторять одинаковые команды. Полные suites выполняются на
завершении платформенного этапа и UB-31, а не после каждого изменения.

## P0. Решения и основание

### UB-01. Утвердить правила первого релиза

**Тип / размер:** Product + engineering, M. **Зависимости:** нет. **PRD:** 4–8, 18.

**Файлы:** обновить PRD; создать `DOC/superpowers/specs/2026-10-29-user-blocking-decisions.md`.

- [x] Пройти все восемь предложений раздела 18: исторические реакции/отзыв, заглушки веток, inbox после unblock, обе платформы, guest/media, подписки, служебные роли, границы первого релиза.
- [x] Зафиксировать принятый вариант каждого правила, тексты подтверждений/недоступности, языки и поддерживаемые Flutter-поставки; не приписывать пользователю молчаливое утверждение.
- [x] Обновить PRD и зависимые карточки при изменениях; отдельно зафиксировать всё, что меняет объём/AC.

**Статус: выполнена 2026-10-29.** [Пакет решений UB-01](../specs/2026-10-29-user-blocking-decisions.md)
утверждён ответом пользователя «Утверждаю весь пакет UB-01»: D01–D08,
Android/iOS/React web, английский интерфейс L01 и тексты C01 без изменений.
PRD и зависимые карточки синхронизированы. AC-01…AC-24 сохранены.
DOC-CHECK пройден; продуктовое основание для UB-02/03 готово.

**Готово, когда:** каждое существенное продуктовое решение имеет явный статус и выбранный вариант; исполнитель не выбирает между сохранением и удалением истории самостоятельно.

**Проверка:** DOC-CHECK; сверка документа решений с разделом 18 PRD. Это точка продуктового согласования перед реализацией, а не препятствие подготовке backlog.

### UB-02. Зафиксировать API, события, совместимость и порядок транзакций

**Тип / размер:** Backend + clients design, L. **Зависимости:** UB-01. **PRD:** 7–11, 16.

**Файлы:** создать `DOC/user-blocking-api.md`, `SH/user-blocks.ts`, `SH/user-blocks.type-test.ts`; изменить `SH/index.ts`, `SH/notifications.ts`.

- [ ] Описать DTO и endpoint из «Общих интерфейсов», cursor/error semantics, decimal-string ревизии и приватный `GET /profiles/me/visibility`.
- [ ] Зафиксировать capability/version для `CommentListItem`, нейтральные события и перенос viewer revision на чтениях; старые клиенты не получают скрытый body для совместимости.
- [ ] Зафиксировать согласованность данных и revision: чтение нельзя маркировать более новой ревизией, полученной только после загрузки старого payload. Snapshot/контекст revision снимается до чтения или в том же согласованном read snapshot.
- [ ] Выбрать конкретную схему необратимого suppression истории, включая block→unblock до worker, порядок user/poll/comment/job locks и границу авторизации push.
- [ ] Ввести compile-time тесты: DTO не имеет `blockedByTarget`; unavailable item не содержит author/body; revision — string; `nextCursor` обязателен и nullable.
- [ ] Зафиксировать численные rate limits, формат capability и минимальные версии/режим legacy; описать добавления к схеме БД и контракты UB-04/06/16/19.

**Готово, когда:** последующие задачи используют одну версию DTO/событий и конкретный ADR хранения/locking; решения закрывают быстрый unblock и старые клиенты.

**Проверка:** SHARED, API-TYPES; review API-примеров native/cookie/legacy. Выбор внутренней схемы не меняет продуктовый эффект UB-01.

### UB-03. Подготовить fixtures, карту путей доступа и baseline

**Тип / размер:** QA + backend, M. **Зависимости:** UB-01; формат fixtures согласовать с UB-02. **PRD:** 2, 12–14.

**Файлы:** создать `API/modules/user-blocks/user-blocks.fixtures.ts`, `user-blocks.fixtures.test.ts`, `DOC/user-blocking-evidence/endpoint-matrix.md`, `baseline.md`.

- [x] Подготовить A/B/C, встречные подписки, все четыре состояния блока, public/followers/private polls, корень B и более одной страницы ответов A/C, старые unread и push jobs.
- [x] Добавить недоступный аккаунт, роль moderator, повторный username с новым UUID, cookie/Bearer и отдельные гостевые сценарии.
- [x] Перечислить каждый read/write/delivery endpoint и назначить владельца UB-08–UB-19; проверить, что известные пути media, hydration и reply lookup включены.
- [x] Зафиксировать воспроизводимый no-block dataset, команды и счётчики; latency/query-count baseline явно оставлен незамеренным, потому что локальная PostgreSQL недоступна и UB-30 runner ещё не создан.

**Готово, когда:** fixtures детерминированно воспроизводят матрицу A/B/C и очищаются без чужих данных; карта имеет исполнителя и negative test на каждый путь.

**Проверка:** API-TARGET `modules/user-blocks/user-blocks.fixtures.test.ts`; baseline содержит команды, окружение, dataset и реальные результаты либо явную незавершённость замера.

**Выполнено 2026-10-29:** fixture IDs изолированы по seed; cleanup ограничен ID строк fixtures; маршрутная матрица сверена с 43 относящимися к блокировке HTTP route entries. По выбору пользователя fixtures не зависят от незавершённых DTO UB-02; сверить потребителей при закрытии UB-02. Измерения производительности не выполнены из-за недоступной локальной PostgreSQL и явно отмечены как ожидающие UB-30.

## P1. Серверное ядро

### UB-04. Добавить схему блоков, ревизий, suppression и outbox

**Тип / размер:** Backend / DB, M. **Зависимости:** UB-02, UB-03. **PRD:** 9, 11.1, 16.

**Файлы:** новые миграции в `API/db/migrations/`; создать `API/modules/user-blocks/user-blocks.schema.integration.test.ts`.

- [ ] Добавить `user_blocks` с уникальной направленной парой, CHECK self, FK/cascade, direct/reverse/list indexes; применённые миграции оставить неизменными.
- [ ] Добавить viewer revision и утверждённые UB-02 структуры suppression/outbox с индексами claim/retry/cleanup и без копий имён/email.
- [ ] Проверить apply на существующей БД, повтор запуска migrate, конкуренцию дублей, FK-cleanup обеих сторон и нулевое влияние на существующие sanctions/follows.

**Готово, когда:** БД сама запрещает self/duplicate; схема поддерживает обе проверки отношений, pagination и устойчивую обработку после commit.

**Проверка:** `npm run db:migrate` на тестовой БД; API-TARGET `modules/user-blocks/user-blocks.schema.integration.test.ts`. Сохранить планы индексов для UB-30.

### UB-05. Реализовать общую политику и согласованный порядок locks

**Тип / размер:** Backend, L. **Зависимости:** UB-04. **PRD:** 4, 9, 11.2.

**Файлы:** создать `API/modules/user-blocks/user-blocks.policy.ts`, `user-blocks.policy.test.ts`, `user-blocks.locking.integration.test.ts`; согласовать `API/modules/account-deletion/account-activity.guard.ts`.

- [ ] Реализовать `hasEffectiveUserBlock`, `findBlockedUserIds`, `lockUserBlockParticipants` и `assertNoUserBlock` из общих интерфейсов; возвращать совпадения пакетно.
- [ ] Разделить locking и проверку active: PUT может направляться существующей административно заблокированной цели; обычные взаимодействия сохраняют прежние active guards.
- [ ] Зафиксировать один канонический порядок всех пользователей перед locks профилей/poll/comment/jobs; запретить nested acquisition «сначала recipient, потом меньший actor UUID».
- [ ] Проверить тестами 0/1/2 направленных блока, self, C, пакет без дублей, отсутствующую цель и ошибку БД: ошибка проверки не даёт доступ.

**Готово, когда:** общую политику можно использовать на чтении и внутри мутации без независимых трактовок; сериализация согласована с deletion и push.

**Проверка:** API-TARGET `modules/user-blocks/user-blocks.policy.test.ts`, `modules/user-blocks/user-blocks.locking.integration.test.ts`; API-TYPES. Детерминированная гонка с барьерами завершается без deadlock.

### UB-06. Реализовать атомарные block/unblock и снятие подписок

**Тип / размер:** Backend, L. **Зависимости:** UB-04, UB-05. **PRD:** 8.2, 9, AC-03/04/14/15/20.

**Файлы:** создать `API/modules/user-blocks/user-blocks.repository.ts`, `user-blocks.service.ts`, `user-blocks.mutations.integration.test.ts`, `user-blocks.events.ts`, `user-blocks.outbox.ts`; использовать `API/modules/profiles/follows.repository.ts`.

- [ ] Реализовать `setUserBlock`: одна транзакция для связи, обеих подписок, четырёх затронутых счётчиков, ревизий, suppression boundary и намерения отправить события.
- [ ] Сохранить дату блока и счётчики при повторном PUT; отсутствие строки при DELETE — успех; повышать ревизии только согласно правилам UB-02.
- [ ] При unblock удалять только исходящее решение, не создавать follows и не отменять suppression истории; встречный блок продолжает действовать.
- [ ] Проверить rollback на каждом значимом шаге, две встречные операции и block→unblock до запуска outbox/notification worker.

**Готово, когда:** после commit не остаётся взаимных подписок, повтор не портит counters; сохранено достаточно данных для немедленного и окончательного подавления старых уведомлений.

**Проверка:** API-TARGET `modules/user-blocks/user-blocks.mutations.integration.test.ts`; assertions на фактические follows, profile counters, revisions, suppression и outbox; API-TYPES.

### UB-07. Добавить приватный API управления и сверки

**Тип / размер:** Backend, M. **Зависимости:** UB-06. **PRD:** 5, 10, AC-02/03/21.

**Файлы:** создать `API/modules/user-blocks/user-blocks.routes.ts`, `user-blocks.routes.integration.test.ts`, `viewer-visibility-context.ts`, `viewer-visibility-context.test.ts`; изменить `API/app.ts`; использовать существующий rate limiter/auth.

- [ ] Подключить PUT/DELETE/GET `/users/:userId/block`, GET `/profiles/me/blocks`, GET `/profiles/me/visibility` по UB-02 с cookie/Bearer и origin guards.
- [ ] Реализовать owner-bound cursor, limit 20/1–50, минимальные данные активной цели и `user=null` для недоступной; не раскрывать встречный блок.
- [ ] Проверить self/invalid/auth/origin/rate-limit/unknown/deleted, neutral GET false, идемпотентный DELETE, чужой cursor и стабильный порядок списка.
- [ ] Персонализированные ответы выдавать `no-store`; связать включение создания блоков с release control UB-28, по умолчанию выключенным.
- [ ] Ввести общий `viewer-visibility-context` для персонализированных JSON-чтений: передать revision по UB-02 и проверить, что поздний старый payload не получает новую ревизию. Подключить его к защищаемым routes UB-08–UB-16; media отдельно UB-14.

**Готово, когда:** есть проверяемый API управления только своими решениями; timeout можно разрешить сверкой, не читая чужой профиль.

**Проверка:** API-TARGET `modules/user-blocks/user-blocks.routes.integration.test.ts`, `modules/user-blocks/viewer-visibility-context.test.ts`; API-TYPES. Все DTO проходят type-contract UB-02; отдельный тест блокирует ответ между чтением payload и завершением HTTP.

## P2. Поверхности продукта

### UB-08. Применить блок к профилям и подпискам

**Тип / размер:** Backend, M. **Зависимости:** UB-05, UB-06, UB-07. **PRD:** 6, 9, AC-04/05/07.

**Файлы:** изменить `API/modules/profiles/profiles.{routes,service,repository}.ts`, `follows.repository.ts`; создать `user-blocks.integration.test.ts` в том же каталоге; расширить `follows.repository.test.ts`.

- [ ] Скрыть полный профиль и пользовательские списки опросов в обе стороны; block-list остаётся отдельным минимальным исключением.
- [ ] Фильтровать followers/following текущего viewer, включая списки C, до limit; не менять граф C из-за фильтра.
- [ ] Проверять follow внутри общей сериализации с блоком; старый client follow по ID получает общий `404`, а unsubscribe не восстанавливает связь.
- [ ] Проверить оба направления, guest, третий аккаунт и реальные counters после гонки follow/block.

**Готово, когда:** нельзя подписаться после блока или получить профиль через списки, а C сохраняет обычные права.

**Проверка:** API-TARGET `modules/profiles/user-blocks.integration.test.ts`, `modules/profiles/follows.repository.test.ts`; API-TYPES.

### UB-09. Защитить чтение опросов, голоса и лайки опросов

**Тип / размер:** Backend, L. **Зависимости:** UB-05, UB-06, UB-07. **PRD:** 6, 11.2, AC-06/07/09.

**Файлы:** изменить `API/modules/polls/polls.{routes,service,repository}.ts`; создать `poll-user-blocks.integration.test.ts` в том же каталоге.

- [ ] Применить viewer-политику к `findViewablePollRecordById`, `hydratePolls`, спискам по автору и выдаче результатов мутаций; внутренние service/admin helpers не становятся публичным обходом.
- [ ] Перед новым/сменённым голосом, лайком и отзывом реакции проверить связь с автором внутри транзакции; действуют выбранные UB-01 правила отмены на скрытом объекте.
- [ ] Сохранить прежние votes/likes, ревизии и агрегаты от изменения одного блока; не пересчитать итог для viewer.
- [ ] Проверить public/followers/private, собственный опрос, C и отсутствие body в ошибках по ID.

**Готово, когда:** известный poll ID не даёт просмотра или взаимодействия между A/B; голоса и лайки C работают, глобальные итоги неизменны.

**Проверка:** API-TARGET `modules/polls/poll-user-blocks.integration.test.ts`, `modules/polls/polls.integration.test.ts`; API-TYPES.

### UB-10. Фильтровать поиск и популярные аккаунты

**Тип / размер:** Backend, M. **Зависимости:** UB-05, UB-08, UB-09. **PRD:** 6, 11.2, AC-05.

**Файлы:** изменить `API/modules/search/search.repository.ts`, `search.service.ts`, `API/modules/profiles/profiles.repository.ts`; расширить `search.repository.test.ts`; создать `search.user-blocks.integration.test.ts`.

- [ ] Исключать эффективные блоки в поиске пользователей/опросов и popular users до LIMIT и вычисления следующего cursor.
- [ ] Сохранить ранжирование, сортировки и current-viewer state остальных результатов, не менять глобальную популярность из-за блока.
- [ ] Проверить совпадающие username/displayName, страницу из одних скрытых кандидатов, встречный блок и поиск после unblock.

**Готово, когда:** hidden-аккаунт не появляется в поиске/подборках и не обрывает выдачу C; нет N+1 по авторам.

**Проверка:** API-TARGET `modules/search/search.repository.test.ts`, `modules/search/search.user-blocks.integration.test.ts`; API-TYPES.

### UB-11. Сохранить корректную пагинацию и снимки ленты

**Тип / размер:** Backend, L. **Зависимости:** UB-09; fixtures UB-03. **PRD:** 11.3, AC-05/13.

**Файлы:** изменить `API/modules/polls/polls.repository.ts`, `poll-feed-snapshots.repository.ts`, при необходимости `polls.service.ts`; создать `poll-pagination.user-blocks.integration.test.ts`; расширить `poll-feed-snapshots.test.ts`.

- [ ] Фильтровать newest/subscriptions с актуальным viewer до limit; запись snapshot не считать разрешением доступа.
- [ ] При чтении popular продвигать cursor по просмотренным позициям и гидратировать только доступные ID; ограничить пакетный проход без потери доступного хвоста.
- [ ] Проверить старый cursor после блока, полностью скрытый диапазон, несколько пустых промежуточных страниц, конец snapshot, unblock и смену viewer.
- [ ] Не менять существующий TTL/owner/sort contracts и не раздувать snapshot всеми персонализированными объектами.

**Готово, когда:** список не выдаёт B, не зацикливается и достигает доступных C за скрытым диапазоном; `nextCursor=null` соответствует концу.

**Проверка:** API-TARGET `modules/polls/poll-pagination.user-blocks.integration.test.ts`, `modules/polls/poll-feed-snapshots.test.ts`; API-TYPES. Клиентский empty-page проход проверяется UB-23/27.

### UB-12. Реализовать чтение комментариев и заглушки корней

**Тип / размер:** Backend, L. **Зависимости:** UB-02, UB-05, UB-09. **PRD:** 7, AC-06/08/13.

**Файлы:** изменить `API/modules/polls/polls.{repository,service,routes}.ts`; создать `comment-user-blocks.integration.test.ts`; при необходимости выделить `poll-comment-visibility.ts` с одной ответственностью.

- [ ] Применить политику к roots, replies, адресному comment GET и parent preview; скрытый опрос закрывает все вложенные пути.
- [ ] Выдать `CommentListItem` по контракту UB-02: скрытый корень с разрешёнными ответами — заглушка без author/body; без таких ответов корень исключается.
- [ ] Разрешить чтение доступных replies скрытого корня без выдачи самого скрытого комментария; наличие C за первой страницей не теряет ветку.
- [ ] Проверить quoted context, repliesCount доступных ответов, cursor по roots/replies и безопасный legacy-режим.

**Готово, когда:** A/C ответы достижимы, B не раскрывается через body/author/excerpt; весь thread не исчезает из-за одного скрытого корня.

**Проверка:** API-TARGET `modules/polls/comment-user-blocks.integration.test.ts`; assertions на все поля unavailable DTO и многопостраничные replies; SHARED, API-TYPES.

### UB-13. Защитить ответы и реакции комментариев, сохранить удаление своего

**Тип / размер:** Backend, M. **Зависимости:** UB-05, UB-09, UB-12. **PRD:** 6–7, AC-07/08/22.

**Файлы:** изменить `API/modules/polls/polls.{repository,service,routes}.ts`; создать `comment-interactions.user-blocks.integration.test.ts`.

- [ ] Проверять автора poll и автора parent до создания reply; в доступном опросе C запретить ответ B и разрешить независимый комментарий/ответ C.
- [ ] Применить правила к like/unlike комментариев внутри согласованной транзакции; preserve обычные sanctions/ownership проверки.
- [ ] Разрешить удаление собственного комментария в скрытом опросе по известному ID; сохранить `204`, не возвращать/гидратировать скрытый poll; прежние правила удаления ветки не расширять.
- [ ] Проверить одновременные block/reply, self-delete при встречном блоке и отказ удалить чужой комментарий.

**Готово, когда:** чтение доступных ответов не позволяет написать скрытому B; пользователь сохраняет удаление своего контента без чтения чужого.

**Проверка:** API-TARGET `modules/polls/comment-interactions.user-blocks.integration.test.ts`; API-TYPES.

### UB-14. Закрыть обход через media и HTTP-кэш

**Тип / размер:** Backend + web integration, M. **Зависимости:** UB-07, UB-09; контракт UB-02. **PRD:** 4.1, 11.6, AC-06/19.

**Файлы:** изменить `API/modules/polls/poll-image.routes.ts`, `polls.repository.ts`, персонализированные routes и существующие proxy/cache настройки при необходимости; создать `poll-media.user-blocks.integration.test.ts`.

- [ ] Проверять viewer для изображения опроса; не выдавать тело/304 без актуальной политики после блока.
- [ ] Установить согласованные private/no-store и разделение guest/auth контекста с учётом cookie и Authorization; JSON не попадает в общий cache.
- [ ] Проверить guest→login с ранее загруженным media, Bearer, cookie, ETag/conditional GET; публичность аватаров сохранить в границе PRD.

**Готово, когда:** авторизованный A не получает изображение B из общего/гостевого HTTP-кэша; заявленная граница публичных файлов соблюдена.

**Проверка:** API-TARGET `modules/polls/poll-media.user-blocks.integration.test.ts`; браузерная проверка cache из UB-31 с сохранёнными response headers.

### UB-15. Интегрировать блок с жалобами, модерацией и удалением аккаунта

**Тип / размер:** Backend, L. **Зависимости:** UB-06, UB-08, UB-12, UB-13; схема UB-04. **PRD:** 5.4, 9.3, AC-16/17/18.

**Файлы:** изменить `API/modules/moderation/moderation.repository.ts`, существующие account-deletion relationships/notifications/verification и при необходимости archive/retention; создать `API/modules/user-blocks/user-blocks.lifecycle.integration.test.ts`.

- [ ] Сохранить возможность жалобы по известному ID после блока без выдачи скрытого контента и автоматической жалобы при block.
- [ ] Проверить moderator/superadmin: личные взаимодействия ограничены, служебные permissions, доказательства, санкции и системные сообщения работают.
- [ ] Встроить cleanup блоков/revisions/suppression/outbox в deletion workflow и финальную verification; FK-cascade не заменяет эту проверку.
- [ ] На soft-delete показывать нейтральную цель в block-list, на физическом удалении убирать связь; не архивировать PII блока дополнительно.
- [ ] Проверить ban/unban, смену username, удаление одной/обеих сторон и повторный username с новым UUID.

**Готово, когда:** личная блокировка независима от санкций, не мешает reports и не удерживает данные удалённого аккаунта; служебного bypass в обычном API нет.

**Проверка:** API-TARGET `modules/user-blocks/user-blocks.lifecycle.integration.test.ts`; затронутые существующие moderation/account-deletion suites; API-TYPES.

## P3. Уведомления и realtime

### UB-16. Подавлять историю и фильтровать notification inbox

**Тип / размер:** Backend, L. **Зависимости:** UB-06, UB-09, UB-12; контракт UB-02. **PRD:** 8.1–8.2, AC-10/20.

**Файлы:** изменить `API/modules/notifications/notifications.repository.ts`, `notifications.routes.ts`, `notifications.publisher.ts`, cleanup notifications; создать `notifications.user-blocks.integration.test.ts`.

- [ ] Применить одну политику actor + target owners к созданию notification, list, unread, адресному GET и read/read-all; недоступный poll B скрывает notification от C о нём.
- [ ] Реализовать утверждённый suppression: с commit блока старое уведомление недоступно, после unblock оно не возвращается, даже если обработка истории ещё не завершилась.
- [ ] Исключать suppressed из общего inbox и unread, а не только ставить `read_at`; не возвращать payload/name/excerpt скрытой цели.
- [ ] Новые события после снятия последнего блока обрабатываются обычно; прежний deduplication key не используется для replay старого уведомления.
- [ ] Очистка suppressed подчиняется текущему retention; связанный служебный audit/report не удаляется.

**Готово, когда:** списки, unread, прямой GET и публикация согласованы; block→unblock не возвращает старый backlog ни на мгновение.

**Проверка:** API-TARGET `modules/notifications/notifications.user-blocks.integration.test.ts`; существующие notifications repository/integration suites; API-TYPES. Тесты отдельно покрывают actor B, target-owner B и actor C.

### UB-17. Проверять блок непосредственно при push-отправке

**Тип / размер:** Backend / delivery, M. **Зависимости:** UB-05, UB-16. **PRD:** 8.3, AC-10/15/23.

**Файлы:** изменить `API/jobs/notification-push-worker.ts`, `notification-push-worker.test.ts`; создать `notification-push-user-blocks.integration.test.ts` в том же каталоге.

- [ ] Проверить recipient, actor, владельцев цели и suppression перед provider.send, включая pending/retry/claimed jobs; использовать канонический порядок участников UB-05.
- [ ] Для запрещённого задания фиксировать конечное подавление без retry и без вызова провайдера; настройки устройств не удалять из-за личного блока.
- [ ] Детерминированно проверить две стороны гонки: отправка авторизована до commit блока и после него; без произвольных sleep в тестах.
- [ ] Проверить retry после unblock, рестарт claimed job, invalid token и ошибку проверки отношений; устаревшее задание не превращается в новое событие.

**Готово, когда:** задания, авторизуемые после commit, не доходят до провайдера; уже переданный push остаётся в честной границе PRD, а его target закрыт API.

**Проверка:** API-TARGET `jobs/notification-push-worker.test.ts`, `jobs/notification-push-user-blocks.integration.test.ts` с provider stub и счётчиком send calls; API-TYPES.

### UB-18. Фильтровать realtime по получателю и ввести приватные события

**Тип / размер:** Backend / realtime, L. **Зависимости:** UB-07, UB-09, UB-16; контракт UB-02. **PRD:** 11.4, AC-11/12.

**Файлы:** изменить `API/realtime/realtime.{hub,bus,routes}.ts`, `API/app.ts`, `API/modules/user-blocks/user-blocks.events.ts`; создать `API/realtime/realtime.user-blocks.integration.test.ts`; расширить существующие hub/bus tests.

- [ ] Перед отправкой полного poll проверять разрешение конкретному viewer; события C с безопасными агрегатами не блокировать из-за исторического голоса B.
- [ ] Повторно проверять actor/target notification перед фактической socket-доставкой; старые events не обходят HTTP-политику.
- [ ] Отправлять `user_blocks.changed` только владельцу исходящего решения, а другой стороне — только нейтральную viewer revision; сохранить смысл административных `user.blocked/unblocked`.
- [ ] На готовности соединения предоставить способ синхронизации UB-02, не выдавая входящий block-list; failure проверки не включает permissive broadcast.
- [ ] Проверить две API-реплики, гостя, несколько сокетов одного viewer и отсутствие ID инициатора в нейтральном payload.

**Готово, когда:** скрытый poll не приходит по socket, личный блок не раскрывается общей рассылкой, а обе стороны могут обновить своё состояние.

**Проверка:** API-TARGET `realtime/realtime.user-blocks.integration.test.ts`, `realtime/realtime.hub.test.ts`, `realtime/realtime.bus.test.ts`; SHARED, API-TYPES.

### UB-19. Довести outbox до устойчивого восстановления

**Тип / размер:** Backend / jobs, M. **Зависимости:** UB-06, UB-16, UB-18. **PRD:** 11.4, 16, AC-12/23.

**Файлы:** завершить `API/modules/user-blocks/user-blocks.outbox.ts`; создать `API/jobs/user-blocks-outbox-worker.ts`, `run-user-blocks-outbox-worker.ts`, `user-blocks-outbox-worker.integration.test.ts`; подключить запуск/закрытие в существующий runtime и `services/api/package.json`.

- [ ] Реализовать claim/lease/retry и обработку после commit; повтор события с той же/старой ревизией не откатывает состояние и не создаёт пользовательское уведомление.
- [ ] При Redis outage сохранять pending, после восстановления передавать invalidation; серверные проверки отношений остаются независимыми от bus.
- [ ] Проверить crash до publish, после publish до ack, два workers и исчезнувшего recipient; не удерживать PII удалённого аккаунта через outbox.
- [ ] Согласовать lease/retention/cleanup с UB-02 и notifications suppression; backlog виден UB-28.

**Готово, когда:** committed-решение переживает потерю Pub/Sub и рестарт; доставка повторяема, а ревизия доступна и без получения события.

**Проверка:** API-TARGET `jobs/user-blocks-outbox-worker.integration.test.ts`; fault injection Redis/worker без реальных push; API-TYPES.

## P4. Flutter

### UB-20. Добавить Flutter-модели, API и состояние исходящих блоков

**Тип / размер:** Flutter, M. **Зависимости:** UB-02, UB-03, UB-07. **PRD:** 5, 10–11, AC-03/21.

**Файлы:** создать `MOB/features/user_blocks/user_block.dart`, `user_blocks_api_client.dart`, `user_blocks_store.dart`; tests `MT/user_block_test.dart`, `user_blocks_api_client_test.dart`, `user_blocks_store_test.dart`.

- [ ] Реализовать четыре метода API и сверку visibility revision, Bearer, DTO недоступной цели, owner-bound pagination и ошибки UB-07.
- [ ] В store хранить только собственные outgoing decisions, session epoch и ревизию; сравнивать decimal-string безопасно, без потери точности.
- [ ] Обработать pending, timeout с последующей сверкой, retry, поздний ответ старой операции, logout/account switch; не превращать ошибку в false-success.
- [ ] Проверить повтор PUT/DELETE, invalid JSON и ревизии за пределами JS-safe integer для согласованности с web-контрактом.

**Готово, когда:** UI может управлять блоком и разрешить неизвестный результат запроса без чтения профиля; состояние разных аккаунтов изолировано.

**Проверка:** MOBILE-TARGET `test/user_block_test.dart test/user_blocks_api_client_test.dart test/user_blocks_store_test.dart`; `flutter analyze` затронутых файлов.

### UB-21. Сделать Flutter-точки входа и экран заблокированных

**Тип / размер:** Flutter UI, M. **Зависимости:** UB-20, UB-08. **PRD:** 5, AC-01/02/03/14/21/24.

**Файлы:** создать `MOB/features/user_blocks/block_user_dialog.dart`, `blocked_users_screen.dart`; изменить `features/profile/{public_profile_screen,settings_screen}.dart`, `features/polls/{poll_card,poll_comments_screen}.dart`; tests `MT/block_user_dialog_test.dart`, `blocked_users_screen_test.dart`, существующие menu/profile tests.

- [ ] Добавить действие для автора чужого профиля/опроса/комментария с общим подтверждением UB-01, pending и запретом duplicate taps; self не показывать.
- [ ] Добавить Settings → Blocked users: cursor pages, пусто/ошибка/нет сети/retry, нейтральная недоступная цель, подтверждение unblock без обещания доступности B.
- [ ] Предусмотреть нейтральное действие по известному UUID и независимость «Пожаловаться»; не раскрывать встречное решение.
- [ ] Проверить semantics, TalkBack-порядок фокуса, large text и возврат фокуса после исчезновения карточки.

Утверждённый пакет UB-01 задаёт Android + iOS, английский интерфейс L01
и строки C01. Для iOS обязательна аппаратная проверка VoiceOver
в UB-31/32; готовность одной Android-поставки не закрывает Flutter-объём.

**Готово, когда:** полный цикл block/list/unblock доступен с каждой обязательной точки; выбран именно автор объекта, а не автор root/poll по ошибке.

**Проверка:** MOBILE-TARGET `test/block_user_dialog_test.dart test/blocked_users_screen_test.dart test/public_profile_screen_test.dart test/poll_card_report_test.dart`; сценарий меню комментария в существующем `poll_comments_screen_test.dart`.

### UB-22. Поддержать заглушки и доступные ответы во Flutter

**Тип / размер:** Flutter, M. **Зависимости:** UB-20, UB-12, UB-13. **PRD:** 7, AC-06/08/22.

**Файлы:** изменить `MOB/features/polls/poll_summary.dart`, `polls_api_client.dart`, `poll_comments_screen.dart`; расширить `MT/poll_summary_test.dart`, `polls_api_client_test.dart`, `poll_comments_screen_test.dart`.

- [ ] Декодировать negotiated `CommentListItem`; unavailable корень не создаёт фиктивного автора и не показывает body/preview/avatar.
- [ ] Сохранить открытие и догрузку разрешённых replies скрытого корня, включая C за первой страницей; composer к корню B недоступен.
- [ ] Отдельный комментарий к опросу C и ответ C работают; удаление своего сохраняет `204` и прежнюю обработку ветки.
- [ ] Проверить targeted notification navigation и восстановление scroll без открытия скрытого родителя.

**Готово, когда:** видимая часть ветки читается и догружается, скрытая личность не появляется из моделей, меню или restore.

**Проверка:** MOBILE-TARGET `test/poll_summary_test.dart test/polls_api_client_test.dart test/poll_comments_screen_test.dart test/notification_navigation_test.dart`.

### UB-23. Синхронизировать Flutter-кэши, realtime и жизненный цикл

**Тип / размер:** Flutter state/integration, L. **Зависимости:** UB-18, UB-19, UB-20, UB-21, UB-22, UB-11, UB-16. **PRD:** 11.3–11.5, AC-05/10/12/13/19/20.

**Файлы:** изменить `MOB/features/realtime/{realtime_client,realtime_session}.dart`, `features/polls/{poll_state_store,poll_state_scope}.dart`, `features/notifications/notification_store.dart`, feed/search/subscriptions/profile screens, `MOB/core/read_request_scope.dart`, `MOB/app.dart`; создать `MT/user_blocks_visibility_integration_test.dart`.

- [ ] После своего block удалить известный target со всех загруженных поверхностей; нейтральный invalidation сбрасывает персонализированное состояние без знания инициатора.
- [ ] Подключить revision/request generations, отмену поздних чтений, очистку notification/unread, reset выдачи и безопасный Back; не возвращать старые данные после unblock автоматически из cache.
- [ ] На reconnect/resume сверить ревизию до восстановления персонализированного контента; на logout/account switch очистить viewer state сразу.
- [ ] Проверить пустую snapshot-страницу с nextCursor, retry после offline и старое HTTP/socket-событие после нового блока; офлайн-устройству не приписывать мгновенную синхронизацию.

**Готово, когда:** активные Flutter-сессии сходятся с сервером, hidden-карточка/preview не возвращается из позднего запроса и другого аккаунта.

**Проверка:** MOBILE-TARGET `test/user_blocks_visibility_integration_test.dart test/realtime_session_test.dart test/poll_state_store_test.dart test/notification_store_test.dart test/feed_pagination_test.dart`; затем MOBILE-FINAL.

## P5. Публичный web

### UB-24. Добавить web API-клиент и viewer-scoped state

**Тип / размер:** Web, M. **Зависимости:** UB-02, UB-03, UB-07. **PRD:** 5, 10–11, AC-03/21.

**Файлы:** создать `WEB/api/user-blocks.ts`, `user-blocks.test.ts`, `WEB/features/user-blocks/user-blocks-store.tsx`, `user-blocks-store.test.tsx`; изменить `WEB/api/models.ts`, session/provider wiring.

- [ ] Реализовать методы общих интерфейсов через существующий cookie API client без хранения JWT в JavaScript; поддержать AbortSignal.
- [ ] Разделить query/state keys по session epoch и viewer; ревизию сравнивать через точную арифметику, не `Number`.
- [ ] Обработать mutation pending, неизвестный результат со сверкой, быстрые PUT/DELETE, unavailable DTO, cursor list, logout и поздний ответ старого аккаунта.

**Готово, когда:** web имеет один типизированный API/store для управления outgoing decisions и не хранит/не выводит встречные блокировки.

**Проверка:** WEB-TARGET `src/api/user-blocks.test.ts src/features/user-blocks/user-blocks-store.test.tsx`; SHARED, web typecheck.

### UB-25. Сделать web-меню, подтверждения и список заблокированных

**Тип / размер:** Web UI, M. **Зависимости:** UB-24, UB-08. **PRD:** 5, AC-01/02/03/14/21/24.

**Файлы:** создать `WEB/features/user-blocks/BlockUserDialog.tsx`, `BlockedUsersPage.tsx` и tests рядом; изменить `WEB/features/profiles/{PublicProfilePage,MyProfilePage}.tsx`, `WEB/components/PollCard.tsx`, `WEB/features/comments/{CommentList,CommentThread}.tsx`, `WEB/app/router.tsx`.

- [ ] Подключить profile/poll/comment menus, guest login return и self omission; действие относится к автору конкретного объекта.
- [ ] Реализовать подтверждения UB-01 и защищённый маршрут `/me/blocked-users`, pagination и все loading/empty/error/retry/unavailable состояния.
- [ ] Разблокировка снимает своё решение, не обещает снять встречное и не восстанавливает подписку; жалоба остаётся отдельным действием.
- [ ] Проверить keyboard, Escape/Cancel, screen reader labels, focus return и стабильный фокус после скрытия карточки.

Утверждённый пакет UB-01 задаёт английский интерфейс L01 и точные строки C01.

**Готово, когда:** пользователь web проходит полный цикл с любой обязательной точки, включая состояние без сети и недоступную цель.

**Проверка:** WEB-TARGET `src/features/user-blocks/BlockUserDialog.test.tsx src/features/user-blocks/BlockedUsersPage.test.tsx src/features/profiles/PublicProfilePage.test.tsx` плюс tests затронутых poll/comment menus; web typecheck/lint.

### UB-26. Поддержать заглушки и доступные ветки в web

**Тип / размер:** Web, M. **Зависимости:** UB-24, UB-12, UB-13. **PRD:** 7, AC-06/08/22.

**Файлы:** изменить `WEB/api/models.ts`, `api/polls.ts`, `WEB/features/comments/{comment-state,CommentList,CommentThread,PollDetailPage,CommentForm}.ts*`; расширить существующие comment/API tests.

- [ ] Декодировать versioned unavailable item; не рендерить фиктивный avatar/author/body и не использовать скрытый parent preview.
- [ ] Загружать разрешённые replies скрытого корня с пагинацией; запретить reply к B, сохранив комментарий/ответ C в опросе C.
- [ ] Сохранить удаление своего комментария без poll response, targeted navigation и scroll anchors.
- [ ] Проверить C за первой страницей, пустые replies, встречный блок и смену блока при открытой ветке.

**Готово, когда:** web показывает ту же доступную часть обсуждения, что Flutter/API, и не раскрывает скрытого автора через DOM/preview.

**Проверка:** WEB-TARGET `src/api/polls.test.ts src/features/comments/CommentThread.test.tsx src/features/comments/PollDetailPage.test.tsx` и затронутые tests comment-state/list/form; web typecheck.

### UB-27. Синхронизировать web-кэш, вкладки, reconnect и навигацию

**Тип / размер:** Web state/integration, L. **Зависимости:** UB-18, UB-19, UB-24, UB-25, UB-26, UB-11, UB-14, UB-16. **PRD:** 11.3–11.6, AC-05/10/12/13/19/20.

**Файлы:** создать `WEB/features/user-blocks/visibility-coordinator.tsx`, `visibility-coordinator.test.tsx`; изменить `WEB/features/polls/poll-state.ts`, `features/notifications/{realtime-client,notification-store}.ts*`, query/session providers, `WEB/core/pagination/pagination-state.ts` и затронутые page queries.

- [ ] На новый revision очистить персонализированные profile/poll/comments/feed/search/follow/notifications caches, abort старых запросов и reset поколений выдачи.
- [ ] Согласовать invalidation нескольких вкладок через существующий подход BroadcastChannel/storage с привязкой к viewer/session; не сообщать target ID встречной стороне.
- [ ] При socket reconnect, focus/resume и входе сверять revision до показа восстановленного cache; Back и guest→login не возвращают скрытую копию.
- [ ] Проверить поздние HTTP/events, out-of-order mutation responses, повтор invalidation, fallback без BroadcastChannel и пустую snapshot-страницу с продолжением.

**Готово, когда:** вкладки и сервер сходятся, нейтральное событие очищает весь необходимый scope, поздний ответ не возвращает B и состояние не переносится на другого viewer.

**Проверка:** WEB-TARGET `src/features/user-blocks/visibility-coordinator.test.tsx`, существующие poll-state/notification-store/pagination/session suites; затем WEB-FINAL. Реальные две вкладки — UB-31.

## P6. Проверка качества

### UB-28. Добавить наблюдаемость и независимые controls запуска

**Тип / размер:** Backend + clients / operations, M. **Зависимости:** UB-02, UB-07, UB-16, UB-17, UB-18, UB-19, UB-21, UB-25. **PRD:** 12, 16.

**Файлы:** создать `API/modules/user-blocks/user-blocks.metrics.ts`, `user-blocks.metrics.test.ts`; изменить `API/config/env.ts`, server/worker wiring, env examples и точки событий обоих клиентов; создать `DOC/user-blocking-evidence/observability.md`.

- [ ] Ввести отдельно контроль создания новых блоков и отображения входов; исходное значение выключено. Проверки уже записанных отношений и снятие своего блока работают независимо от rollout.
- [ ] Добавить latency/error/rate-limit/suppression/outbox-age/invalidation/reconcile metrics, без UUID в labels, имён, текста и пар пользователей в общей аналитике.
- [ ] Подключить минимальные product events подтверждения/отмены/успеха/ошибки, точки входа, списка и unblock; повтор доставки не удваивает продуктовый успех.
- [ ] Зафиксировать численные алерты и пороги пилота по baseline/нагрузке UB-30; описать fault/suppressed как разные состояния.

**Готово, когда:** поддержка видит сбои функции и backlog, rollout можно остановить без снятия защиты; чувствительные отношения не попадают в telemetry.

**Проверка:** API-TARGET `modules/user-blocks/user-blocks.metrics.test.ts`; targeted tests env/flags и клиентской аналитики; проверка примеров логов/labels и режима creation-off/enforcement-on.

### UB-29. Проверить конкурентные операции и отказоустойчивость

**Тип / размер:** QA + backend, L. **Зависимости:** UB-08, UB-09, UB-13, UB-15, UB-16, UB-17, UB-18, UB-19, UB-28. **PRD:** 9, 14, AC-03/04/14/15/18/23.

**Файлы:** создать `API/modules/user-blocks/user-blocks.concurrency.integration.test.ts`, `user-blocks.resilience.integration.test.ts`; evidence `DOC/user-blocking-evidence/concurrency.md`.

- [ ] Детерминированно поставить block против follow/vote/like/comment/reply/delete и reciprocal PUT/DELETE; барьеры задают оба допустимых порядка без flaky sleep.
- [ ] Проверить счётчики, отсутствие дубликатов, непротиворечивую ревизию и сохранение исторических реакций после каждого порядка.
- [ ] Проверить block→unblock перед suppression worker, push authorization race, kill/restart outbox и повтор publish без ack.
- [ ] Проверить PostgreSQL/Redis outage, ошибки политики и медленную транзакцию: нет выдачи по умолчанию и создания follow после блока.

**Готово, когда:** все конкурентные исходы объясняются согласованным порядком; нет deadlock, false-success, повторной доставки и реанимации inbox.

**Проверка:** API-TARGET `modules/user-blocks/user-blocks.concurrency.integration.test.ts`, `modules/user-blocks/user-blocks.resilience.integration.test.ts`; evidence содержит воспроизведение, число прогонов и результаты.

### UB-30. Проверить запросы и задержки под нагрузкой

**Тип / размер:** Backend / performance, L. **Зависимости:** UB-03, UB-08, UB-09, UB-10, UB-11, UB-12, UB-14, UB-16, UB-17, UB-18, UB-19, UB-28. **PRD:** 12, 14.

**Файлы:** создать `scripts/user-blocking-load.mjs`, `DOC/user-blocking-evidence/query-plans.md`, `performance.md`; исправления только в затронутых guards/queries/indexes.

- [ ] Выполнить workload с 0/100/1 000/10 000 исходящих блоков, крупным входящим списком, скрытыми корнями и разреженными snapshot-диапазонами.
- [ ] Сохранить EXPLAIN ANALYZE, query counts, p95 block/unblock, feed/search/comments, fan-out и outbox/invalidation delay; сравнить с тем же baseline.
- [ ] Проверить целевые 1 с / 2 с / ≤20% и отсутствие N+1/full scans там, где план должен использовать pair/list indexes; настроить пороги UB-28.
- [ ] При превышениях исправить bottleneck и повторить только затронутый workload; не отключать guards и не записывать неполученные результаты как PASS.

**Готово, когда:** нагрузочный профиль и замеры воспроизводимы, согласованные пороги достигнуты либо явное отклонение решено до пилота.

**Проверка:** `node scripts/user-blocking-load.mjs` на выделенном тестовом окружении по параметрам UB-03/02; exit 0 только при прохождении проверок, артефакты содержат реальный baseline и сравнение.

### UB-31. Выполнить сквозную приёмку Flutter + web + API

**Тип / размер:** QA + все платформы, L. **Зависимости:** UB-15, UB-23, UB-27, UB-28, UB-29, UB-30. **PRD:** 13–14, AC-01…AC-24.

**Файлы:** создать `DOC/user-blocking-evidence/acceptance-matrix.md`, `release-record.md`; при обнаружении пробела добавить test в suite владельца, не отдельный тест, повторяющий реализацию.

- [ ] Пройти AC-01…AC-24 на A/B/C, двух устройствах и двух web-вкладках, с cookie/Bearer и guest; привязать evidence к commit/build/environment.
- [ ] Проверить реальный HTTP/media-cache, Back, account switch, direct notification, сложную ветку C и reconnect после потерянного bus.
- [ ] Проверить старый клиент по UB-02, TalkBack/keyboard/screen reader, отсутствие утечки в UI/DOM/socket payload и сохранность обычного поведения C.
- [ ] Выполнить полные suites API/Flutter/web и регрессии moderation/reports/deletion/public/followers/private; зафиксировать фактические ограничения окружения.

Матрица следует утверждённым поставкам/языку UB-01:
Android + iOS + React web, английский интерфейс. Для iOS
обязательны сборка на macOS/Xcode и staging smoke на iPhone с VoiceOver,
large text, push, reconnect и resume; отсутствие среды не означает PASS.

**Готово, когда:** у каждого AC есть PASS с evidence; открытое функциональное/защитное несоответствие не маскируется успешной сборкой. Обнаруженный дефект возвращается владельцу задачи.

**Проверка:** API-FINAL, WEB-FINAL, MOBILE-FINAL, ручной staging E2E по матрице; никаких отметок об аппаратных/сервисных проверках без фактического выполнения.

## P7. Выпуск

### UB-32. Подготовить и провести совместимый rollout и rollback

**Тип / размер:** Operations + release owner, M. **Зависимости:** UB-31. **PRD:** 15–16.

**Файлы:** создать `DOC/user-blocking-release-checklist.md`; заполнить `DOC/user-blocking-evidence/release-record.md`; изменить необходимые `infra/docker/`/worker runbooks и env examples.

- [ ] Проверить аддитивную миграцию и совместимый rollback-образ на копии данных; из глобальных банов личные блоки не создавать.
- [ ] Развернуть новую политику на всех API и workers до включения PUT; зафиксировать readiness, отсутствие старых обработчиков и доступный путь unblock/list.
- [ ] Выполнить ограниченный пилот Flutter/web с метриками UB-28 и критериями UB-30; определить состав пилота, окно наблюдения и владельца решения до включения.
- [ ] Проверить откат: creation/UI-off, enforcement/list/unblock-on, сохранённые отношения и counters; не восстанавливать follows и не удалять таблицу.
- [ ] После разрешённого владельцем выпуска включить следующий этап и записать фактическую поставку/наблюдение; подготовленный checklist не считается выполненным rollout.

Записать утверждённый состав поставок/язык UB-01, версии и фактические
артефакты Android/iOS/web. Состав утверждён; исключить iOS
или добавить русскую локализацию можно только с обновлением UB-01/PRD
и матрицы UB-31, сохранив серверную защиту для уже записанных блоков.

**Готово, когда:** выпуск подтверждён evidence и проверенным сценарием отката, записанные блоки продолжают защищать пользователей при остановке запуска. Подготовка задач не разрешает автоматически изменять production.

**Проверка:** release checklist, staging smoke A/B/C до/после rollback, версия каждого API/worker/client и реальные метрики пилота. Если работа ограничена подготовкой релиза, исполнение rollout остаётся открытым.

## Покрытие критериев PRD

UB-31 подтверждает всю матрицу сквозным прогоном; здесь указаны владельцы
реализации и целевых regression tests, чтобы AC не оставался только QA-задачей.

| AC | Задачи-владельцы |
| --- | --- |
| AC-01 | UB-07, UB-21, UB-25 |
| AC-02 | UB-07, UB-21, UB-25 |
| AC-03 | UB-06, UB-07, UB-20, UB-21, UB-24, UB-25, UB-29 |
| AC-04 | UB-06, UB-08, UB-29 |
| AC-05 | UB-08, UB-10, UB-11, UB-23, UB-27 |
| AC-06 | UB-09, UB-12, UB-14, UB-22, UB-26 |
| AC-07 | UB-08, UB-09, UB-13 |
| AC-08 | UB-12, UB-13, UB-22, UB-26 |
| AC-09 | UB-09, UB-29 |
| AC-10 | UB-16, UB-17, UB-23, UB-27 |
| AC-11 | UB-18, UB-19 |
| AC-12 | UB-18, UB-19, UB-23, UB-27 |
| AC-13 | UB-11, UB-12, UB-23, UB-27 |
| AC-14 | UB-06, UB-21, UB-25, UB-29 |
| AC-15 | UB-05, UB-06, UB-08, UB-09, UB-13, UB-17, UB-29 |
| AC-16 | UB-15 |
| AC-17 | UB-15 |
| AC-18 | UB-04, UB-15, UB-29 |
| AC-19 | UB-14, UB-20, UB-23, UB-24, UB-27 |
| AC-20 | UB-06, UB-16, UB-23, UB-27 |
| AC-21 | UB-07, UB-20, UB-21, UB-24, UB-25 |
| AC-22 | UB-13, UB-22, UB-26 |
| AC-23 | UB-05, UB-17, UB-19, UB-29 |
| AC-24 | UB-21, UB-25 |

## Условия закрытия эпика

- [ ] UB-01/02 закрыли существенные решения; PRD, shared и клиенты согласованы.
- [ ] UB-03–UB-19 закрыты с целевыми проверками всех серверных путей.
- [ ] UB-20–UB-27 дают полный пользовательский цикл на обеих платформах.
- [ ] UB-28–UB-31 имеют наблюдаемость, реальные замеры и evidence всех AC.
- [ ] UB-32 подтверждает фактический релиз/откат в согласованном объёме.

Последняя проверка декомпозиции: все 24 AC имеют владельца; дополнительные
требования PRD о приватной аналитике, больших block-list, совместимости,
retention и rollback покрыты UB-02/04/15/16/19/28/30/32. Наличие плана,
сборка или выполненный отдельный backend-этап не закрывают эпик.
