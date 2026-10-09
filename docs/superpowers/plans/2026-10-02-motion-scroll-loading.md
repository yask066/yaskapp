# Motion, scroll and loading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Делегирование допускается только при отдельном разрешении пользователя.

**Goal:** Стабилизировать реакции, layout, scroll и loading в Flutter и web, затем добавить проверенные анимации.

**Architecture:** Серверное состояние и merge отделены от presentation. Каждый клиент использует стабильные ID, состояние операции по опросу и контекст восстановления списка. Motion подключается через независимые flags после общего G0.

**Tech Stack:** Flutter/Dart; React/TypeScript, TanStack Query, Vitest/MSW; Node.js/Fastify, PostgreSQL, shared contracts. Новые библиотеки по умолчанию не требуются.

**Spec:** [PRD: Плавные реакции, появление карточек и стабильная прокрутка](../../prd-motion-scroll-loading.md).

**Дата:** 2 октября 2026 года.  
**Статус:** M01–M17 завершены как implementation/evidence tasks; M17 baseline измерен и зафиксирован, Android AC-12 не пройден, поэтому G0 остаётся `NOT PASSED`. M01–M03 и M05, M07–M16 завершены; детали ранних задач приведены ниже. M04 проверена 9 октября на отдельной PostgreSQL test DB: 159/160 API tests прошли, единственный сбой — ранее зарегистрированный unrelated logout-token test `auth.cookie.integration.test.ts`; M04 integration assertions и typecheck прошли, см. [M04 verification](../../motion-scroll-loading-evidence/m04-verification.md). M17 завершена по сбору evidence 9 октября: Flutter 265 passed/1 skipped, Web 240/240, web typecheck/lint/build passed; strict M06 races 6/6 и M14 dedup 1/1; 20 production navigation cycles дали 0 CSS px. Physical Chrome 155 profile на дисплее 1680×1050/60 Hz: active page-source `MISSED` 0–0.0555%. Samsung SM-A325F profile APK собран с `M17_AC12_PROBE=true` на `ac13b283`; актуальные Android FrameTiming captures подтверждают превышение 1% в scroll/reaction workload, см. [M17 verification](../../motion-scroll-loading-evidence/m17-verification.md) и [Android AC-12 profile](../../motion-scroll-loading-evidence/android-ac12-2026-10-09/README.md). Устройство поддерживает 60/90 Hz, но не 120 Hz; motion-off comparison отсутствует. M04 evidence обновлена; остальные G0 blockers перечислены в [M18 report](../../motion-g0-report.md). M19 реализована до прохождения G0 по запросу пользователя. M20 завершена 9 октября: settings tests и build-flag variants проходят, M20 changed-file analyze чист; package-wide analyze сохраняет 11 diagnostics вне M20. M21–M23 завершены 9 октября по tests/browser checks. M24 automatic checks завершены, device smoke остаётся невыполненным. M25 завершена решением оставить skeleton статическими. M26 частично выполнена: live flags-on integration, 20-cycle lifecycle comparison и paired AC-12 traces не сняты. G0 остаётся `NOT PASSED`.
**Нумерация:** M01–M27; исторические T01/T02 не переименовываются и не считаются закрытыми задачами этого плана.

## Global Constraints

- «Не добавлять новые анимации до подтверждённой стабилизации логики и layout»; M19–M25 закрыты до M18/G0 для обеих платформ.
- Только существующие экраны и действия; не создавать feed pagination, новые realtime-каналы, route transitions или optimistic layer ради motion.
- Сохранение содержательного якоря: не более 2 CSS px в web / 2 logical px во Flutter при неизменном viewport, без пользовательского scroll во время проверки.
- Text scale 200%; media slot 16:9 по умолчанию; ошибка и повторная загрузка сохраняют размер.
- Skeleton после 150 мс ожидания, резервирование области сразу; read timeout 10 секунд; нет искусственной минимальной длительности skeleton.
- Count/percent 180 мс; bar 240 мс; like/selected 160 мс, scale максимум 1.08; entry 200 мс, translateY 8→0; stagger 35 мс, максимум 6 видимых карточек и до 400 мс; skeleton crossfade до 120 мс.
- `reactionsMotion` и `entryMotion` независимы. Reduced motion отключает эффекты и программный smooth-scroll немедленно.
- AC-12: не более 1% кадров за бюджетом в каждом прогоне; прирост относительно стабилизированной версии без motion ≤0,5 процентного пункта.
- Непроведённая проверка обозначается «не измерено», а не «пройдено». Устройства, trace и сборки фиксируются фактически.
- Оценка календарных сроков — после M01–M03; размер задач не заменяет G0. Backend migration выполняется только на выделенной тестовой БД при проверках.

## Review Focus

1. Старый полный HTTP snapshot после нового независимого действия: итог сохраняет свежие vote и like; тесты M03–M06.
2. Logout → вход другим пользователем → поздний ответ: чужое состояние и позиция не применяются; тесты M07–M08, M11–M12.
3. Удалён сам экранный якорь либо несколько элементов выше него: используется следующий/предыдущий сохранившийся элемент; тесты M11–M14.
4. Новое значение и переключение reduced motion в середине эффекта: текущая цель заменяется, старые timers не продолжают работу; тесты M19–M24.
5. Возврат назад после load-more и virtualized remount: сохраняются страницы, focus и позиция, old entry не повторяется; тесты M13–M14, M23–M24.

## 1. Порядок и зависимости

| ID | Задача | Зависит от | Владелец | Этап |
|---|---|---|---|---|
| M01 | Аудит поверхностей и текущих дефектов | — | Engineering + QA | A1 |
| M02 | Общие fixture и управляемые network-сценарии | M01 | QA + Engineering | A1 |
| M03 | Зафиксировать контракт актуальности данных | M01, M02 | Backend + Flutter + Web | A2 |
| M04 | Реализовать нужное расширение backend/shared | M03 | Backend | A2, условная |
| M05 | Web: merge, cache и per-poll pending | M03, M04* | Web | A2 |
| M06 | Flutter: merge, общий state и per-poll pending | M03, M04* | Flutter | A2 |
| M07 | Web: timeout, retry и lifecycle | M05 | Web | A2 |
| M08 | Flutter: timeout, retry и lifecycle | M06 | Flutter | A2 |
| M09 | Web: стабильная геометрия | M05 | Web | A3 |
| M10 | Flutter: стабильная геометрия | M06 | Flutter | A3 |
| M11 | Web: механизм scroll context и anchor | M07, M09 | Web | A3 |
| M12 | Flutter: механизм scroll context и anchor | M08, M10 | Flutter | A3 |
| M13 | Web: подключить scroll на всех поверхностях | M11 | Web | A3 |
| M14 | Flutter: подключить scroll на всех поверхностях | M12 | Flutter | A3 |
| M15 | Web: статические skeleton и loading states | M07, M09, M13 | Web | A4 |
| M16 | Flutter: статические skeleton и loading states | M08, M10, M14 | Flutter | A4 |
| M17 | Проверить стабилизацию и снять baseline без motion | M02, M05–M16 | QA + Engineering | A4 |
| M18 | Отчёт и решение G0 | M17 | Engineering + QA | G0 |
| M19 | Web: flags, tokens и reduced motion | M18 | Web | B1 |
| M20 | Flutter: flags, tokens и reduced motion | M18 | Flutter | B1 |
| M21 | Web: анимации реакций | M19 | Web | B1 |
| M22 | Flutter: анимации реакций | M20 | Flutter | B1 |
| M23 | Web: появление карточек | M21 | Web | B2 |
| M24 | Flutter: появление карточек | M22 | Flutter | B2 |
| M25 | Необязательный shimmer | M23, M24 | Web + Flutter | B2, необязательная |
| M26 | Финальная проверка motion, кадров и lifecycle | M21–M24, решение M25 | QA + Engineering | C |
| M27 | Подготовить выпуск и инструкцию отключения | M26 | Engineering + QA | C |

