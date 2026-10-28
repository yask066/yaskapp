# Пагинация ленты и комментариев — Implementation Plan / Task Breakdown

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Выбор способа исполнения не входит в подготовку этого backlog.

**Goal:** Завершить пагинацию основной ленты, подписок, корневых комментариев и ответов во Flutter Android и web, включая стабильное продолжение popular.

**Architecture:** Общий контракт страницы и серверные cursors; keyset для хронологических списков, отдельный snapshot ранжированных ID для popular. Клиенты сохраняют server pages отдельно от локальных дополнений, используют независимые поколения выдачи и существующие guards состояния опросов и scroll anchors.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React, TanStack Query, Vitest/MSW, Flutter/Dart; существующие инфраструктура логирования и release controls.

**Spec:** [PRD: Полная пагинация ленты и комментариев](../../prd-feed-comments-pagination.md).

**Статус:** Backlog, 28 задач; полностью выполнены T01–T14, T15–T20 и T22–T27. T21 выполнена частично; T28 закрыта решением пользователя 2026-10-28 без staging, rollout и rollback. Release evidence не получено, выпуск не выполнялся. T26 закрыта по решению пользователя без staging-прогона; показатели производительности остаются непроверенными. T27 закрыта по решению пользователя 2026-10-28 с принятием зафиксированных исключений: AC-матрица, TalkBack и API-проверка не запускались, часть performance workload превысила бюджет. Декомпозиция сохраняет scope PRD; решения для реализации зафиксированы в ADR T01. Документ можно переносить в трекер по одной задаче на карточку.

## Global Constraints

- Scope: Flutter Android и web; Feed/newest, subscriptions, popular, roots и replies. Новая пагинация профилей, поиска, уведомлений и iOS вне scope.
- Размер страницы новых клиентов — 20; допустимый `limit` — целое 1–50. Legacy defaults: Feed/subscriptions/replies — 20, roots — 50.
- Лента и новые roots — DESC по `(created_at, id)`; replies — ASC. Roots без `order` сохраняют legacy ASC.
- Контракт сервера — `{ items, nextCursor: string | null }`. Только `nextCursor: null` означает конец поддерживаемой пагинации; raw cursor непрозрачен для клиента.
- Точность PostgreSQL timestamp в cursor сохраняется до микросекунд; JS Date не используется для вычисления границы.
- Не более одного append на выдачу; до трёх последовательных автодогрузок без нового пользовательского действия; после append error — только ручной Retry.
- Refresh заменяет цепочку атомарно после успеха; при ошибке сохраняет старые страницы и продолжение. Logout/смена аккаунта изолируют данные и pending.
- Собственные публикации и адресные targets не переписывают server cursor. Повторные страницы не откатывают revisions и не возвращают удалённые локально записи.
- Popular snapshot живёт 30 минут без продления чтением; expired — `410 pagination_expired`. Между HTTP-запросами нет открытой SQL-транзакции.
- Открытие comment target: не более двух адресных comment GET сверх обычной загрузки poll/первой страницы roots; обход replies ради поиска цели запрещён.
- Отклонение scroll anchor после стабилизации — не более 8 logical px / CSS px; удалённый якорь заменяется ближайшим сохранившимся соседом.
- Сначала совместимый API, затем клиенты. Legacy-потребители массивов и профильные helpers сохраняют своё поведение.
- Cursor v1 имеет wire format `c1.<payload-base64url>.<signature-base64url>`, HMAC-SHA-256 и отдельный `PAGINATION_CURSOR_SECRET` от 32 случайных байт; legacy replies cursor принимается 180 дней после выпуска Android v1.
- Popular хранится в PostgreSQL полным набором ordered IDs; TTL 30 минут, максимум 3 snapshots на владельца с вытеснением самого старого, cleanup каждые 5 минут. Аккаунт привязан к user ID, guest — к HMAC-хэшу trusted IP; raw IP и user ID не хранятся.
- Успешный follow/unfollow меняет только Following generation; page cache и anchor context неактивной поверхности удерживаются до 5 минут. Logout/account switch очищает viewer-scoped state сразу.
- Pagination rollout flags `VITE_FEED_PAGINATION` и `YASKAPP_FEED_PAGINATION` выключены по умолчанию. Flutter T24 добавляет переключатель Newest/Popular в шапку Feed; Following остаётся отдельной вкладкой.

## Review Focus

Пять пограничных случаев, для которых ниже назначены отдельные проверки:

1. Cursor корректно декодируется, но взят из другого poll, root, sort или аккаунта: отказ без утечки контента — T04, T06, T07.
2. Refresh начат во время append и завершился ошибкой: поздняя страница не меняет список, прежнее продолжение остаётся рабочим — T09, T16.
3. Собственный ответ и target находятся за незагруженным разрывом: немедленная видимость без ложной непрерывности и двойного фокуса — T12, T13, T19, T20.
4. Все ID очередного диапазона popular удалены/скрыты: cursor продвигается, клиент не объявляет конец по длине массива и не зацикливается — T23, T24.
5. HTTP/realtime обновляют viewer state во время logout и повторного входа: данные другого аккаунта не возвращаются из pages/cache — T12, T16, T19, T27.

## Как выполнять и проверять задачи

Для каждой задачи с изменением поведения: сначала добавить указанные регрессионные тесты и убедиться, что они падают по ожидаемой причине; затем внести минимальное изменение и выполнить целевую проверку. Ошибка окружения не считается ожидаемым red-тестом. Новые тесты не нужны для изменения только документации. После прохождения — отдельный reviewable commit со scope задачи; команды commit не означают разрешение на публикацию или merge.

Все команды ниже выполняются из корня репозитория, кроме Flutter-команд — из `apps/mobile`. Нужные PostgreSQL/Redis и переменные окружения берутся из действующего локального/CI setup; реальные staging credentials не переносятся в fixtures.

| Код проверки | Команда и успешный результат |
|---|---|
| SHARED | `npm run shared:build` — exit 0 |
| API-CURSOR | `node --import tsx --test src/modules/polls/poll-pagination.test.ts` из `services/api` — все тесты passed |
| API | `npm run api:test` — миграции и API suite passed; `npm run api:typecheck` — exit 0 |
| WEB-API | `npm run test -w @yaskapp/web -- --run src/api/polls.test.ts` — passed |
| WEB-STATE | `npm run test -w @yaskapp/web -- --run src/features/polls/poll-state.test.ts src/core/pagination/pagination-state.test.ts` — passed |
| WEB-FEED | `npm run test -w @yaskapp/web -- --run src/features/feed/FeedPage.test.tsx` — passed |
| WEB-COMMENTS | `npm run test -w @yaskapp/web -- --run src/features/comments/CommentThread.test.tsx src/features/comments/PollDetailPage.test.tsx` — passed |
| WEB-FINAL | `npm run typecheck -w @yaskapp/web`, `npm run lint -w @yaskapp/web`, `npm run test -w @yaskapp/web -- --run`, `npm run build -w @yaskapp/web` — exit 0 |
| FLUTTER-API | `flutter test test/polls_api_client_test.dart test/poll_summary_test.dart` — passed |
| FLUTTER-STATE | `flutter test test/cursor_list_controller_test.dart test/poll_state_store_test.dart` — passed |
| FLUTTER-FEED | `flutter test test/feed_screen_test.dart test/subscriptions_screen_test.dart` — passed |
| FLUTTER-COMMENTS | `flutter test test/poll_comments_screen_test.dart test/notification_navigation_test.dart` — passed |
| FLUTTER-FINAL | `flutter analyze`, `flutter test`, `flutter build apk --debug` — exit 0; performance отдельно на profile build |

