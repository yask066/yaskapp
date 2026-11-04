# Личная блокировка: план работ

[Требования, утверждённые тексты и приёмка](../../prd-user-blocking.md).

**Следующий шаг — UB-02:** зафиксировать контракты, совместимость старых клиентов,
rate limits, suppression истории, транзакции и границу push-отправки.
Продуктовые правила утверждены; сама функция не готова.

## Статус

UB-01 выполнена 29 октября 2026. UB-03 подготовлена независимо от ещё открытой
UB-02: есть fixtures и карта серверных путей, но нет performance baseline.
Остальные задачи открыты. Полный релиз включает все 32 задачи.

| Задача | Результат | Зависимости | Статус |
| --- | --- | --- | --- |
| UB-01 | Утвердить правила первого релиза | нет | Готово |
| UB-02 | Зафиксировать API, события, совместимость и порядок транзакций | UB-01 | Открыто |
| UB-03 | Подготовить fixtures, карту путей доступа и baseline | UB-01; формат fixtures согласовать с UB-02 | Готово |
| UB-04 | Добавить схему блоков, ревизий, suppression и outbox | UB-02, UB-03 | Открыто |
| UB-05 | Реализовать общую политику и согласованный порядок locks | UB-04 | Открыто |
| UB-06 | Реализовать атомарные block/unblock и снятие подписок | UB-04, UB-05 | Открыто |
| UB-07 | Добавить приватный API управления и сверки | UB-06 | Открыто |
| UB-08 | Применить блок к профилям и подпискам | UB-05, UB-06, UB-07 | Открыто |
| UB-09 | Защитить чтение опросов, голоса и лайки опросов | UB-05, UB-06, UB-07 | Открыто |
| UB-10 | Фильтровать поиск и популярные аккаунты | UB-05, UB-08, UB-09 | Открыто |
| UB-11 | Сохранить корректную пагинацию и снимки ленты | UB-09; fixtures UB-03 | Открыто |
| UB-12 | Реализовать чтение комментариев и заглушки корней | UB-02, UB-05, UB-09 | Открыто |
| UB-13 | Защитить ответы и реакции комментариев, сохранить удаление своего | UB-05, UB-09, UB-12 | Открыто |
| UB-14 | Закрыть обход через media и HTTP-кэш | UB-07, UB-09; контракт UB-02 | Открыто |
| UB-15 | Интегрировать блок с жалобами, модерацией и удалением аккаунта | UB-06, UB-08, UB-12, UB-13; схема UB-04 | Открыто |
| UB-16 | Подавлять историю и фильтровать notification inbox | UB-06, UB-09, UB-12; контракт UB-02 | Открыто |
| UB-17 | Проверять блок непосредственно при push-отправке | UB-05, UB-16 | Открыто |
| UB-18 | Фильтровать realtime по получателю и ввести приватные события | UB-07, UB-09, UB-16; контракт UB-02 | Открыто |
| UB-19 | Довести outbox до устойчивого восстановления | UB-06, UB-16, UB-18 | Открыто |
| UB-20 | Добавить Flutter-модели, API и состояние исходящих блоков | UB-02, UB-03, UB-07 | Открыто |
| UB-21 | Сделать Flutter-точки входа и экран заблокированных | UB-20, UB-08 | Открыто |
| UB-22 | Поддержать заглушки и доступные ответы во Flutter | UB-20, UB-12, UB-13 | Открыто |
| UB-23 | Синхронизировать Flutter-кэши, realtime и жизненный цикл | UB-18, UB-19, UB-20, UB-21, UB-22, UB-11, UB-16 | Открыто |
| UB-24 | Добавить web API-клиент и viewer-scoped state | UB-02, UB-03, UB-07 | Открыто |
| UB-25 | Сделать web-меню, подтверждения и список заблокированных | UB-24, UB-08 | Открыто |
| UB-26 | Поддержать заглушки и доступные ветки в web | UB-24, UB-12, UB-13 | Открыто |
| UB-27 | Синхронизировать web-кэш, вкладки, reconnect и навигацию | UB-18, UB-19, UB-24, UB-25, UB-26, UB-11, UB-14, UB-16 | Открыто |
| UB-28 | Добавить наблюдаемость и независимые controls запуска | UB-02, UB-07, UB-16, UB-17, UB-18, UB-19, UB-21, UB-25 | Открыто |
| UB-29 | Проверить конкурентные операции и отказоустойчивость | UB-08, UB-09, UB-13, UB-15, UB-16, UB-17, UB-18, UB-19, UB-28 | Открыто |
| UB-30 | Проверить запросы и задержки под нагрузкой | UB-03, UB-08, UB-09, UB-10, UB-11, UB-12, UB-14, UB-16, UB-17, UB-18, UB-19, UB-28 | Открыто |
| UB-31 | Выполнить сквозную приёмку Flutter + web + API | UB-15, UB-23, UB-27, UB-28, UB-29, UB-30 | Открыто |
| UB-32 | Подготовить и провести совместимый rollout и rollback | UB-31 | Открыто |

## Общие интерфейсы