`M04*`: после M03 задача либо выполняется, либо закрывается документированным решением «расширение не требуется» с доказательствами. Нельзя молча пропустить её при отсутствии контракта свежести.

После общих M01–M04 ветки клиентов независимы по зависимостям; это позволяет планировать работу отдельно. M18 объединяет обе ветки и закрывает переход к motion, если хотя бы одна не прошла проверки.

Каждая implementation-задача включает regression test → подтверждение исходного failure → изменение → целевую проверку → самостоятельный review и небольшой commit. Для аудита/отчётов проверяется артефакт и полнота evidence; тесты, повторяющие текст документа, не пишутся. Commit содержит только файлы завершённой задачи.

## 2. Карта файлов и границы компонентов

Пути ниже относительно корня репозитория. **Новые** файлы — предлагаемые результаты задач, а не уже существующие компоненты.

| Область | Существующие точки изменения | Новые результаты |
|---|---|---|
| Fixture / отчёты | `test/fixtures/t02-motion-scroll-loading-polls.json`, `scripts/t02-motion-scroll-baseline-server.mjs`, его `.test.mjs`, `apps/web/src/test-utils/t02-motion-scroll-fixture.ts` | `docs/motion-scroll-loading-audit.md`, `docs/motion-poll-state-contract.md`, `docs/motion-g0-report.md`, `docs/motion-release-verification.md` |
| Backend, при необходимости | `packages/shared/src/index.ts`, `services/api/src/modules/polls/polls.repository.ts`, `polls.routes.ts`, search repository/types, `services/api/src/realtime/realtime.hub.ts` | Только контракт/миграция, обоснованные M03; номер миграции выбрать по следующему свободному номеру перед исполнением |
| Web state | `apps/web/src/features/polls/usePollMutations.ts`, `apps/web/src/api/models.ts`, `apps/web/src/api/client.ts`, session/query integration | `apps/web/src/features/polls/poll-state.ts` и `.test.ts` |
| Flutter state | `apps/mobile/lib/src/features/polls/poll_summary.dart`, API clients, feature screens и realtime | `apps/mobile/lib/src/features/polls/poll_state_store.dart`, `apps/mobile/test/poll_state_store_test.dart` |
| Web layout/loading | `PollCard.tsx`, `Avatar.tsx`, `AsyncState.tsx`, `global.css` и потребляющие экраны | `apps/web/src/components/ContentSkeleton.tsx` и `.test.tsx` |
| Flutter layout/loading | `poll_card.dart`, `user_avatar.dart` и потребляющие экраны | `apps/mobile/lib/src/core/widgets/content_skeleton.dart`, `apps/mobile/test/content_skeleton_test.dart`, `apps/mobile/test/poll_card_layout_test.dart` |
| Web scroll | `router.tsx`, feed/search/profile/comments/notifications | `apps/web/src/core/scroll/list-scroll-state.ts`, `useListScrollState.ts`, соответствующие tests |
| Flutter scroll | Feed SliverList, search, profiles, subscriptions, comments и notifications | `apps/mobile/lib/src/core/scroll/list_scroll_state.dart`, `apps/mobile/test/list_scroll_state_test.dart` |
| Web motion | `PollCard.tsx`, карточки комментариев/уведомлений и списки | `apps/web/src/core/motion/motion-settings.tsx`, `motion-tokens.ts`, `AnimatedCount.tsx`, `EntryMotion.tsx`, соответствующие tests |
| Flutter motion | `poll_card.dart`, карточки и списки | `apps/mobile/lib/src/core/motion/motion_settings.dart`, `motion_tokens.dart`, `animated_count.dart`, `entry_motion.dart`, соответствующие tests в `apps/mobile/test/` |

Большие screen-файлы не переписываются целиком. State/scroll/motion выносятся в перечисленные компоненты только в пределах задачи; UI-specific поведение остаётся в feature.

## 3. Этап A — стабилизация

### M01. Аудит поверхностей и дефектов

**Зависимости:** нет. **Результат:** актуальная матрица экранов, источников данных, scroll containers и блокеров.

**Файлы:** создать `docs/motion-scroll-loading-audit.md`; читать PRD, T02, feature screens и существующие tests обеих платформ.

- [x] Перечислить реальные поверхности: Flutter Feed, search/discovery, subscriptions, profile/public profile, poll comments, notifications; web Feed, Search, PublicProfile, PollDetail/CommentThread, Notifications. Отметить недоступные действия, не добавляя их в scope.
- [x] Для каждой поверхности записать cache/store, запросы, subscriptions, keys, pending, loading и путь возврата назад.
- [x] Перепроверить T02 race/media сценарии и связанные Flutter failures; разделить «воспроизведён», «не воспроизведён», «не проверен». Зафиксировать команды, build и evidence.
- [x] Указать реальный доступ к Android/iOS и browser profiling; недоступные цели оставить открытыми.
- [x] Проверить полноту матрицы относительно PRD, сохранить audit отдельно от исторического T02.

**Выполнено 2 октября 2026 года:** [аудит M01](../../motion-scroll-loading-audit.md), evidence в `docs/motion-scroll-loading-evidence/`. Реестр содержит сценарии и владельцев M03–M16; результаты подготовки патча и повторной проверки при его применении разделены. Android/iOS и AC-12 profiling остаются «не измерено»; G0 не пройден.

**Готово:** у каждого дефекта есть сценарий и владеющая задача M03–M16; никакой старый test result не объявлен свежим.

### M02. Fixture и управляемые сценарии

**Зависимости:** M01. **Результат:** общий воспроизводимый набор для correctness, layout и profiling.

**Файлы:** изменить T02 JSON, mock server/test и web fixture adapter; расширить Flutter `feed_screen_test.dart`, `search_screen_test.dart` и web mutation tests при подключении harness.

- [x] Добавить данные `0`, `9/10`, `99/100`, `999/1000`, равные результаты, длинный текст, медленное/ошибочное media, две страницы с повторным ID. Генератор profiling создаёт 100 уникальных ID; feed API остаётся одностраничным.
- [x] Добавить управляемые gates для response order и realtime injection в клиентские тесты. HTTP mock не обозначать realtime-проверкой.
- [x] Проверить `race_preserves_independent_fields`: после vote-start → like-finish → vote-finish итог `viewerHasLiked=true`, новый `likesCount`, актуальные votes; добавить обратный порядок и stale refetch.
- [x] Проверить fixture/server: `node --test scripts/t02-motion-scroll-baseline-server.test.mjs`; все HTTP/fixture assertions проходят. Ожидаемые race failures остаются входом M05/M06, а не маскируются permissive assertions.
- [x] Записать seed, scenario, задержки и команды в audit; сохранить изменения отдельным commit.