Новые пути тестов вводятся соответствующими задачами. Полные suites запускаются при завершении платформенного этапа и P5; на промежуточном шаге достаточно целевого теста и typecheck/analyze затронутой части.

## Карта файлов и границ ответственности

Пути относительны корню репозитория. **Новые** файлы обозначают будущий результат задачи, а не уже созданные артефакты.

| Область | Существующие файлы | Новые файлы, предлагаемые планом |
|---|---|---|
| Решения, fixtures, evidence | `docs/prd-feed-comments-pagination.md` | `docs/superpowers/specs/2026-10-19-feed-comments-pagination-decisions.md`; `test/fixtures/feed-comments-pagination.json`; `docs/pagination-evidence/README.md` |
| Контракты | `packages/shared/src/index.ts` | `packages/shared/src/pagination.ts`; `packages/shared/src/pagination.type-test.ts` |
| API | `services/api/src/modules/polls/polls.routes.ts`, `polls.service.ts`, `polls.repository.ts`, `polls.integration.test.ts`, `polls.routes.test.ts`, `polls.repository.test.ts`; `services/api/src/config/env.ts` | `services/api/src/modules/polls/poll-pagination.ts`, `poll-pagination.test.ts`, `poll-pagination.fixtures.ts` |
| Popular | Те же polls routes/service/repository; `services/api/src/server.ts`, `services/api/package.json` | `services/api/src/modules/polls/poll-feed-snapshots.repository.ts`, `poll-feed-snapshots.test.ts`; `services/api/src/jobs/cleanup-poll-feed-snapshots.ts` |
| Миграции | `services/api/src/db/migrations/`, `services/api/src/db/migrate.ts` | Следующие свободные номера для pagination indexes и snapshot tables; номер назначается при реализации, существующие миграции не редактируются |
| Flutter API/state | `apps/mobile/lib/src/features/polls/polls_api_client.dart`, `poll_summary.dart`, `poll_state_store.dart`; `apps/mobile/lib/src/core/read_request_scope.dart` | `apps/mobile/lib/src/core/pagination/cursor_page.dart`, `cursor_list_controller.dart`; `apps/mobile/test/cursor_list_controller_test.dart` |
| Flutter UI | `apps/mobile/lib/src/features/feed/feed_screen.dart`; `features/subscriptions/subscriptions_screen.dart`; `features/polls/poll_comments_screen.dart`; пути `features/*` здесь относительно `apps/mobile/lib/src/` | `apps/mobile/lib/src/core/widgets/pagination_footer.dart` |
| Flutter QA | `apps/mobile/test/polls_api_client_test.dart`, `poll_summary_test.dart`, `feed_screen_test.dart`, `subscriptions_screen_test.dart`, `poll_comments_screen_test.dart`, `notification_navigation_test.dart`, `poll_state_integration_test.dart` | `apps/mobile/test/pagination_footer_test.dart` |
| Web API/state | `apps/web/src/api/models.ts`, `polls.ts`, `polls.test.ts`; `apps/web/src/features/polls/poll-state.ts`, `usePollMutations.ts` | `apps/web/src/core/pagination/pagination-state.ts`, `pagination-state.test.ts`; `apps/web/src/components/PaginationFooter.tsx` |
| Web UI/QA | `apps/web/src/features/feed/FeedPage.tsx`, `FeedPage.test.tsx`; `features/comments/CommentList.tsx`, `CommentThread.tsx`, `PollDetailPage.tsx` и их существующие tests; пути `features/*` здесь относительно `apps/web/src/` | Дополнительные tests создаются рядом с изменяемым компонентом, если существующий suite не покрывает сценарий |
| Scroll/motion | `apps/mobile/lib/src/core/scroll/list_scroll_anchor_host.dart`, `list_scroll_state.dart`; `apps/web/src/core/scroll/useListScrollState.ts`, `ScrollRestorationCoordinator.tsx`; существующие motion-компоненты | Новая система навигации/scroll не создаётся |
| Измерения и выпуск | `package.json`, `.github/workflows/ci.yml`; действующие smoke scripts | `scripts/pagination-load.mjs`; `docs/pagination-release-checklist.md`; `docs/pagination-evidence/release-record.md` |

Контроллеры пагинации отвечают за жизненный цикл цепочки, не за merge Poll revisions. Poll state остаётся ответственностью существующего store. Snapshot repository отвечает за сохранённый порядок ID, а текущая hydration — за доступность и актуальные карточки.

## Общие интерфейсы между задачами

Имена новых публичных методов фиксируются здесь, чтобы клиентские задачи не расходились между собой.

- **T03:** `CursorPage<T> = { items: T[]; nextCursor: string | null }`; `ListPollsResponse = CursorPage<Poll>`, `ListPollCommentsResponse = CursorPage<PollComment>`, `ListPollCommentRepliesResponse = CursorPage<PollComment>`. Дополнить `PollComment` фактическими `viewerHasLiked`, `parentCommentId`, `repliesCount`, а `CreatePollCommentRequest` — optional `parentCommentId`.
- **T04:** `encodePollCursor(payload: PollCursorPayload): string`; `decodePollCursor(raw: string, expected: PollCursorContext): PollCursorPayload`. Реализовать wire v1 `c1.<payload>.<HMAC-SHA-256>` с `PAGINATION_CURSOR_SECRET`, scope `kind`/sort/order/poll/root/owner, точные PostgreSQL boundary/high-watermark tuples либо snapshot ID/position. Следовать [ADR T01](../specs/2026-10-19-feed-comments-pagination-decisions.md), включая 180-дневный replies v0 decoder.
- **T08:** добавить Flutter `listPollsPage({limit = 20, sort = 'newest', cursor, accessToken})`, `listSubscriptionsPage({limit = 20, cursor, required accessToken})`, `listCommentsPage({required pollId, limit = 20, order = 'newest', cursor, accessToken})`; результаты `Future<CursorPage<PollSummary>>` / `Future<CursorPage<PollCommentSummary>>`. Existing `listPolls`, `listComments` сохраняются для legacy consumers. `listCommentReplies` сохраняет имя и совместимую модель страницы.
- **T08/T15:** клиентская страница содержит дополнительный локальный `paginationSupported: boolean`. Это metadata decoder, не поле серверного JSON: отсутствующий legacy `nextCursor` даёт false; явный null даёт true. False запрещает append и не показывает утверждение о полном конце.
- **T09:** `CursorListController<T>` с операциями `loadInitial()`, `loadMore()`, `refresh()`, `dispose()` и неизменяемым state: pages, уникальные IDs, nextCursor, paginationSupported, generation, pending/error по виду чтения. Loader принимает cursor/limit; extractId получает ID. Внешний session/context key входит в identity контроллера; Following membership generation входит только в Following. Неактивные pages/anchor context очищаются через 5 минут; локальные overlays принадлежат feature state.
- **T15:** web `listPollsPage(input, signal?)`, `listSubscriptionsPage(input, signal?)`, `listCommentsPage(pollId, input, signal?)` возвращают `Promise<ClientCursorPage<Poll>>` / `Promise<ClientCursorPage<PollComment>>`; `input` включает limit/cursor и применимые sort/order. `ClientCursorPage<T>` расширяет серверную страницу локальным `paginationSupported`. Legacy array methods сохраняются.
- **T16:** чистые helpers `mergePageIds(pages, getId)`, `canAppend(state)`, `acceptPage(state, requestContext, page)` в `pagination-state.ts`; state/context определяются в этом файле и несут generation, session identity, Following membership generation, cursor history и automatic-load budget. UI использует их с `useInfiniteQuery`, не создаёт вторую копию Poll store.
- **T22:** `createFeedSnapshot(...)`, `readFeedSnapshotPage(...)`, `deleteExpiredFeedSnapshots(...)` в PostgreSQL snapshot repository; immutable full ordered IDs, TTL 30 минут, максимум 3 snapshots на owner, вытеснение oldest, owner key HMAC, cleanup cadence 5 минут. Точные schema/types берутся из ADR T01; по HTTP выходят только CursorPage и opaque cursor.