Предлагаемые имена для UB-02; после согласования обновляются общие типы и все
потребители. Здесь перечислены будущие интерфейсы, а не уже существующий код.
| Владелец | Производимый интерфейс | Потребители |
| --- | --- | --- |
| UB-02 | `UserBlockState = { targetUserId: string; blockedByViewer: boolean; viewerVisibilityRevision: string }`; `BlockedUserItem`; `UserBlockListResponse = { items: BlockedUserItem[]; nextCursor: string \| null; viewerVisibilityRevision: string }` | UB-06/07, UB-20, UB-24 |
| UB-02 | `CommentListItem = { kind: 'comment'; comment: PollComment } \| { kind: 'unavailable'; rootId: string; availableRepliesCount: number }` для versioned/capability-выдачи | UB-12, UB-22, UB-26; старый PollComment не заменяется молча |
| UB-02 | `UserBlocksRealtimeEvent`: `user_blocks.changed` только владельцу исходящего решения; `viewer.visibility_invalidated` с одной ревизией затронутому viewer; snapshot ревизии через `GET /profiles/me/visibility` | UB-07, UB-18/19, UB-23, UB-27 |
| UB-05 | `hasEffectiveUserBlock(executor: QueryExecutor, firstUserId: string, secondUserId: string): Promise<boolean>`; `findBlockedUserIds(executor, viewerId: string, candidateIds: readonly string[]): Promise<Set<string>>` | UB-06, UB-08–UB-19 |
| UB-05 | `lockUserBlockParticipants(client: PoolClient, userIds: readonly string[]): Promise<void>`; `assertNoUserBlock(client, firstUserId: string, secondUserId: string): Promise<void>`; ошибки преобразуются в общий `not_found` | Все взаимодействия/доставки; блокировка не подменяет проверку active/deleted |
| UB-06 | `setUserBlock({ blockerId: string; blockedId: string; blocked: boolean }): Promise<UserBlockState>`; операции suppression и outbox внутри той же транзакции | UB-07; UB-16/19 читают сохранённые результаты |
| UB-07 | Маршруты из требований + приватная сверка текущей ревизии без чужих идентификаторов | Оба клиента |
| UB-20 | `UserBlocksApiClient.setBlocked(...)`, `.getState(...)`, `.listBlocked(...)`, `.getVisibilityRevision(...)`; `UserBlocksStore` с session epoch и numeric-safe revision | UB-21–UB-23 |
| UB-24 | `setUserBlocked(userId: string, blocked: boolean, signal?: AbortSignal): Promise<UserBlockState>`; `getUserBlockState`, `listBlockedUsers`, `getVisibilityRevision`; viewer-scoped provider | UB-25–UB-27 |

## Что уже есть для проверки

[Fixtures](../../../services/api/src/modules/user-blocks/user-blocks.fixtures.ts),
[их тест](../../../services/api/src/modules/user-blocks/user-blocks.fixtures.test.ts)
и [карта HTTP/media/delivery](../../user-blocking-evidence/endpoint-matrix.md).

Seed baseline — `ub03-baseline-2026-10-29`: 7 аккаунтов, взаимные подписки A/B,
7 опросов с разной видимостью, 14 вариантов, корень B и 25 ответов A/C,
3 unread-уведомления и 3 push jobs. Есть moderator, недоступный аккаунт,
административно заблокированный аккаунт и смена UUID при повторном username.

Четыре состояния блока пока описаны как сценарии: таблица `user_blocks` ещё
не создана, seeder её не заполняет. Cleanup удаляет только свои ID, блокирует
fixture-аккаунты и останавливается при обнаружении посторонней подписки.
Использовать только одноразовую тестовую БД.

Из `services/api`:

```sh
node --import tsx --test --test-reporter spec src/modules/user-blocks/user-blocks.fixtures.test.ts
```

Из корня: `npm run api:typecheck`. Эти проверки не измеряют latency и SQL query count.

На 29 октября 2026 baseline остался **UNMEASURED**: локальная PostgreSQL недоступна,
специальный runner UB-30 не создан. Имеющийся `scripts/pagination-load.mjs` использует
другой dataset и не проверяет поиск/SQL statements per request.
UB-30 сравнивает baseline и новую версию на одной конфигурации БД,
с одинаковыми данными и числом повторов, записывая p50/p95, SQL count и commit.

## Порядок работы

1. Согласовать UB-02 и проверить DTO, затем выполнить серверное ядро.
2. Закрыть каждый путь чтения, записи и доставки из карты; shared и общие repository
   менять согласованно, без параллельных вариантов контракта.
3. Довести оба клиента, затем пройти конкурентные, нагрузочные и сквозные проверки.
4. Выпустить API и workers с защитой до включения создания блоков.
   Проверить Android/iOS/web, совместимость и откат из требований.

Результат задачи проверяется целевыми тестами и typecheck/analyze.
Общие команды — в [чек-листе](../../staging-smoke-test.md).
Логи и профили сохраняются в `.tmp/` или в записи выпуска; новые документы
для каждой задачи не нужны. Закрытие карточки само по себе не разрешает rollout.