**Выполнено 2 октября 2026 года:** [M02: сценарии, команды и результаты](../../motion-scroll-loading-audit.md#9-m02-fixture-и-управляемые-сценарии). Node 10/10; web 126/126, включая три явно ожидаемых failures M05; Flutter полный suite 142 passed / 15 прежних failed / 5 известных regression cases skipped по умолчанию. Отдельный opt-in запуск воспроизвёл четыре строгих failures M06 и page-dedup failure M14. Assertions требуют правильный итог; merge и dedup здесь не исправлялись. Realtime инъецируется в существующую Flutter Feed подписку; web Poll realtime отсутствует и не объявлен проверенным. G0 остаётся закрытым.

**Готово:** любой сценарий запускается повторно с фиксированными данными; normal/error/retry и page dedup проверены. **AC:** поддерживает AC-02–AC-15.

### M03. Контракт свежести Poll и merge

**Зависимости:** M01, M02. **Результат:** проверяемое решение до изменения клиентов.

**Файлы:** создать `docs/motion-poll-state-contract.md`; исследовать shared `Poll.updatedAt`, транзакции vote/like, list/search DTO и realtime payload.

**Интерфейсы:** контракт определяет группы `votes` (total + option counts), `likes`, `comments`, viewer-specific поля, порядок версий, deletion и session epoch. Каждая группа имеет правило принятия HTTP/mutation/realtime; точные wire-поля фиксируются здесь до M04–M06.

- [x] Проверить, действительно ли `updatedAt` изменяется атомарно при всех связанных операциях и попадает во все DTO. Само наличие поля не является доказательством freshness.
- [x] Построить таблицу принятия свежих, старых, равных и неизвестных revisions; broadcast никогда не заменяет персональное состояние другого viewer.
- [x] Выбрать минимальный корректный вариант: существующие доказанные версии либо совместимое расширение ревизий/DTO. Если выбран reconciliation fallback, доказать, что параллельные vote/like сохраняются и старый refetch не применяется.
- [x] Зафиксировать сигнатуры reducer/store для M05/M06, перечень wire changes, legacy behavior и exact contract assertions для reorder/duplicate/session/deletion.
- [x] Проверить таблицу на M02 сценариях. Решение «нужен backend» переводит M04 в исполнение; решение «не нужен» включает воспроизводимые доказательства.

**Выполнено 3 октября 2026 года:** [контракт M03](../../motion-poll-state-contract.md), [проверка решения](../../motion-scroll-loading-evidence/m03-verification.txt). `updatedAt` обновляется SQL trigger в транзакциях counters, но не является строгой revision; клиентские модели его не сохраняют, search viewer fields — заглушки, broadcast сохраняет чужой `viewerHasLiked`. Выбраны `stateRevisions: {votes, likes, comments}` (decimal strings), coherent read snapshot, отдельные viewer watermarks, session epoch и terminal tombstone. M04 обязательна, пока не выполнена. Decision model на неизменённых данных M02: 23/23; Node fixture/server: 10/10. Это проверка технического решения, не production merge или DB integration; исходные M05/M06 failures остаются открытыми, G0 закрыт.

**Готово:** нет принятия snapshot только по времени доставки; downstream не выбирает собственную трактовку свежести. Это task принятия технического решения, а не разрешение оставить merge неопределённым. **AC:** AC-03.

### M04. Backend/shared: выполнить необходимые изменения контракта

**Зависимости:** M03. **Условие:** только если M03 подтвердил необходимость. **Результат:** HTTP/realtime несут доказуемую актуальность.

**Файлы:** указанные backend/shared точки из карты; при необходимости новая migration. Tests: `polls.repository.test.ts`, `polls.integration.test.ts`, `polls.routes.test.ts`, `search.repository.test.ts`, `realtime.hub.test.ts`.

- [x] Добавить contract tests M03: версии изменяются атомарно с counters, idempotent no-op не искажает состояние, rollback не оставляет новую версию с прежними данными.
- [x] Выполнить минимальное совместимое расширение DTO/SQL; включить list, detail, profile/search и существующие mutation/realtime paths, а не только vote response.
- [x] Проверить older-client compatibility, viewer isolation и отсутствие публикации до commit; не создавать новые realtime-каналы.
- [x] На отдельной тестовой БД выполнить API suite и `npm run api:typecheck`; skipped integration не считается пройденным контрактом.
- [x] Обновить M03 exact wire contract, сохранить отдельный commit. Если задача не нужна, приложить обоснование без migration/code change.

**Результат M04, 9 октября 2026:** миграции `001–027` применены к отдельной БД `yaskapp_m04_test`. Фокусный integration test переполнения revision подтвердил rollback vote row и counters; tests подтверждают revision на реальных vote/comment/like paths, отсутствие increment при duplicate/no-op, отдельные viewer fields для authenticated search и отсутствие viewer fields в realtime. `npm run api:typecheck` завершился успешно; API suite: 159 passed / 1 failed / 0 skipped. Единственный fail — известный baseline logout-token revocation assertion из `auth.cookie.integration.test.ts`, зарегистрированный в плане M27 и оставленный вне M04 scope. Подробности и окружение: [M04 verification](../../motion-scroll-loading-evidence/m04-verification.md). Отдельный commit: `M04: verify poll state revisions on test database`.

**Готово:** все источники, нужные M05/M06, соблюдают одну модель свежести. **AC:** AC-03, AC-15.

### M05. Web: безопасный merge и per-poll pending

**Зависимости:** M03, решение M04. **Результат:** reactions не откатывают независимые поля.

**Файлы:** создать `poll-state.ts`/test; изменить `usePollMutations.ts`/test, `api/models.ts`, `PollCard.tsx`, Feed/PollDetail и существующие потребители cache.

**Интерфейсы:** `usePollMutations()` сохраняет `vote`, `cancelVote`, `toggleLike`, `deletePoll`; добавляет `isVoting(pollId: string): boolean`, `isLiking(pollId: string): boolean`. Cache ingress применяет merge M03 вместо безусловной замены Poll.

- [x] Добавить failing tests: оба response orders, duplicate, stale refetch, 10 like/vote taps → один запрос; poll B доступен пока poll A pending.
- [x] Реализовать per-poll/action pending. Vote/cancel одного опроса взаимно исключаются; like и vote могут идти параллельно.
- [x] Подключить merge ко всем загруженным представлениям Poll, включая search data с nested result shape, detail и user-polls. Не превращать неизвестный cache shape в `Poll[]`.
- [x] Проверить отказ, closed poll, invalid option и existing optimistic behavior: rollback только своих полей, без новой optimistic системы.
- [x] Запустить `usePollMutations.test.tsx`, `poll-state.test.ts` и затронутые page tests; typecheck проходит. Сохранить отдельный commit.

**Выполнено 3 октября 2026 года:** `poll-state.ts` сравнивает независимые BIGINT revisions, сохраняет viewer presence/watermarks отдельно, объединяет loaded Poll во feed/detail/profile/search caches, отсекает response после смены session и legacy refetch, начатый до mutation. Pending vote/cancel и like изолированы по Poll; duplicate taps блокируются, соседний Poll остаётся доступен. Regression tests подтвердили оба порядка ответа, stale refetch, duplicate, nested search, равные/большие revisions, отказы закрытого опроса/неверного варианта и session epoch. Full web suite 136/136; typecheck, production build и lint изменённых файлов проходят. Полный lint сообщает 2 прежних warnings в `CommentThread.tsx` и `notification-store.tsx`. G0/M04 backend integration evidence этим не закрываются.

**Готово:** новый like переживает старый vote snapshot, и наоборот; pending не блокирует всю ленту. **AC:** AC-02, AC-03.

### M06. Flutter: общий Poll state и per-poll pending

**Зависимости:** M03, решение M04. **Результат:** согласованные Poll на уже загруженных экранах.

**Файлы:** создать `poll_state_store.dart`/test; изменить `poll_summary.dart`, app/session injection и polling screens/API/realtime integration.

**Интерфейсы:** session-scoped `PollStateStore` предоставляет `PollSummary? pollById(String id)`, `bool isVoting(String id)`, `bool isLiking(String id)`, `void clear()`. Ingress и operation completion следуют сигнатурам M03; store не создаёт собственное WebSocket-соединение.

- [x] Добавить тесты M05 для Dart store и Flutter widget integration; исходный screen-local replace не считается достаточным.
- [x] Реализовать merge и дедуп по ID, pending vote/cancel и like отдельно; inject одну session-owned instance в существующие поверхности.
- [x] Обновить Feed, subscriptions, profile/public profile, search и poll comments там, где они показывают тот же Poll. Сохранить доступные сейчас действия.
- [x] Сохранить viewer fields при broadcast; проверить totals/options, zero votes, closed/deleted poll и response errors.
- [x] Выполнить store + affected widget tests и analyze; сохранить отдельный commit.

**Готово:** возврат между уже загруженными экранами не показывает старое состояние реакций. **AC:** AC-02, AC-03.

### M07. Web: deadlines, retry и session lifecycle

**Зависимости:** M05. **Файлы:** `api/client.ts`/test, API query callers, session provider, existing realtime/visibility integration.

- [x] Проверить `read_timeout_then_retry_ignores_old_response`: first request достигает 10 с, Retry succeeds, first response не заменяет second; logout/relogin не применяет старый ответ.
- [x] Ввести read deadline 10 с с корректной отменой/cleanup. Mutation deadlines не менять автоматически; неоднозначный mutation result сверять HTTP.
- [x] Защитить query/filter/session epoch; освободить pending после failure и не запускать infinite retry.
- [x] Подключить reconciliation затронутых Poll на foreground/reconnect там, где транспорт уже существует; notification transport не превращать в новый Poll канал.
- [x] Выполнить `client.test.ts`, session/mutation/query tests; typecheck; сохранить commit.

**Выполнено 5 октября 2026 года:** [M07 verification](../../motion-scroll-loading-evidence/m07-verification.md), [полный web-suite](../../motion-scroll-loading-evidence/m07-web-tests.txt): 159/159; typecheck и lint проходят. RED→GREEN подтверждён для deadline/cancellation, session/search races, lifecycle HTTP reconciliation и ambiguous writes. Самостоятельный review; browser profiling и последующие scroll/layout проверки не измерены. G0 остаётся закрытым.

**Готово:** нет бесконечного initial loading, late-response overwrite и cross-user update. **AC:** AC-03, AC-08, AC-13.

### M08. Flutter: deadlines, retry и lifecycle

**Зависимости:** M06. **Файлы:** polls/search/profile/notifications API clients и tests, `realtime_session.dart`, store и affected screens.

- [x] Добавить Flutter equivalents M07, включая disposed screen и смену query во время read.
- [x] Унифицировать read deadline 10 с в охвате, игнорировать устаревшую completion по session/query epoch; `.timeout()` само по себе не отменяет late state application.
- [x] Сверять неоднозначную mutation и затронутые Poll при foreground/существующем reconnect; cleanup subscriptions сохраняет одного владельца.
- [x] Проверить Retry после offline/error, finally cleanup pending и отсутствие вызова `setState` после dispose.
- [x] Выполнить API/store/lifecycle/widget tests и analyze; сохранить commit.

**Выполнено 5 октября 2026 года:** общий abortable read scope задаёт 10 секунд для Polls/Search/Profiles/Notifications и закрывает активные чтения вместе с клиентом. Устаревшие Poll responses ограничены сохранённым session epoch, результаты Search — request identity. Неоднозначные Poll actions и изменение comments запускают существующую HTTP-сверку; foreground и realtime ready обновляют уже загруженные Poll. [Проверка M08](../../motion-scroll-loading-evidence/m08-verification.md): целевые API/store/lifecycle suites 62/62; изменённые Dart файлы анализируются без diagnostics. Полный suite: 194 passed, 15 прежних failures и 1 skipped; тот же набор из 15 failures воспроизведён на исходном commit. Browser/device profiling и AC-12 не измерялись.

**Готово:** timeout завершает loading, старые ответы не возвращают состояние ушедшего экрана/пользователя. **AC:** AC-03, AC-08, AC-13.

### M09. Web: geometry карточки

**Зависимости:** M05. **Файлы:** `PollCard.tsx`/test, `Avatar.tsx`/test, `global.css`/test, font loading в `index.html` при необходимости.

- [x] Добавить tests для media loading/error/retry, 9→10/99→100/999→1000 и обратных переходов, pending slot и text scale 200%.
- [x] Резервировать media 16:9 и одинаковый fallback; сохранять размеры аватара, действий и results area, в том числе до ответа сети.
- [x] Зафиксировать формат чисел/ширину slots до G0, включая большие значения; проверить проценты 0/100 и неизменный порядок вариантов.
- [x] Проверить поздние fonts и длинные варианты в реальном browser; geometry assertions: `abs(anchorAfter-anchorBefore) <= 2`, без overflow. JSDOM не является измерением layout.
- [x] Выполнить component/style tests, typecheck и browser evidence; сохранить commit.

**Выполнено 5 октября 2026 года:** карточка резервирует медиа 16:9, avatar fallback не меняет размер, pending слот и табличные компактные счётчики сохраняют геометрию; длинные варианты переходят на отдельную строку при узком viewport. Браузерный цикл счётчиков и pending дал 0 px сдвига якоря; при 200% текста в viewport 390×844 горизонтального overflow нет. Component/style tests 38/38, полный web suite 177/177, typecheck и changed-file lint проходят. [Проверка M09](../../motion-scroll-loading-evidence/m09-verification.md) содержит метрики и ограничения.

**Готово:** T02 media сдвиг не воспроизводится; счётчики и pending не двигают соседей. **AC:** AC-04.

### M10. Flutter: geometry карточки

**Зависимости:** M06. **Файлы:** `poll_card.dart`, `user_avatar.dart`, `poll_card_layout_test.dart`, `poll_card_report_test.dart`.

- [x] Widget tests измеряют `tester.getRect` для карточки и действий до/после media/pending/count transitions; tolerance 2 logical px.
- [x] Сохранить существующий media AspectRatio/fallback, стабилизировать slots счётчиков и действий; не ломать compact card variant.
- [x] Проверить длинные тексты, 0/100%, разрядность, selected/vote cancel и text scale 200% на узком экране. После первого физического 200% прогона исправлены composer reflow, перенос action metrics, Search heading wrap и accessible labels; повторная проверка Samsung прошла. См. [M17 Android evidence](../../motion-scroll-loading-evidence/m17-android-checks.md).
- [x] При необходимости split presentation-карточки по ответственности без изменения бизнес-правил. Split не потребовался.
- [x] Выполнить layout/report/affected screen tests и analyze; сохранить commit.

**Выполнено 7 октября 2026 года:** pending slots и счётчики сохраняют геометрию; composer перестраивается при крупном масштабе, metrics переносятся по фактической ширине, Search headings переносятся; avatar и center create action имеют доступные имена. Targeted PollCard, Feed, Search и navigation regressions прошли; физический Samsung 200% и TalkBack hierarchy подтверждают исправление clipping и безымянных элементов. Широкий Flutter suite остаётся красным на 13 прежних auth/profile/search harness/UI/lifecycle failures. См. [M10 verification](../../motion-scroll-loading-evidence/m10-verification.md) и [M17 Android follow-up](../../motion-scroll-loading-evidence/m17-android-checks.md).

**Готово:** размеры конкретной карточки стабильны при реакции и pending во всех используемых вариантах. **AC:** AC-04.

### M11. Web: общий scroll context

**Зависимости:** M07, M09. **Файлы:** новые `core/scroll/list-scroll-state.ts`/test, `useListScrollState.ts`/test; router integration.

**Интерфейсы:** `ListContext = { userId: string | null; route: string; list: string; query: string; filter: string; sort: string }`; `ListAnchor = { id: string; top: number }`; storage в памяти имеет `capture(context, anchor)`, `read(context)`, `clearForUser(userId)`.

- [x] Unit tests для контекстов, logout cleanup, append, удалённого anchor, удаления нескольких элементов и fallback next/previous.
- [x] Реализовать сохранение ID + координаты, immediate restore без smooth-scroll, компенсацию удаления и clamp только у границ списка.
- [x] Определить единственного владельца restore: browser native restoration либо custom path по route; они не выполняют конкурирующие коррекции.
- [x] Учесть viewport resize и приоритет explicit target/new-items; actual 2 px проверяется browser integration в M13.
- [x] Выполнить scroll/hook/router tests, typecheck; сохранить commit.

**Готово:** одинаковый контекст восстанавливается; новый query или пользователь не получает чужой anchor. **AC:** AC-05–AC-07.

### M12. Flutter: общий scroll context

**Зависимости:** M08, M10. **Файлы:** `list_scroll_state.dart`/test; screen scroll/key ownership.

**Интерфейсы:** `ListScrollContext` содержит те же смысловые поля M11; `ListAnchor` содержит `String id`, `double top`; memory store предоставляет `capture`, `read`, `clearForUser`. Controller принадлежит экрану и dispose выполняется один раз.

- [x] Unit/widget tests для restore, context switch, удалённого anchor и последовательного удаления нескольких элементов.
- [x] Реализовать anchor correction после layout и сохранение загруженных страниц отдельно от controller; PageStorage offset сам по себе не заменяет ID-anchor.
- [x] Добавить стабильные ValueKey на Poll/option/item IDs; список не меняет identity из-за счётчика или индекса.
- [x] Проверить clamp, viewport/keyboard и explicit comment target; не запускать новое animated scroll для restore.
- [x] Выполнить scroll tests и analyze; сохранить commit.

**Выполнено 6 октября 2026 года:** [результаты и ограничения](../../motion-scroll-loading-evidence/m12-verification.md); scroll helper/PollCard focused analyze чистый. В полном Flutter suite 212 passed, 14 известных baseline failures, 1 skipped; scroll-state/PollCard/Feed tests 35/35 passed.

**Готово:** primitive пригоден для Sliver/List поверхностей без нового layout animation. **AC:** AC-05–AC-07.

### M13. Web: интеграция scroll на поверхностях

**Зависимости:** M11. **Файлы:** FeedPage, SearchPage, PublicProfilePage, PollDetailPage, CommentList/CommentThread, `comment-scroll.ts`, NotificationsPage/store и tests.

  - [x] Подключить M11 к реальному feed, search, public profile, comments/replies и notifications list; search query/filter/sort и notification filter сохраняются в URL, кэш остаётся в query cache.
  - [x] Проверить возврат list → detail после сохранения загруженного списка: focus и anchor восстанавливаются; целевая browser-позиция совпала с точностью 0 CSS px.
  - [x] Refresh сохраняет cached content; append deduplication и порядок после mutations остаются под существующим query/cache поведением.
  - [x] Для уже существующих realtime arrivals вне верха inbox используются pending IDs и доступная кнопка «Новые уведомления»; при ≤24 px arrivals добавляются автоматически без нового transport.
  - [x] Покрыть уведомления, unread URL filter, deletion fallback и приоритет явной цели комментария тестами; browser smoke подтвердил restoration ≤2 CSS px. Результаты и ограничения сохранены в evidence.

  **Выполнено 6 октября 2026 года:** [результаты и ограничения M13](../../motion-scroll-loading-evidence/m13-verification.md). Full web suite 195/195, typecheck и lint прошли. Создан task commit `feat(web): integrate list scroll restoration`.

**Готово:** все строки web-матрицы M01 подтверждены, отсутствующая web pagination не создана. **AC:** AC-05–AC-07.

### M14. Flutter: интеграция scroll на поверхностях

**Зависимости:** M12. **Файлы:** FeedScreen, SearchScreen, profile/public profile, SubscriptionsScreen, PollCommentsScreen, NotificationsScreen и соответствующие widget tests.

- [x] Подключить anchor/context к существующим List/Sliver containers; сохранить pages и параметры поиска при возврате.
- [x] Tests: refresh/append/deletion above anchor и deleted anchor; после load-more → дочерний экран → back прежние ID остаются, смещение ≤2 logical px.
- [x] Проверить header/group changes notifications и unread filter без новых read-side effects; существующие arrivals вне начала буферизуются.
- [x] Проверить composer/keyboard show-hide, expanded replies и target-comment переход; нет неожиданного reset к началу.
- [x] Выполнить affected widget/navigation tests и analyze; сохранить commit/evidence.
- [x] Device smoke пройден 9 октября на Samsung SM-A325F: Feed → Comments → replies, keyboard show/hide → Back; bounds видимого Feed элемента до/после совпали (`0 physical/logical px`). См. [M14 verification](../../motion-scroll-loading-evidence/m14-verification.md).

**Готово:** вся Flutter-матрица имеет пройденные scroll сценарии и явные исключения viewport. **AC:** AC-05–AC-07.

**M14 закрыта 9 октября 2026 года:** повторные Flutter suites — 109 passed/1 skipped; физический Android smoke на Samsung SM-A325F прошёл с возвратом к точным bounds. Известные lint/info diagnostics совпадают с M17 baseline и записаны в evidence.

### M15. Web: static skeleton/loading

**Зависимости:** M07, M09, M13. **Файлы:** `ContentSkeleton.tsx`/test, AsyncState/styles, страницы и существующий notification skeleton.

**Интерфейс:** `ContentSkeleton({ kind: 'poll' | 'user' | 'comment' | 'notification', rows: number })`; delay принадлежит загрузке, а не каждой строке.

- [x] Fake-clock tests: pending 149 мс — декоративный skeleton ещё скрыт, область зарезервирована; 150 мс — показан; ready — данные сразу; cached refetch — skeleton не появляется.
- [x] Реализовать статические templates, единый status/aria-busy и скрытые decorative части; никакого shimmer/crossfade на этом этапе.
- [x] Подключить initial/refresh/load-more/pending/empty/error/retry/media матрицу на всех web-поверхностях M01; локальная ошибка не заменяет существующий список.
- [x] Keyboard/screen-reader semantics check: focus не теряется, один status на область, Retry доступен после 10 с timeout. Проверено клавиатурой и browser accessibility tree; spoken screen-reader output отдельно не измерен.
- [x] Выполнить skeleton и affected page tests, browser geometry и typecheck; сохранить commit. См. [M15 verification](../../motion-scroll-loading-evidence/m15-verification.md).

**Выполнено 6 октября 2026 года; проверено и закрыто 9 октября 2026 года:** web suite 238/238, typecheck, lint и production build прошли. Browser screenshot comparison подтвердил сохранение видимой позиции при переходе skeleton→данные; Tab/Enter reaches Retry after timeout, browser accessibility tree показывает один status, focus handoff сохраняется на `main-content`. Spoken output реальным screen reader не измерен. См. [M15 verification](../../motion-scroll-loading-evidence/m15-verification.md).

**Готово:** все 9 строк FR-06 покрыты, placeholder transition не сбрасывает scroll. **AC:** AC-08, статическая часть AC-11.

### M16. Flutter: static skeleton/loading

**Зависимости:** M08, M10, M14. **Файлы:** `content_skeleton.dart`/test, screens, существующий notification loading.

**Интерфейс:** `ContentSkeleton(kind: ContentSkeletonKind, rows: int)`; enum содержит `poll`, `user`, `comment`, `notification`.

- [x] Widget-clock tests для 149/150 мс, immediate-ready, cached-refetch и сохранённого списка после refresh/load-more error.
- [x] Реализовать шаблоны в используемых List/Sliver layouts, одним semantics loading label; shimmer/entry отсутствуют.
- [x] Подключить FR-06 на всех Flutter-поверхностях M01; минимальная длительность skeleton не вводится.
- [x] Проверить увеличенный текст, Retry и screen reader semantics; media placeholder сохраняет слот из M10.
- [x] Выполнить skeleton/affected widget tests и analyze; сохранить commit. См. [M16 verification](../../motion-scroll-loading-evidence/m16-verification.md). Полный analyze сообщает существующие диагностики; screen reader semantics проверены в widget tests, TalkBack/VoiceOver smoke не измерен.

**Готово:** загрузка не заменяет доступные данные и не создаёт overflow или новый scroll reset. **AC:** AC-08, статическая часть AC-11.

### M17. Regression и baseline стабилизированной версии

**Зависимости:** M02, M05–M16. **Файлы:** обновить audit; подготовить evidence для `docs/motion-g0-report.md`; необходимые regression tests остаются в владеющих задачах.

- [x] Запустить все критические races/errors/scroll/loading сценарии обеих платформ; найденный строгим M14 тестом page-dedup failure исправлен в Search pagination, strict M06/M14 assertions повторены (6/6 и 1/1). Остальные full-suite auth/profile/search test-harness/UI mismatches классифицированы как прежние и записаны в аудите.
- [x] Выполнить целевые suites, Flutter analyze, web lint/typecheck/build. Финальные прогоны 9 октября: Flutter 265 passed, 1 skipped; Web 240 passed; web typecheck/lint/build passed; full Flutter analyze exit 1 с 12 diagnostics. Логи и классификация: [M17 verification](../../motion-scroll-loading-evidence/m17-verification.md).
- [x] Провести static keyboard/screen-reader/text-scale проверки и 20 навигационных циклов для исходного lifecycle baseline. Android 200% повторно прошёл после M10 repair; TalkBack hierarchy называет author avatar и create tab. Spoken output отдельно не верифицирован на слух. См. [Android evidence](../../motion-scroll-loading-evidence/m17-android-checks.md).
- [x] На Android/web матрице снять 3×30 с traces стабилизированной версии без нового motion; отдельно initial load. Сбор и анализ завершены: headless Chromium и физический Chrome, Flutter scroll/reaction/loading и initial Feed load на Samsung A32. Revision-aware T02 fixture; актуальные Android FrameTiming результаты превышают абсолютный AC-12 порог в указанных runs. Physical Chrome 155 на display 1680×1050/60 Hz: 3×30 с, active source `MISSED` 0–0.0555%. Android motion-off comparison отсутствует, поэтому AC-12 не пройден; см. [M17 verification](../../motion-scroll-loading-evidence/m17-verification.md), [current Android AC-12 profile](../../motion-scroll-loading-evidence/android-ac12-2026-10-09/README.md), [Flutter device profile](../../motion-scroll-loading-evidence/m17-flutter-android-profile.md), [physical Chrome profile](../../motion-scroll-loading-evidence/m17-verification.md#physical-chrome--monitor-profile).
- [x] Проверить доступность всех обязательных доказательств Android/web. Web, Android Flutter traces и physical Chrome/display profile приложены; startup trace снят. Android AC-12 frame threshold измерен и превышен в scroll/reaction runs; motion-off comparison не выполнено. Текущие results и raw logs приложены; см. актуальный Android profile.

**Результат 9 октября 2026 года:** [итоговый отчёт M17](../../motion-scroll-loading-evidence/m17-verification.md). Финальные suites: Flutter 265 passed/1 skipped; Web 240 passed; web typecheck/lint/production build прошли; full Flutter analyze оставляет 12 diagnostics. На revision-aware T02 fixture сняты scroll и reaction FrameTiming runs на Samsung A32 при 60/90 Hz; Android AC-12 абсолютный порог нарушен, а motion-off comparison отсутствует. Текущие измерения и raw records: [Android AC-12 profile](../../motion-scroll-loading-evidence/android-ac12-2026-10-09/README.md). Web/Chrome, navigation, Android text scale/accessibility hierarchy, fixture repair и M04 DB evidence сохранены в связанном отчёте. Сбор M17 evidence завершён; G0 остаётся NOT PASSED.

**Готово:** correctness/layout/loading подтверждены и есть фактический baseline AC-12. **AC:** AC-02–AC-08, AC-11–AC-13, AC-15.

### M18. Общий допуск G0

**Зависимости:** M17. **Файлы:** завершить `docs/motion-g0-report.md`.

- [x] Свести 6 условий раздела 5 PRD с evidence links, build, устройствами и результатами отдельно для Flutter/web.
- [x] Проверить contract implementation и документы: M04 DB/API integration evidence зафиксирована 9 октября; отдельная БД, M04 assertions и typecheck прошли, один unrelated auth test остаётся failing. Подробнее: [M04 verification](../../motion-scroll-loading-evidence/m04-verification.md) и [M18 G0 report](../../motion-g0-report.md).
- [x] Проверить baseline traces и зафиксировать отсутствие новых entry/count/bar/like/shimmer до допуска; Android AC-12 измерен и превышает абсолютный порог, motion-off comparison отсутствует.
- [x] Записать, что ответственный Engineering/QA не указан; `G0: NOT PASSED` из-за открытых условий, список приведён в отчёте.
- [x] Сохранить отчёт; M19–M25 не разблокированы, поскольку `G0: passed` не достигнут для Android и web.

**Актуализация 9 октября 2026 года:** [M18 G0](../../motion-g0-report.md) остаётся `NOT PASSED`. M04 DB evidence приложена; Android AC-12 не проходит абсолютный threshold, Flutter anchor/geometry и build/owner matrix требуют закрытия. iOS исключён из текущего scope и не является условием gate. Завершённый сбор M17 evidence не отмечает G0 как пройденный и не разблокирует этап B.

**Готово:** есть воспроизводимый допуск, а не решение на основании внешнего впечатления. **AC:** AC-01, AC-16.

## 4. Этап B — motion после G0

### M19. Web: tokens, flags и reduced motion

**Зависимости:** M18 passed. **Файлы:** новые `motion-settings.tsx`/test, `motion-tokens.ts`, global styles.

**Решение по последовательности:** по явному запросу пользователя M19 выполнена до M18; G0 остаётся открытым.

**Интерфейсы:** `MotionFlags = { reactionsMotion: boolean; entryMotion: boolean }`; `useMotionSettings()` возвращает flags и `reduceMotion: boolean`; начальные flags false. Константы tokens соответствуют Global Constraints.

- [x] Tests для flags off/on, `matchMedia` live change, document hidden/unmount и немедленного reduced-motion update.
- [x] Реализовать context/config injection без domain effects; flags задаются приложением, не новыми пользовательскими настройками.
- [x] При reduced motion отключить explicit smooth-scroll и завершить активные эффекты в актуальной цели.
- [x] Проверить listener cleanup и неизменные network calls/geometry при переключении flags.
- [x] Выполнить settings/style tests и typecheck; сохранить commit. **AC:** AC-11, AC-14.

### M20. Flutter: tokens, flags и reduced motion

**Зависимости:** M18 passed. **Файлы:** новые `motion_settings.dart`, `motion_tokens.dart`, `motion_settings_test.dart`, app injection.

**Интерфейсы:** `MotionSettings` содержит `reactionsMotion`, `entryMotion`, effective `reduceMotion`; `MotionSettings.of(BuildContext)`; системный disableAnimations имеет приоритет над flags.

- [x] Widget tests для live MediaQuery disableAnimations, flags off/on, lifecycle pause/resume и переключения в середине эффекта.
- [x] Реализовать session-independent presentation settings и tokens PRD; начальные flags false.
- [x] Обеспечить немедленное завершение effects и отсутствие programmatic smooth-scroll при reduceMotion.
- [x] Проверить, что change settings не меняет store/mutations/layout; controllers принадлежат presentation.
- [x] Выполнить settings tests и analyze; сохранить commit. **AC:** AC-11, AC-14.

**Результат 8 октября 2026 года:** добавлены session-independent app flags (по умолчанию off), live system `disableAnimations`, lifecycle suspension и Flutter motion tokens. Targeted test написан, но `flutter test` и `flutter analyze` не завершены: Flutter CLI зависает без вывода, а Dart formatter падает до анализа с `Platform.resolvedExecutable` null. Поэтому verification/commit остаются открытыми; G0 не изменён.

**Завершение 9 октября 2026 года:** `MotionSettingsScope` подключён на уровне приложения; build-time flags с default-off проходят отдельные reactions-only, entry-only и both-on проверки. Reduced motion немедленно завершает count, reaction и entry effects; scroll-to-target использует нулевую длительность, а переход к началу notifications делает `jumpTo`. Settings scope не импортирует и не вызывает store/mutation APIs; animation controllers принадлежат presentation widgets. `motion_settings_test.dart` и `motion_flags_test.dart`: 6/6; полный Flutter suite: 265 passed/1 skipped; changed-file analyze: no issues. Package-wide analyze по-прежнему сообщает 11 diagnostics в auth/home/polls/profile/reports и несвязанных tests. Полная матрица и ссылки: [M20 Flutter verification](../../motion-scroll-loading-evidence/m20-flutter-verification.md). AC-12 и G0 остаются отдельными незакрытыми gates.

### M21. Web: плавные голоса и лайки

**Зависимости:** M19. **Файлы:** `AnimatedCount.tsx`/test, PollCard/styles, poll mutation integration tests.

**Интерфейс:** `AnimatedCount({ value: number, enabled: boolean, durationMs?: number })`; default duration 180; semantic value всегда target. Bars и like state находятся в PollCard, data merge из M05 неизменен.

- [x] Tests: первый mount сразу final value; 9→10/99→100/999→1000 и уменьшение; новая цель до завершения; reduced motion mid-flight; old text decorative.
- [x] Реализовать count/percent crossfade 180 мс, bar 240 мс, like/selected 160 мс; local-like scale ≤1.08, без broadcast pulse и перебора чисел.
- [x] При новом target прервать старую цель от текущего визуального состояния; не создавать очередь и дополнительных запросов.
- [x] Проверить semantics: один локальный mutation request и отсутствие нового live region для realtime; pending/focus geometry automated checks.
- [x] Выполнить browser rect check ≤2 px; сохранить commit. **AC:** AC-04, AC-09, AC-11, AC-13, AC-14. На T02 viewport 1280×720 CSS px максимальное измеренное изменение карточки/соседнего control — 1.735 CSS px; детали в `docs/motion-scroll-loading-evidence/m21-verification.md`.

### M22. Flutter: плавные голоса и лайки

**Зависимости:** M20. **Файлы:** `animated_count.dart`, `animated_count_test.dart`, `poll_card.dart`, layout/store integration tests.

**Интерфейс:** `AnimatedCount(value: int, enabled: bool, duration: Duration = 180ms)`; semantic target сразу. Bar target берётся из принятого Poll state.

- [x] Clock-based widget tests для M21 сценариев, включая cancellation при dispose/background.
- [x] Реализовать counts/percent 180 мс, bar 240 мс, like/selected 160 мс, scale ≤1.08 только local action.
- [x] При новой цели начать от текущего presentation state; проверить 0 votes и отсутствие NaN/отрицательных размеров.
- [x] Сохранить прямые callbacks/store update, неизменные actions rect и единичные semantics announcements.
- [x] Выполнить count/layout/store/affected tests и analyze; сохранить commit. **AC:** AC-04, AC-09, AC-11, AC-13, AC-14.

**Результат 9 октября 2026 года:** добавлен [`AnimatedCount`](../../../apps/mobile/lib/src/core/motion/animated_count.dart) с немедленной semantic target, прерыванием от текущего presentation value и 180 мс длительностью; проценты используют тот же срок, bars — 240 мс. Like/selected scale начинается при локальном pointer press, ограничена 1.08 и занимает 160 мс; layout rect действий и callbacks не меняются. Reduced motion, отключённый flag и background завершают эффекты немедленно. [Проверка M22](../../motion-scroll-loading-evidence/m22-flutter-verification.md): target suites 16/16, полный Flutter suite 250 passed/1 skipped, changed-file analyze clean. Full analyze оставляет 12 существующих app/test diagnostics. G0 не пройден; оба reaction effects flags off по умолчанию.

### M23. Web: появление карточек

**Зависимости:** M21. **Файлы:** `EntryMotion.tsx`/test; feed/search/profile/comment/notification lists; skeleton transition.

**Интерфейс:** `EntryMotion({ contextKey: string, itemId: string, visible: boolean, indexInBatch: number, children })`; seen-ID registry живёт выше remounted rows, очищается при смене session/контекста.

- [x] Tests: новый visible ID анимируется однажды; refetch/back/remount не повторяет; offscreen mounted ID позже появляется без entry; новая query допускает новый initial batch.
- [x] Реализовать opacity + translateY 8→0 за 200 мс с окончательным layout slot; stagger 35 мс для максимум 6 видимых items, sequence ≤400 мс.
- [x] Подключить poll/user/comment/notification cards; existing rows не исчезают при append, а действия/focus/hit testing доступны сразу.
- [x] Skeleton crossfade ≤120 мс объединить с entry в один переход; скрытый документ и reduced motion отменяют effects.
- [x] Выполнить entry/page tests и browser anchor checks; сохранить commit. **AC:** AC-05, AC-06, AC-10–AC-14. Подробности: [M23 web verification](../../motion-scroll-loading-evidence/m23-web-verification.md).

**Результат 9 октября 2026 года:** web entry registry сохраняет seen IDs между remount, сбрасывается при смене сессии, а `IntersectionObserver` запускает только видимые карточки. Исправлен StrictMode effect replay. Skeleton и entry content проходят единый crossfade до 120 мс; `entryMotion` off и reduced motion оставляют статическое поведение. Полный web suite: 236/236; typecheck, lint, production build прошли. Browser preview на 1280×720 CSS px: после входа transform завершился в identity; разброс anchor delta шести карточек 0.735 CSS px. G0 не изменён.

### M24. Flutter: появление карточек

**Зависимости:** M22. **Файлы:** `entry_motion.dart`, `entry_motion_test.dart`; существующие Sliver/List screens и skeleton transition.

**Интерфейс:** `EntryMotion(contextKey: String, itemId: String, visible: bool, indexInBatch: int, child: Widget)`; registry принадлежит контексту списка, не строке.

- [x] Widget tests повторяют M23; отдельно virtualized Sliver remount и back после двух cursor-pages поиска.
- [x] Реализовать 200 мс opacity/translation без animated size; 35 мс stagger, максимум 6 visible, до 400 мс.
- [x] Подключить existing list cards и replies, не меняя routing, read-state и pagination; pending/targets остаются интерактивными.
- [x] Проверить уменьшение motion в полёте, TickerMode/background/dispose и единый skeleton→content переход ≤120 мс.
- [x] Выполнить entry/layout/navigation tests и analyze; сохранить commit.
- [ ] Выполнить device smoke. Сейчас нет подключённого Android-устройства; Pixel 7 AVD завершается при старте, установленного system image для его ABI нет.

**Результат 9 октября 2026 года:** добавлен `EntryMotion` с list-owned seen-ID registry, проверкой viewport для lazy Sliver/List rows, 200 мс opacity/translation и stagger 35 мс только для первых шести items. Подключены Feed, Search (polls/users), profile/public profile, subscriptions, notifications, comments и replies. `ContentEntryTransition` объединяет skeleton/content в crossfade до 120 мс и немедленно переключается на статический контент при reduced motion. Widget/navigation tests: полный Flutter suite 263 passed/1 skipped; debug APK собран. `flutter analyze` сообщает 12 существующих diagnostics. Device smoke не выполнен: физических Android devices нет, Pixel 7 AVD не содержит доступного system image и завершается с ошибкой при запуске. Подробности: [M24 Flutter verification](../../motion-scroll-loading-evidence/m24-flutter-verification.md). Автоматические проверки M24 пройдены; AC-12 performance/device evidence не измерено, физический smoke остаётся непроверенным.

### M25. Решение о shimmer и необязательное добавление

**Зависимости:** M23, M24. **Файлы:** только уже созданные skeleton/settings/styles и tests; решение в release report.

- [x] По первичному profiling определить, есть ли запас AC-12; отказ от shimmer — допустимый законченный результат задачи. Профиль Samsung SM-A325F показывает превышение абсолютного порога AC-12 в Android scroll/reaction сценариях; парного shimmer-off/on сравнения нет, поэтому запас не подтверждён.
- [x] Если добавляется: использовать `entryMotion` как разрешение skeleton presentation motion, не создавать третий обязательный flag; reduced motion всегда static. **N/A:** shimmer не добавляется.
- [x] Ограничить работу видимыми skeleton, останавливать в фоне; cached data не заменять skeleton. **N/A:** продуктовый код не менялся; текущие skeleton остаются статическими.
- [x] Проверить timers/cleanup, flags off и сравнение кадров с/без shimmer на тех же fixtures. **N/A:** новых timers/effects и shimmer comparison нет; существующие flags по умолчанию выключены, ограничения сравнения записаны в отчёте.
- [x] Сохранить решение/evidence; добавленный shimmer, не проходящий budget, убрать до M26. **AC:** AC-08, AC-11–AC-14. Итог: [M25 decision and evidence](../../motion-release-verification.md).

## 5. Этап C — проверка и выпуск

### M26. Финальная проверка кадров, scroll и lifecycle

**Зависимости:** M21–M24, решение M25. **Файлы:** tests владеющих функций; создать `docs/motion-release-verification.md`, приложить traces/evidence.

- [ ] Повторить correctness/error/loading/anchor scenarios при flags off, reactions only и оба on; data/network behavior не меняется.
- [ ] Проверить keyboard/screen-reader/text scale 200%, live reduced motion, interrupt targets, restored focus, no repeated entry.
- [ ] Выполнить 20 list→detail→back циклов; сравнить listeners/controllers/timers, requests и background behavior с baseline M17.
- [ ] На той же матрице и build policy снять paired off/on 3×30 с по PRD, включая first load; каждый run ≤1% late frames и delta ≤0,5 п.п. Реальную adaptive frequency учитывать по trace.
- [x] Запустить целевые suites и checks; failures вернуть в владеющие задачи, после изменения перепроверить затронутые scenarios. Записать AC-01–AC-16 с фактическим status/evidence.

**Готово:** нет непроверенных обязательных целей и скрытых failures в scope; motion не ухудшает scroll или data correctness. **AC:** AC-09–AC-16.

**Результат 9 октября 2026 года — частично выполнена, M26 остаётся открытой.** Web suite 236/236; web typecheck, lint и production build прошли. Flutter suite: 263 passed/1 skipped; целевые motion suites: 24/24. Фокусный Flutter analyze обнаружил одну info-диагностику `prefer_const_constructors` в `test/motion_settings_test.dart:23`. Android ADB видит Samsung SM-A325F; текущая app entry point создаёт `const YaskappApp()` и не передаёт включённые rollout flags, поэтому live-профиль с reactions-only/both-on конфигурациями в этой задаче не запускался. 20 циклов с учётом runtime ресурсов и paired AC-12 off/on 3×30 s не измерены. Android AC-12 baseline 8 октября уже нарушал абсолютный порог; сравнение с M21–M24 сборками отсутствует. См. [M26 evidence](../../motion-scroll-loading-evidence/m26-automated-verification.md). M26 не закрывает AC-12 или G0; M17 evidence collection завершена.

### M27. Подготовка выпуска и отключения motion

**Зависимости:** M26. **Файлы:** release verification и configuration flags из M19/M20; обновить app README только для реальных launch/config points.

- [x] Зафиксировать tested commit/build, platform matrix, traces, closed blockers и решение об optional shimmer.
- [x] Проверить сценарий отключения reactions/entry: статические реакции, loading и scroll продолжают работать без изменения backend/state.
- [x] Подготовить порядок выпуска: стабилизированная версия flags off → reactions на проверенных сборках → entry; для каждой ступени указать smoke и условия возврата flags off.
- [x] Определить владельца включения и способ доставки config отдельно для Flutter/web; не обещать remote kill switch, если инфраструктуры нет. Build-time flags требуют новой сборки — это явно записывается.
- [ ] Завершить Definition of Done по PRD. Публикация/deploy не запускается автоматически этой задачей планирования; перед реальным выпуском применяется действующая авторизация проекта.

**Готово:** результат допускает rollout только после прохождения M26/G0; инструкции отключения и фактическое состояние выпуска задокументированы. **AC:** AC-14–AC-16.

**Результат 9 октября 2026 года — подготовка выполнена, выпуск заблокирован.** Flutter production entry point reads `YASKAPP_REACTIONS_MOTION` and `YASKAPP_ENTRY_MOTION` at build time; both default to false. Web reads `VITE_REACTIONS_MOTION` and `VITE_ENTRY_MOTION`, also defaulting to false. App READMEs now include enable/rollback commands. `docs/motion-release-verification.md` records the release sequence, smoke checks, configuration owners and current evidence. Automated checks cover the static/default paths on both clients; see [M27 verification](../../motion-scroll-loading-evidence/m27-automated-verification.md). M26 remains partial, G0 is NOT PASSED, Android paired AC-12 traces and the 20-cycle lifecycle comparison are unmeasured, and physical accessibility smoke is outstanding. Therefore AC-14–AC-16 and the PRD Definition of Done are not complete; do not start rollout. No deploy was performed.

## 6. Команды проверки для исполнителя

Команды ниже — будущие проверки, в рамках подготовки плана они не запускались. Web/API команды выполняются из корня, Flutter — из `apps/mobile`. Для новых test files сначала используется точечный test path задачи.

```powershell
# Mock / fixtures
node --test scripts/t02-motion-scroll-baseline-server.test.mjs

# Web: точечные примеры; затем suite и checks
npm run test -w @yaskapp/web -- --run src/features/polls/usePollMutations.test.tsx src/components/PollCard.test.tsx
npm run test -w @yaskapp/web -- --run
npm run typecheck -w @yaskapp/web
npm run lint -w @yaskapp/web
npm run build -w @yaskapp/web

# API: только если M04 нужен, с отдельной тестовой БД
npm run api:typecheck
npm run api:test

# Flutter, cwd = apps/mobile
flutter test --no-pub test/feed_screen_test.dart test/search_screen_test.dart
flutter test --no-pub
flutter analyze
```

Ожидаемый автоматический результат: exit code 0, пройденные relevant assertions, отсутствие новых diagnostics. Existing unrelated failures отражаются отдельно, а relevant failures закрывают G0. Browser rect, device keyboard, screen reader и frame-time проверки требуют самостоятельного evidence; passing tests не заменяют их.

После каждой задачи проверить `git diff --check`, review только изменённых файлов и commit завершённого результата. Не staging всего checkout.

## 7. Покрытие PRD

| Требование | Владеющие задачи |
|---|---|
| FR-01: identity и pending | M05, M06, M11–M14 |
| FR-02: merge и согласованность источников | M03–M08 |
| FR-03: ошибки и границы | M05–M08, M09–M10 |
| FR-04: geometry | M09, M10 |
| FR-05: scroll/restore/exceptions | M11–M14 |
| FR-06: loading matrix | M07–M08, M15–M16, optional M25 |
| FR-07: motion tokens и переходы | M19–M24 |
| FR-08: interrupt/repeat/lifecycle | M19–M24, M26 |
| Accessibility | M15–M16, M19–M24, M26 |
| G0 / AC-01 | M17, M18 |
| AC-02 / AC-03 | M03–M08 |
| AC-04 | M09–M10, M21–M22 |
| AC-05 / AC-06 / AC-07 | M11–M14, M23–M24 |
| AC-08 | M07–M08, M15–M16 |
| AC-09 / AC-10 | M21–M24 |
| AC-11 | M15–M16, M19–M26 |
| AC-12 / AC-13 | M17, M26; lifecycle checks в M07–M08, M19–M24 |
| AC-14 | M19–M27 |
| AC-15 / AC-16 | M17–M18, M26–M27 |

## 8. Правила ведения backlog

- До старта все задачи открыты. T02 — evidence для перепроверки, а не автоматическое закрытие M01/M02/M17.
- Отмечать checkbox только после описанной проверки. Для задач с devices сохранять незавершённую часть, если устройств нет.
- M04 имеет обоснованную ветку «не требуется», M25 — «не добавлять»; это явные допустимые решения, а не пропуск обязательного поведения.
- Уточнения контрактов и фактических file paths из M03 обновляются в плане до исполнения downstream; продуктовые критерии PRD не ослабляются при уточнении.
- Каждый новый блокер записывается в владеющую задачу с воспроизводимым сценарием; motion не используется для его визуального скрытия.