## Порядок и зависимости

| Этап | Задачи | Основной результат |
|---|---|---|
| P0 | T01–T02 | Решения и воспроизводимый baseline |
| P1 | T03–T07 | Совместимые контракты и chronological API |
| P2 | T08–T14 | Flutter: API, состояние и четыре поверхности |
| P3 | T15–T21 | Web: API, infinite queries и четыре поверхности |
| P4 | T22–T24 | Stable popular и expired UX |
| P5 | T25–T28 | Наблюдаемость, масштаб, сквозная приёмка и выпуск |

Основная цепочка: `T01 → T03/T04 → T05/T06 → T07 → клиенты → T27 → T28`. T02 нужен для проверок API и финальной приёмки. После T05/T06 Flutter и web можно выполнять независимо; это возможность организации работ, не команда запускать агентов. T22 стартует после T01/T04/T07; T23 после T22; клиентский T24 после T23 и готовности лент. P2/P3 не требуют окончания popular backend, но без P4 эпик не закрывается.

Зависимости ниже обозначают готовые результаты, а не только наличие файлов. Совместно изменяемые files, особенно routes, Flutter comments и web cache, требуют последовательного внесения/интеграции изменений внутри своей ветки работ.

## P0. Решения и baseline

### T01. Зафиксировать продуктовые и API-решения

**Тип / размер:** Product + backend design, M. **Зависимости:** нет. **PRD:** FR-01, API-02–04, разделы 9–11.

**Файлы:** PRD; создать ADR `docs/superpowers/specs/2026-10-19-feed-comments-pagination-decisions.md`.

- [x] Зафиксировать roots newest для новых клиентов и legacy oldest; формат capability detection и error envelope; версию, scope и политику подписи cursors, окно legacy replies.
- [x] Выбрать хранение popular snapshots, числовой лимит активных снимков на владельца, идентичность владельца для гостя и пользователя, поведение при достижении квоты, cleanup cadence и правила смены авторизации. Сохранить TTL 30 минут и отсутствие тихого ограничения числа ID.
- [x] Определить, как подписки меняют generation Following на обеих платформах; проверить существующие release controls. Зафиксировать бюджет cache retention для lifecycle-замеров.
- [x] Зафиксировать точку входа popular во Flutter. Если её пока нет, описать минимальный переключатель сортировки для T24; исключение popular из Android требует явного изменения PRD, а не отметки задачи выполненной без доступного сценария.

**Готово, когда:** ADR содержит конкретные значения и решения по каждому пункту, не оставляет выбор формата cursor/хранилища клиентским исполнителям и не меняет scope PRD молча. Есть согласованный контракт для T03/T04/T22; спорные решения PRD рассмотрены перед изменением поведения.

### T02. Подготовить fixtures и измеримый baseline

**Тип / размер:** QA + engineering, M. **Зависимости:** T01. **PRD:** AC-01–04, AC-12, раздел 8.

**Файлы:** создать `test/fixtures/feed-comments-pagination.json`, `services/api/src/modules/polls/poll-pagination.fixtures.ts`, `docs/pagination-evidence/README.md`.

- [x] Задать фиксированные ID/UTC timestamp для 125 опросов, 125 roots и 65 replies; отдельные выборки 0/1/19/20/21/40, одинаковые timestamp и микросекундные различия. JSON хранит компактный seed и ожидаемые ordered IDs; DB helper разворачивает его и изолирует cleanup по seed.
- [x] Для далёкого target добавить отдельный seed минимум с 225 roots и 225 replies одной ветки, чтобы ссылка за десятой страницей limit 20 проверялась на реальных данных, а не только mock response.
- [x] Описать создание подписок, удалений, hidden content, guest/viewer и двух аккаунтов; добавить проверку воспроизводимости helper и того, что cleanup не затрагивает чужие данные.
- [x] Снять baseline текущих запросов, scroll и клиентов на 100 элементах; записать commit/build, устройство/браузер, окружение, команды и фактические результаты, включая существующие failures.

**Готово, когда:** fixtures дают один ожидаемый порядок для API и двух клиентов; baseline воспроизводится, ограничения окружения явно записаны. Проверка: тесты fixture helper и ручная сверка evidence; baseline не объявляет ещё не реализованные сценарии пройденными.

## P1. Контракты и backend

### T03. Ввести тип страницы и согласовать shared DTO

**Тип / размер:** Backend/shared, S. **Зависимости:** T01. **PRD:** API-01, AC-16.

**Файлы:** `packages/shared/src/index.ts`; создать `pagination.ts`, `pagination.type-test.ts` в том же каталоге.

- [x] Добавить compile-time проверки требуемого `nextCursor`, nullable parent, reply count, viewer state и запроса создания reply.
- [x] Ввести интерфейсы из раздела «Общие интерфейсы» и обновить экспорты/затронутые TS consumers без изменения JSON формата отдельных сущностей.
- [x] Выполнить SHARED и `npm run api:typecheck`; проверить, что type-test включён в сборку.

**Готово, когда:** shared описывает фактические comments/replies и новый page response; старые readers поля `items` продолжают собираться.

### T04. Реализовать проверяемый cursor с точными границами

**Тип / размер:** Backend, M. **Зависимости:** T01. **PRD:** API-02/04, AC-03/15/16.

**Файлы:** создать `services/api/src/modules/polls/poll-pagination.ts`, `poll-pagination.test.ts`; изменить `services/api/src/config/env.ts` и error mapping polls routes при необходимости.

- [x] Добавить тесты round-trip микросекунд, неверной версии/подписи/длины/UUID, чужих list/poll/root/sort/account и повреждённого payload; закрепить `400 pagination_cursor_invalid`.
- [x] Реализовать encode/decode из общей секции, high watermark и проверку контекста по ADR. Legacy replies decoder использовать только в согласованной совместимой ветке, не выдавать старый формат за подписанный новый.
- [x] Проверить, что timestamp не проходит через JS Date при построении cursor; выполнить API-CURSOR и API typecheck.

**Проверки:** API-CURSOR и route error-envelope tests — 26 passed, 0 failed; `npm run shared:build` и `npm run typecheck` из `services/api` прошли. Boundary/high-watermark timestamps формируются SQL `to_char(...US...)` и передаются как строки; проверено, что legacy decoder вызывается только для replies.

**Готово, когда:** значения границы не теряют точность, подмена контекста отвергается, срок legacy поддержки управляем и протестирован. Секрет подписи не попадает в API errors/logs.

### T05. Добавить keyset-пагинацию newest и subscriptions

**Тип / размер:** Backend, M. **Зависимости:** T02–T04. **PRD:** FR-01, API-01/02, AC-01–04/15/16.

**Файлы:** polls routes/service/repository и `polls.integration.test.ts`.

- [x] Добавить API-тесты полного обхода 125 ID с limit 20, точной границы 20/40, удаления boundary, нового опроса после первой страницы и различий guest/viewer; subscriptions проверять на двух авторах с разными подписками.
- [x] Добавить optional cursor и page result для newest/subscriptions; фильтровать доступность до проверки продолжения, использовать tuple DESC, high watermark, `limit + 1` и точный cursor последней серверной строки.
- [x] Сохранить запросы без cursor и defaults, авторизацию subscriptions; popular до T23 сохраняет прежнюю первую страницу без заявления о готовой стабильной пагинации и не включается в новом клиенте как готовый режим.
- [x] Выполнить целевые API integration tests и API typecheck.

**Готово, когда:** обе chronological ленты проходят полный обход без повторов/пропусков и не раскрывают недоступный контент; ответ соответствует T03.

### T06. Добавить roots pagination и согласовать replies

**Тип / размер:** Backend, L. **Зависимости:** T02–T04. **PRD:** FR-01/04, API-01/02/04, AC-01–04/10/15/16.

**Файлы:** polls routes/service/repository, `polls.integration.test.ts`, `polls.routes.test.ts`.

- [x] Добавить тесты 125 roots в newest/oldest, 65 replies ASC, legacy roots default 50, исключения replies из roots, текущих reply counts и viewer likes.
- [x] Добавить `order`, cursor и high watermark для roots; replies перевести на новый scoped cursor/high watermark, сохранив окно старых cursors. В обоих направлениях использовать строгие tuple comparisons.
- [x] Проверить смену poll/root/account, удаление корня между страницами, скрытие/удаление автора и boundary; unavailable возвращает действующий 404 без раскрытия содержимого.
- [x] Выполнить целевые API tests и API typecheck.

**Готово, когда:** roots/replies соответствуют page contract и legacy defaults; все test IDs обходятся в ожидаемом порядке; cursor другой ветки отвергается.

### T07. Закрепить backend-матрицу и индексы

**Тип / размер:** Backend + QA, M. **Зависимости:** T05, T06. **PRD:** API-02/04, AC-01–04/15/16, проверки масштаба.

**Файлы:** `polls.repository.test.ts`, `polls.integration.test.ts`; новая миграция в `services/api/src/db/migrations/`; evidence T02.

- [x] Проверить планы newest/subscriptions/roots/replies на реальных индексах; добавить только необходимые составные/partial indexes отдельной следующей миграцией. Учесть, что текущий migrator исполняет файл в транзакции; `CREATE INDEX CONCURRENTLY` нельзя просто поместить в такой файл.
- [x] Закрепить динамические удаления/видимость между pages, точность timestamps и полную матрицу legacy/default/error responses. Проверить отсутствие COUNT всего набора и N+1 на строку.
- [x] Выполнить миграции, API suite/typecheck и SHARED; сохранить query plans и соответствие ожидаемым ID.

**Готово, когда:** chronological server slice пригоден для server-first выкладки; совместимость подтверждена тестами, а не только наличием поля `items`.

## P2. Flutter

### T08. Добавить Flutter page models и API-методы

**Тип / размер:** Flutter, M. **Зависимости:** T03, T05, T06. **PRD:** API-01/04, AC-16.

**Файлы:** `polls_api_client.dart`, `poll_summary.dart`, `polls_api_client_test.dart`, `poll_summary_test.dart`; создать `core/pagination/cursor_page.dart`.

- [x] Проверить query params, URL encoding cursor, nullable конец, отсутствие legacy metadata и неверные типы; покрыть timeout/close через существующий `ReadRequestScope`.
- [x] Реализовать новые page methods из общей секции. Existing array methods оставить совместимыми адаптерами для профиля и других старых consumers; replies адаптировать без потери metadata.
- [x] Выполнить FLUTTER-API; регрессионно проверить `profile_screen_test.dart` и `public_profile_screen_test.dart`.

**Готово, когда:** metadata не теряется, legacy response не запускает append и не объявляется полным концом; профиль продолжает работать.

### T09. Реализовать Flutter state machine пагинации

**Тип / размер:** Flutter, L. **Зависимости:** T08. **PRD:** FR-02/03/04, раздел 7, AC-05–07/18.

**Файлы:** создать `core/pagination/cursor_list_controller.dart`, `test/cursor_list_controller_test.dart`.

- [x] Проверить dedup по ID без изменения server cursor; один append, повтор cursor A→A и цикл A→B→A, пустую страницу с новым cursor, тройной automatic-load budget.
- [x] Проверить обе очередности append/refresh и refresh failure: старые страницы и cursor сохраняются, старые pending completions не применяются; dispose/session change запрещают применение ответа.
- [x] Реализовать controller/state из общей секции, отдельные initial/refresh/append errors и retry только соответствующего чтения; отделить transport cancellation от generation guard.
- [x] Выполнить FLUTTER-STATE; после каждой проверенной гонки assert pending снят и новый ручной запрос возможен.

**Готово, когда:** controller проходит таблицу состояний PRD и не хранит второй Poll revisions store.

### T10. Подключить Flutter Feed и subscriptions

**Тип / размер:** Flutter, M. **Зависимости:** T05, T09. **PRD:** FR-01–03, AC-01/02/05–07/15/18.

**Файлы:** `feed_screen.dart`, `subscriptions_screen.dart`, их tests; создать `core/widgets/pagination_footer.dart` и `test/pagination_footer_test.dart`.

- [x] Добавить widget tests первой/второй страницы, footer Retry, empty/end, ручной кнопки, scroll storm, трёх автодогрузок и независимости двух лент.
- [x] Подключить page methods/controller, viewport trigger, pull-to-refresh и footer. Сохранить страницы при возврате и отдельно хранить identity Feed/Following.
- [x] Связать follow/unfollow с invalidation Following и новым refresh без смешивания с Feed. На logout/dispose завершать lifecycle.
- [x] Выполнить FLUTTER-FEED и footer tests.

**Готово, когда:** обе ленты читаются дальше 20 элементов; ошибка не заменяет список; empty и exhausted различаются.

### T11. Подключить Flutter roots/replies к ленивому списку

**Тип / размер:** Flutter, L. **Зависимости:** T06, T09, T10. **PRD:** FR-01/02/06, AC-01/02/05/06/10/18.

**Файлы:** `poll_comments_screen.dart`, `poll_comments_screen_test.dart`; footer T10.

- [x] Проверить roots `order=newest`, append за 50 записей и две одновременно раскрытые ветки с раздельными cursor/error/pending.
- [x] Перевести обсуждение с построения всего дерева в `SingleChildScrollView` на lazy list/slivers, сохранив composer, poll header и stable keys.
- [x] Подключить roots auto/manual append, replies только по кнопке; добавить refresh, terminal/empty/legacy states без полной перезагрузки экрана при footer error.
- [x] Выполнить FLUTTER-COMMENTS, включая раскрытие/сворачивание ветки во время запроса и удаление её корня.

**Готово, когда:** корневые страницы и ветки независимы, ответы сохраняют ASC, структура экрана готова к длинным спискам.

### T12. Согласовать Flutter mutations с несколькими страницами

**Тип / размер:** Flutter, L. **Зависимости:** T10, T11. **PRD:** FR-04, AC-07–10.

**Файлы:** Feed/subscriptions/comments screens, `poll_state_store.dart` только при необходимости; `poll_state_integration_test.dart`, `poll_comments_screen_test.dart`.

- [x] Проверить vote/like/delete на третьей странице при позднем HTTP/realtime, logout/login другим аккаунтом и удаление перед завершением append.
- [x] Пропускать входящие Poll через существующие revisions/epoch guards; tombstones и overlays не меняют server pages/cursors. Обновить все видимые экземпляры и корректно вернуть Poll родителю.
- [x] Добавить подтверждённый root в начало overlay, а далёкий собственный reply — в отдельный «Ваш ответ»; пометить хронологический разрыв и объединить по ID при достижении страницы. Сохранить draft при ошибке публикации, не повторять POST автоматически.
- [x] Выполнить целевые state integration и FLUTTER-COMMENTS/FEED tests.

**Готово, когда:** ни одна страница не откатывает свежую реакцию, публикации не дублируются, счётчики не выводятся из длины локального списка.

### T13. Сделать адресное открытие Flutter comment target

**Тип / размер:** Flutter, M. **Зависимости:** T11. **PRD:** FR-05, AC-11.

**Файлы:** `poll_comments_screen.dart`, `notification_navigation_test.dart`, `poll_comments_screen_test.dart`.

- [x] Сценарии target root/reply за десятой страницей проверяют не более двух адресных GET, 404, timeout и отдельный Retry; обычная загрузка первой страницы учитывается отдельно.
- [x] Удалить последовательную догрузку replies для поиска; показывать отсутствующие root/target в контекстном блоке и раскрывать нужный контекст без изменения main cursor.
- [x] Проверить объединение target с поздней обычной страницей, одноразовый focus и приоритет пользовательского scroll после первого показа.
- [x] Выполнить FLUTTER-COMMENTS.

**Проверки:** FLUTTER-COMMENTS (`flutter test test/poll_comments_screen_test.dart test/notification_navigation_test.dart`) — 51 passed, 0 failed. Проверены предел двух addressable GET для reply, отдельная первая страница, 404/timeout и Retry, context card без последовательного перебора replies, merge с обычной страницей и защита от focus jump после пользовательской прокрутки.

**Готово, когда:** адресное открытие не зависит от глубины ветки и не выдаёт разрыв за непрерывный список.

### T14. Закрепить Flutter scroll, lifecycle и доступность

**Тип / размер:** Flutter + QA, M. **Зависимости:** T12, T13. **PRD:** FR-06, AC-12/17.

**Файлы:** Flutter screens; `core/scroll/list_scroll_anchor_host.dart`, `list_scroll_state.dart` и соответствующие tests только по необходимости; существующие motion-компоненты.

- [x] Добавить widget tests возврата к третьей странице, media resize, footer error, удалённого якоря и клавиатуры; восстановление списка предшествует якорю и не перезапрашивает всю цепочку.
- [x] Проверить screen reader labels, увеличенный текст, ручное продолжение, reduced motion и отсутствие повторной entry-анимации прежних ID.
- [x] Выполнить FLUTTER-FINAL (`flutter analyze`, `flutter test`, `flutter build apk --debug`) с нулевым кодом выхода.
- [x] На Android проверить якорь с допуском 8 logical px и сохранить runtime evidence; widget tests подтверждают те же условия на тестовой платформе. Frame/memory profile входит в T27.

**Проверки:** `flutter analyze` прошёл; полный `flutter test` — 390 видимых passed, 1 skipped и 49 hidden passed; `flutter build apk --debug` завершился с exit 0. После фикса роста viewport у нижней границы на Samsung SM-A325F (Android 13/API 33) финальный Android-targeted набор anchor/state/controller/Following/accessibility прошёл 67/67. Реальный Android anchor probe из T27 зафиксировал 0 logical px drift при росте header на 96 px (порог 8 px); детали и raw evidence — в [`t14-flutter-scroll-accessibility.md`](../../pagination-evidence/t14-flutter-scroll-accessibility.md) и [`t27-android-sm-a325f-profile.json`](../../pagination-evidence/t27-android-sm-a325f-profile.json).

**Готово, когда:** целевые flow и доступность подтверждены, in-memory страницы не теряются при возврате; относящиеся к scope failures устранены.

## P3. Web

### T15. Добавить web page API и строгие decoders

**Тип / размер:** Web, M. **Зависимости:** T03, T05, T06. **PRD:** API-01/04, AC-16.

**Файлы:** `apps/web/src/api/models.ts`, `polls.ts`, `polls.test.ts`.

- [x] Проверить page decoding, explicit null, отсутствие legacy поля, неверный тип, cursor encoding, `AbortSignal`, newest/oldest и subscriptions auth.
- [x] Добавить page methods из общей секции, включая отсутствующий сейчас web subscriptions helper; существующие array consumers оставить совместимыми.
- [x] Выполнить WEB-API и web typecheck; проверить профильные tests как regression общих DTO/helpers.

**Готово, когда:** новые UI получают metadata без потери текущего viewer/revision state; legacy server не запускает повтор первой страницы.

### T16. Согласовать infinite query state и Poll cache

**Тип / размер:** Web, L. **Зависимости:** T15. **PRD:** FR-02–04, раздел 7, AC-05–08/18.

**Файлы:** создать `core/pagination/pagination-state.ts`, `pagination-state.test.ts`; изменить `features/polls/poll-state.ts`/tests при необходимости.

- [x] Проверить cursor history, лимит автоматики, ID merge, устаревшие generations/session epochs, refresh success/failure при одновременном append и готовность повторного запроса после ошибки.
- [x] Реализовать helpers из общей секции; определить query keys со scope session/user/sort/poll/root и отключить refetch всех накопленных pages на focus.
- [x] Проверить `fetchPollQuery`/`ingestPoll`/`replacePollInQueryData` на `InfiniteData`: `pages` и `pageParams` сохраняются; revisions и tombstones обрабатываются как раньше. Не считать форму массива единственной допустимой.
- [x] Выполнить WEB-STATE и tests session lifecycle; assert logout/login не возвращает viewer state старого аккаунта.

**Готово, когда:** принятая page chain устойчива к гонкам и совместима с действующим Poll store без его дублирования.

### T17. Подключить web Feed и настоящий Following

**Тип / размер:** Web, M. **Зависимости:** T05, T16. **PRD:** FR-01–03, AC-01/02/05–07/15/18.

**Файлы:** `features/feed/FeedPage.tsx`, `FeedPage.test.tsx`; создать `components/PaginationFooter.tsx`; follow invalidation в существующих consumers `api/profiles.ts` по месту вызова.

- [x] Добавить tests viewport/button append, double click, retry, refresh, вкладок и возврата; Following должен вызывать `/polls/subscriptions`, а не общий `/polls`.
- [x] Перевести ленту на `useInfiniteQuery` с helpers T16; добавить явный Refresh, footer и guest state Following. Отдельно сохранить состояния вкладок.
- [x] При follow/unfollow инвалидировать только персональную выдачу с новым generation; добавить ограничение трёх автоматических загрузок и ручной recovery.
- [x] Выполнить WEB-FEED и web typecheck.

**Готово, когда:** вторая/третья страницы доступны, Following содержит только подписки, переключение вкладки не смешивает pages или ошибки.

### T18. Подключить web roots и независимые replies

**Тип / размер:** Web, M. **Зависимости:** T06, T16, T17. **PRD:** FR-01/02/03, AC-01/02/05/06/10/18.

**Файлы:** `features/comments/CommentList.tsx`, `CommentThread.tsx`, `PollDetailPage.tsx`/`PollDetailPage.test.tsx`, `CommentThread.test.tsx`; адаптировать `components/PaginationFooter.tsx` T17.

- [x] Проверить 125 newest roots, pagination footer, legacy state и две раскрытые ветки; append error одной ветки не блокирует другую.
- [x] Перевести roots на infinite pages; replies сохранить на `useInfiniteQuery`, добавив общие guards и ручную кнопку без автоматического чтения ветки.
- [x] Добавить refresh обсуждения с новой generation, сохранением старых pages при ошибке и перезапуском раскрытых веток по необходимости.
- [x] Выполнить WEB-COMMENTS и typecheck.

**Готово, когда:** roots/replies используют согласованные rules и не зависят от длины массива/счётчика при определении конца.

### T19. Перевести web mutations на многостраничный cache

**Тип / размер:** Web, L. **Зависимости:** T17, T18. **PRD:** FR-04, AC-07–10.

**Файлы:** `features/comments/PollDetailPage.tsx`, `CommentList.tsx`, `CommentThread.tsx`; `features/polls/usePollMutations.ts`, `poll-state.ts` и tests по необходимости.

- [x] Проверить create/like/delete root/reply на нескольких pages, поздние list ответы, logout/login и взаимодействие vote/like/realtime на третьей странице Feed.
- [x] Перевести все comment cache writers с `PollComment[]` на server pages + overlays; сохранять `pageParams`, pending per entity и authoritative counters. Удалённые записи защищать в текущей generation.
- [x] Создавать root overlay и отдельный далёкий own reply с обозначенным разрывом; при встрече ID в page объединять без повторного focus. При ошибке POST сохранять текст и не выполнять automatic resubmit.
- [x] Выполнить WEB-COMMENTS и `usePollMutations.test.tsx`/`poll-state.test.ts`.

**Готово, когда:** реакции и counters актуальны во всех представлениях, новые записи не ломают cursor и не дублируются.

### T20. Сделать адресное открытие web comment target

**Тип / размер:** Web, M. **Зависимости:** T18. **PRD:** FR-05, AC-11.

**Файлы:** `features/comments/PollDetailPage.tsx`, `CommentList.tsx`, `CommentThread.tsx`, `comment-scroll.ts`; comments tests.

- [x] Закрепить число запросов для далёких root/reply, 404, сетевую ошибку и отдельный Retry; последовательно читать replies pages для target нельзя.
- [x] Использовать getComment target/parent и отдельный контекстный блок; main pages/`pageParams` не менять ради target.
- [x] Проверить достижение ID обычной пагинацией, dedup, одноразовый focus и отсутствие повторного scroll после пользовательского действия.
- [x] Выполнить WEB-COMMENTS.

**Готово, когда:** ссылка открывает цель независимо от номера страницы, а доступная часть обсуждения остаётся рабочей при ошибке target.

### T21. Закрепить web scroll, стоимость рендера и доступность

**Тип / размер:** Web + QA, L. **Зависимости:** T19, T20. **PRD:** FR-06, AC-12/17.

**Файлы:** Feed/comments UI, `core/scroll/useListScrollState.ts`, `ScrollRestorationCoordinator.tsx` и tests; существующие motion-компоненты.

- [x] Проверить восстановление третьей страницы до anchor, удалённого соседа, поздние media, footer error и explicit target; допуск 8 CSS px измеряется в браузере.
- [x] Снять trace на 100 и 1 000 элементах; выбрать и применить минимальный необходимый способ ограничения render cost. Windowing, если нужен, сохраняет данные, keyboard focus и путь назад; не добавлять его без evidence проблемы.
- [ ] Проверить manual append/Retry с клавиатуры и screen reader, увеличенный текст, reduced motion и registry старых entry animations. Клавиатура, accessibility tree, увеличенный текст и motion/registry покрыты; ручное чтение реальным screen reader осталось pending (в системе нет запущенного NVDA и доступного воспроизводимого screen-reader вывода).
- [x] Выполнить WEB-FINAL и сохранить browser evidence. Финальные frame/memory бюджеты проверяются в T27.

**Готово, когда:** длинный список не теряет позицию/focus; стратегия рендера обоснована измерением и удовлетворяет FR-06.

## P4. Стабильная popular

### T22. Реализовать snapshot storage и lifecycle

**Тип / размер:** Backend, L. **Зависимости:** T01, T04, T07. **PRD:** API-03, AC-13/14.

**Файлы:** создать `poll-feed-snapshots.repository.ts`, `poll-feed-snapshots.test.ts`, `jobs/cleanup-poll-feed-snapshots.ts`; миграция snapshot tables при выборе PostgreSQL; env/server/job wiring согласно ADR.

- [x] Проверить сохранённый rank/order, TTL ровно 30 минут без продления, квоту владельца из ADR, конкурентное создание, cleanup и отсутствие доступа другого владельца.
- [x] Реализовать интерфейсы snapshot repository из общей секции: immutable ordered IDs, server-side position, безопасную ownership binding и исключение долгоживущей транзакции между HTTP calls.
- [x] Подключить cleanup и ограничения storage из ADR; verify, что выборка не обрезается первыми N ID. Номер миграции выбрать после фактически существующих migrations.
- [x] Выполнить snapshot tests, API typecheck и migration check; сохранить пример lifecycle evidence.

**Готово, когда:** snapshots имеют ограниченный срок/количество, полный зафиксированный порядок и проверяемую очистку. Лимиты не меняют полноту отдельного snapshot.

### T23. Подключить popular snapshot к API

**Тип / размер:** Backend, L. **Зависимости:** T03, T22. **PRD:** API-03/04, AC-13–16/18.

**Файлы:** polls routes/service/repository/integration tests; snapshot repository T22.

- [x] Проверить изменение score через границу страницы, удаление всех ID в диапазоне, refresh, expiry, чужой snapshot и доступность карточек после удаления/модерации автора.
- [x] Первую `sort=popular` страницу строить по snapshot, следующие — по сохранённым позициям; hydrate текущие значения и повторно применять visibility. Cursor продвигается по scanned positions, даже если итоговый массив пуст.
- [x] Вернуть `410 pagination_expired` для истёкшей выдачи; сохранить формулу rank и legacy первой страницы. При исчерпании snapshot — null, без молчаливого перехода на новый rank.
- [x] Выполнить API suite/typecheck; полный stable набор из fixture обходится один раз независимо от изменений score.

**Проверки:** `npm run api:typecheck` — exit 0; `npm run api:test` — 349 passed, 0 failed, 7 skipped.

**Готово, когда:** popular гарантирует стабильное продолжение и не раскрывает контент только потому, что его ID сохранился в snapshot.

### T24. Подключить stable popular и expired UX на двух клиентах

**Тип / размер:** Flutter + web, M. **Зависимости:** T12, T19, T23. **PRD:** FR-02–04, API-03/04, AC-13/14/18.

**Файлы:** Flutter Feed/API/footer и tests; web Feed/API/footer и tests.

- [x] Добавить tests stable popular с reactions, пустой страницей с новым cursor, repeated cursor и `410` на append. Во Flutter подключить согласованную в T01 точку входа popular, включая минимальный переключатель сортировки, если его ранее не было.
- [x] При expiry сохранить прочитанные pages и anchor, остановить append и предложить «Обновить ленту»; только явное действие создаёт новый snapshot. Reactions не пересортировывают текущую выдачу.
- [x] Выполнить FLUTTER-FEED, WEB-FEED и decoder tests; проверить три automatic attempts и последующее ручное управление.
- [x] Подключить `YASKAPP_FEED_PAGINATION` и `VITE_FEED_PAGINATION` как build-time flags с default `false`; при выключенном флаге оставить первую страницу и скрыть continuation во всех scoped surfaces.

**Проверки:** Flutter — 74 целевых теста прошли; `flutter analyze` изменённых файлов — без замечаний. Web — 50 целевых тестов и `typecheck` прошли; production builds проверены с `VITE_FEED_PAGINATION=false` и `true`. Отдельно проверены default-off Flutter и `--dart-define=YASKAPP_FEED_PAGINATION=true`.

**Готово, когда:** оба клиента различают конец/ошибку/expiry и не смешивают snapshots разных refresh.

## P5. Наблюдаемость, приёмка и выпуск

### T25. Добавить безопасную наблюдаемость пагинации

**Тип / размер:** Backend + клиенты, M. **Зависимости:** T04, T09, T16, T23. **PRD:** раздел 10.

**Файлы:** точка API logging в polls routes; pagination controllers/helpers; создать Flutter `core/analytics/pagination_analytics.dart` и web `core/pagination/pagination-analytics.ts` с целевыми tests, если подходящего adapter ещё нет.

- [x] Закрепить schema событий start/success/failure/retry/refresh/cursor anomaly: surface, sort, page number, duration, item count, error code, request ID. Добавить проверку, что raw cursor, auth headers и comment body не передаются adapter/log sink.
- [x] Подключить существующий logging/analytics sink; не создавать новый сервис. Добавить измерения latency/failures, cursor loops, dedup и snapshot storage/expiry.
- [x] Проверить контрольные успешные и неуспешные запросы с synthetic markers, сверить redaction и отсутствие двойных событий из late completions.

**Готово, когда:** исход запроса диагностируется без чувствительного payload; список метрик и способ чтения описаны в evidence README.

### T26. Проверить API на большом наборе и устранить узкие места

**Тип / размер:** Backend + QA, L. **Зависимости:** T07, T23, T25. **PRD:** проверки масштаба, API-03.

**Файлы:** создать `scripts/pagination-load.mjs`; fixture helper T02; query/migration files только по результатам измерений; `docs/pagination-evidence/`.

- [x] Добавить режимы fixture seed, load и cleanup для отдельного test dataset; harness поддерживает seed на 100 000 public polls, 10 000 roots у одного poll и 2 000 replies у корня. Для replies выбран набор больше минимума PRD (1 000), чтобы глубокая страница после 1 000 элементов оставалась непустой. Harness подготовлен для выделенного согласованного окружения. Файлы: [`scripts/pagination-load.mjs`](../../../scripts/pagination-load.mjs); настройки и запуск: [`t26-runbook.md`](../../pagination-evidence/t26-runbook.md).
- [x] Закрыть T26 без staging-прогона по прямому решению пользователя от 2026-10-27. Измерения при 20 читателях, проверка p95/роста deep-first, возможные оптимизации и повторные прогоны отменены; показатели остаются непроверенными. Harness и локальная инструкция сохранены для будущего запуска: [`scripts/pagination-load.mjs`](../../../scripts/pagination-load.mjs), [`t26-runbook.md`](../../pagination-evidence/t26-runbook.md).

**Готово, когда:** harness подготовлен; в этом исполнении пользователь явно отменил staging-прогон и принял закрытие пункта без подтверждения performance-бюджетов и cleanup на среде.

### T27. Пройти сквозную матрицу и клиентские performance/lifecycle проверки

**Тип / размер:** QA + Flutter/web, L. **Зависимости:** T14, T21, T24–T26. **PRD:** AC-01–18, раздел 8 и DoD.

**Файлы:** существующие client/API suites; создать `docs/pagination-evidence/acceptance-matrix.md`; сохранить Android/browser profile traces рядом.

**Результат T27, 2026-10-28 — закрыта по решению пользователя с частичными доказательствами:** матрица AC-01–18, воспроизводимый capture harness и production headless Chrome traces сохранены в [`acceptance-matrix.md`](../../pagination-evidence/acceptance-matrix.md). Web final проходит, но headless capture записал 25.45–36.82% RAF intervals выше 16,7 мс против порога <5%; физическое display timing этим запуском не подтверждено. На разблокированном Samsung SM-A325F (Android 13/API 33, активный экран 90 Гц) для 100/1 000 элементов измерены Android feed (35.90% / 10.83% кадров свыше 16,67 мс), comment roots (4.77% / 5.12%) и три ветки по 65 ответов (4.46%). Roots100 — пограничный pass: p95 16.665 мс и максимум 192.529 мс; feed100 выполнялся 50 скриптовыми ADB свайпами по 60 мс. Feed100, feed1000 и roots1000 не проходят бюджет <5%, ветки проходят. Физическая проверка якоря после роста незаякоренного header на 96 логических пикселей измерила дрейф 0 px при допуске 8 px. На телефоне повторены три synthetic lifecycle cycles по 10 страниц / 200 элементов: активных запросов при выходе не было, listener снят, controller items очищены; PSS после 10 секунд покоя составил 176.177, 176.004 и 177.308 МБ относительно idle baseline 175.461 МБ. Это fixture controller, не production FeedScreen/кэш TTL. Ранее выбранные Android feed/comments suites прошли 56 тестов; после anchor refactor целевые Android-targeted anchor/state/controller suites прошли 36/36. `flutter analyze --no-pub` и profile fixture build прошли. Полные raw frame samples сохранены в [`t27-android-sm-a325f-profile.json`](../../pagination-evidence/t27-android-sm-a325f-profile.json), fixture harness — в [`t27_profile_main.dart`](../../../apps/mobile/tool/t27_profile_main.dart). По просьбе пользователя AC-матрица, TalkBack speech и API-проверки не запускались. T04, T13 и T14 закрыты; T21 реальный screen-reader output остаётся незакрытым. Чекбоксы ниже отражают непроверенные или не прошедшие критерии; закрытие задачи не означает прохождение этих acceptance gates.

- [ ] Пройти AC-01–18 на Android и web с fixtures T02, включая старые/новые контракты, guest, два аккаунта, failures, rate limit/Retry-After, offline/timeout и ambiguous POST без повторной отправки.
- [ ] Прокрутить 1 000 карточек/roots и несколько веток на Android profile build и в web trace; сравнить со 100 элементами. Бюджеты: <5% кадров сверх бюджета 60 Hz Android и <5% кадров >16,7 мс web. Android 100/1 000 элементы и три ветки измерены: feed100, feed1000 и roots1000 превышают бюджет. Web workload для 100 элементов записан.
- [ ] Выполнить три цикла «открыть → загрузить 10 страниц → выйти», освободив cache по политике T01: listeners/requests/retained screens возвращаются к baseline, память не растёт монотонно. Fixture циклы показали 0 active requests, снятый listener и 0 retained items; PSS после 10 секунд покоя колебался на 0.54–1.85 МБ выше baseline. Production screen/cache TTL не проверены. Физическая проверка якоря прошла: рост header на 96 логических пикселей, дрейф 0 px при допуске 8 px.
- [ ] Выполнить API/SHARED, FLUTTER-FINAL и WEB-FINAL; исправить относящиеся к scope defects и повторить связанные проверки. API-проверки пропущены в текущем проходе по прямой просьбе пользователя; пункт остаётся незакрытым. По каждой строке матрицы указать evidence или failure, без подмены missing runtime проверок успешным результатом.

**Готово, когда:** обе платформы и API проходят критерии, измерения и обязательные сборки; матрица содержит воспроизводимые ссылки на доказательства.

**Статус закрытия:** пользователь закрыл T27 2026-10-28 без AC-матрицы, TalkBack и API-проверки, приняв перечисленные непроверенные критерии и performance misses. Незакрытые чекбоксы выше сохранены как точная запись остаточного объёма, а не как утверждение о прохождении.

### T28. Подготовить и провести server-first выпуск с rollback

**Тип / размер:** Engineering + QA, M. **Зависимости:** T27. **PRD:** API-04, раздел 10, DoD.

**Файлы:** создать `docs/pagination-release-checklist.md`, `docs/pagination-evidence/release-record.md`; существующие release controls/CI менять только по необходимости.

- [x] Подготовить конкретный checklist: миграции и cleanup, совместимый API, окно legacy replies из T01, затем ограниченное включение web/Flutter и наблюдение метрик; указать владельцев решения о расширении охвата. См. [`pagination-release-checklist.md`](../../pagination-release-checklist.md) и [`release-record.md`](../../pagination-evidence/release-record.md). Владельцы заданы ролями; перед запуском нужно вписать имена.
- [ ] На staging проверить старый клиент с новым API и новые clients с legacy response; протестировать выключение новой автодогрузки и возврат к первой странице без удаления additive API/старых decoders. Не выполнялось: staging URL и `.env.staging` отсутствуют; Docker Engine недоступен. Build-time flags T24 реализованы и проверены локально. Проверку пропущено по решению пользователя закрыть T28 без staging.
- [ ] После требуемого в проекте допуска к выкладке выполнить последовательность, smoke и наблюдение; записать commit/build, migration status, timestamp, устройства, результаты AC/performance, rollback result и ограничения. Выкладка, наблюдение и rollback пропущены по решению пользователя закрыть T28 без staging.

**Статус закрытия:** пользователь закрыл T28 2026-10-28 без staging. Release checklist и evidence record подготовлены; T04, T13 и T24 закрыты. Staging, rollout, метрики и rollback smoke не выполнялись: в текущем окружении нет staging URL и защищённого `.env.staging`, Docker Engine недоступен, `apps/mobile/android/key.properties` отсутствует. Имена владельцев релиза, изолированность staging database, решение Release Owner по ограничениям T27 и staging build IDs не зафиксированы. Это закрывает пункт плана по решению пользователя, но не подтверждает выпуск и не создаёт release evidence.

**Обычный release DoD:** release record подтверждает фактически выполненный rollout/rollback smoke; подготовка checklist без выкладки не подтверждает выпуск. По прямому решению пользователя T28 закрыта без этих проверок; release record сохраняет их как NOT RUN.

## Покрытие PRD задачами

| Требование | Основные задачи реализации | Проверка |
|---|---|---|
| FR-01: поверхности и порядок | T01, T05, T06, T10, T11, T17, T18, T23, T24 | AC-01/02/10/15, T27 |
| FR-02: append, конец, loops, ручное действие | T09–T11, T16–T18, T24 | AC-05/06/14/17/18 |
| FR-03: refresh, generations, session/follow invalidation | T09, T10, T16, T17, T18 | AC-06/07/15 |
| FR-04: merge, mutations, overlays, counters | T12, T16, T19, T24 | AC-08/09/10/13 |
| FR-05: адресный target | T13, T20 | AC-11 |
| FR-06: lazy rendering, anchor, a11y, motion | T11, T14, T21, T27 | AC-12/17, traces |
| API-01: page contract и DTO | T03, T05, T06, T08, T15 | AC-01/02/16 |
| API-02: keyset, точность, scope | T04–T07 | AC-03/04/15 |
| API-03: stable popular и lifecycle | T01, T22–T24, T26 | AC-13/14 |
| API-04: ошибки и совместимость | T04–T08, T15, T23, T24, T28 | AC-06/15/16 |
| Раздел 7: клиентская state machine | T09, T16 и экранные задачи | AC-05–10/18 |
| Раздел 8: масштаб и evidence | T02, T07, T14, T21, T26, T27 | Все AC + performance budgets |
| Раздел 10: наблюдаемость, rollout, rollback | T25, T28 | Redaction tests и release record |

Все AC имеют владельцев: **01–04** — T05–T07; **05–07** — T09/T10/T16/T17; **08–09** — T12/T19; **10** — T11/T18; **11** — T13/T20; **12** — T14/T21; **13–14** — T22–T24; **15** — T05/T07/T10/T17; **16** — T03/T07/T08/T15/T28; **17** — T14/T21; **18** — T09/T16/T24. Сквозное подтверждение всех 18 — T27.

## Рекомендуемые контрольные точки

1. **API ready:** T01–T07 завершены; chronological contract проверен, можно интегрировать оба клиента.
2. **Chronological feature ready:** T08–T21 завершены; обе платформы читают все chronological страницы, публикации/targets/scroll проверены. Это промежуточный результат, не готовность всего эпика.
3. **Popular ready:** T22–T24 завершены; стабильность и expired UX подтверждены.
4. **Release ready:** T25–T27 завершены; общий DoD допускает выпуск.
5. **Epic done:** T28 завершён с release evidence, все критерии PRD подтверждены.

Оценки S/M/L — относительная сложность отдельной задачи, не обещание срока: S — локальный контракт, M — один проверяемый flow, L — изменение с гонками, большим состоянием или нагрузкой. Календарные оценки и назначение конкретных исполнителей добавляются после T01 и baseline, без изменения зависимостей.
