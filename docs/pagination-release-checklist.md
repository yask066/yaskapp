# Чек-лист выпуска пагинации

**Статус на 2026-10-28:** пользователь закрыл T28 без staging. Staging, rollout и rollback smoke не запускались; выпуск остаётся NOT RELEASED.

Документ следует PRD и ADR T01. Выпускать в порядке **совместимый API → ограниченная web/Android группа → решение о расширении**. У API нет remote kill switch: клиентский rollback требует новых web и Android builds с выключенной пагинацией. Не удалять additive API, legacy decoders, миграции или snapshot cleanup при откате клиентов.

## Владельцы и решение об охвате

Перед staging заполнить имена в [release record](pagination-evidence/release-record.md):

| Роль | Ответственность |
|---|---|
| Engineering/Product Release Owner | Единственный владелец Go/No-Go и решения о расширении охвата; принимает остаточные риски T27 письменно. |
| QA Owner | Межверсионные smoke-проверки, устройства/браузеры, AC и evidence. Рекомендует расширение, не меняет охват самостоятельно. |
| API/DB Operator | Сборка API, migrations, `PAGINATION_CURSOR_SECRET`, cleanup, health и серверные метрики; держит предыдущий образ доступным. |
| Web Release Engineer | Canary/staging web build, флаг и быстрый выпуск rollback build. |
| Android Release Engineer | Закрытая тестовая группа, signed build, дистрибуция rollback build и фиксация версии. |

Имена и каналы связи обязательны до первой выкладки. Release Owner принимает решение об охвате после рекомендаций QA и API/DB Operator и фиксирует дату, evidence и явное принятие либо устранение известных отклонений.

## Gate перед staging

- [x] T04 и T13 закрыты с локальными evidence в task breakdown. T24 закрыта в commit `857e29b`: `VITE_FEED_PAGINATION` и `YASKAPP_FEED_PAGINATION` реализованы с default `false`; оба режима web build и default-off Flutter проверены локально (свидетельства — в task breakdown). Staging rollout и rollback smoke ещё не запускались.
- [ ] Release Owner и QA Owner ознакомились с остатками T27. AC-01–18, TalkBack и полный API suite не были выполнены; Android feed 100, feed 1 000 и roots 1 000 превысили frame budget; все headless web workload превысили RAF budget. T26 staging load run отменён, server performance budgets не подтверждены. См. [матрицу T27](pagination-evidence/acceptance-matrix.md).
- [ ] Принять явное Go/No-Go с указанными выше gaps; закрытие T27 по решению пользователя не является результатом PASS этих проверок.
- [ ] Заполнить staging URL, ответственного оператора и защищённую конфигурацию на самом staging host. Не копировать `.env.staging`, JWT, cursor secret, токены или пользовательские данные в git/evidence.
- [ ] Зафиксировать commit, web/Android/API build IDs и предыдущие rollback artifacts. Записать UTC timestamp начала и согласованное тестовое окно.
- [ ] Подтвердить, что `PAGINATION_CURSOR_SECRET` — отдельный от JWT случайный секрет не короче 32 байт и одинаков на всех API replicas. Секрет не записывать в release record.
- [ ] До включения новых клиентов убедиться, что staging database backup/restore policy доступна, а тестовые аккаунты и fixture data изолированы.

## 1. Совместимый API первым

- [ ] Развернуть additive API из выбранного commit, сохранив предыдущий immutable image. Сначала проверить рабочее состояние PostgreSQL, Redis и storage.
- [ ] Применить миграции до переключения API. Ожидаемые pagination migrations: `034_poll_pagination_indexes.sql` и `035_poll_feed_snapshots.sql`; записать фактический migration status и не выполнять destructive/down migration при rollback.
- [ ] Проверить `GET /health/ready`, readiness всех зависимостей и отсутствие ошибок миграции. Проверить, что `poll-feed-snapshot-cleanup` работает и запускает очистку каждые 5 минут.
- [ ] Старым web и Android builds проверить первую страницу Feed, roots и replies против нового API. Отдельно продолжить legacy unsigned replies cursor в пределах зафиксированного окна.
- [ ] Новыми кандидатами проверить legacy server response `{ items }` без `nextCursor` на изолированном прежнем API build или контролируемом staging compatibility endpoint. Первая страница должна работать, клиент не должен запускать append или объявлять полную пагинацию.
- [ ] Сверить страницу и cursor на `newest`, `subscriptions`, `roots`, `replies` и `popular`; проверить корректный `410 pagination_expired`, ручной refresh и отсутствие cursor loops.
- [ ] Проверить API JSON logs и client telemetry: нет cursor, auth header/token, comment body, raw IP, owner key или snapshot ID. Сверить `requestId` между клиентом и API.

## 2. Ограниченный web/Android rollout

- [ ] Web: собрать отдельный canary build с `VITE_FEED_PAGINATION=true`; Flutter: signed closed-test build с `--dart-define=YASKAPP_FEED_PAGINATION=true`. Сверить фактические ключи с реализацией T24 перед сборкой. Оставить обычные builds с default `false` доступными.
- [ ] Раздавать canary web build только через отдельную staging/canary точку. Android начать с внутренней/закрытой тестовой группы; не расширять охват автоматически.
- [ ] Проверить append, ручной Retry после ошибки, refresh, account switch/logout, реакции во время append, addressable comment target, empty page с новым cursor и expiry popular.
- [ ] Выпустить каждый клиент отдельно и наблюдать метрики в согласованное Release Owner окно; рекомендация — не менее 30 минут (один TTL snapshot). Записать фактическое окно. После окна QA Owner и API/DB Operator дают рекомендации; только Release Owner меняет охват.
- [ ] Сверять API `pagination.success` p95 по `surface`/`sort`, долю `pagination.failure`, `cursor_anomaly`, client `deduplication`, snapshot storage/expiry и client-observed latency. Цели PRD: chronological и popular continuation p95 ≤500 ms, popular snapshot creation p95 ≤1 500 ms, средний рост deep/first ≤2×; frame budgets — менее 5% сверх 16.67 ms. Известные T27 misses считать неуспешными до исправления или отдельного подписанного risk acceptance.
- [ ] Записать число участников, фактический интервал наблюдения, значения/источник метрик, ошибки и решение каждого владельца в release record.

## 3. Rollback smoke и условия завершения

- [ ] В staging собрать web и Android rollback builds с `VITE_FEED_PAGINATION=false` и `YASKAPP_FEED_PAGINATION=false`; подтвердить, что первые страницы работают и новая автодогрузка не запускается.
- [ ] Пройти rollback обоих клиентов: web переключить на сохранённый rollback artifact, Android установить/распространить предыдущий совместимый build. Записать версии, длительность и результат на каждом устройстве/браузере.
- [ ] При API fault остановить расширение и вернуть предыдущий API image только после проверки совместимости схемы. Не удалять additive API, migrations, legacy replies decoder, snapshot table или cleanup job; не менять cursor secret.
- [ ] После rollback проверить readiness, first page старого клиента, логи, метрики и возможность открыть ранее сохранённую страницу. Записать фактический результат, включая ошибки и время восстановления.
- [ ] Обновить legacy replies cursor window от **первого production rollout Android v1 cursor**: start = фактический UTC timestamp production release, end = start + 180 дней. Даты не вычислять по staging запуску; после истечения окна только тогда можно планировать удаление legacy decoder.
- [ ] Release Owner подписывает итоговое Go/No-Go и отдельное решение о расширении охвата; QA Owner подтверждает evidence. Не объявлять выпуск завершённым без выполненных staging и rollback checks и заполненного release record. T28 как задача плана закрыта решением пользователя; эта запись не подтверждает выпуск.

## Команды staging stack

Выполнять на согласованном staging host из release workspace с защищённым `services/api/.env.staging`; сначала проверить compose project и target host, чтобы не затронуть другой deployment:

```powershell
docker compose -f infra/docker/docker-compose.staging.yml config --quiet
docker compose -f infra/docker/docker-compose.staging.yml up -d --build api poll-feed-snapshot-cleanup
docker compose -f infra/docker/docker-compose.staging.yml ps
docker compose -f infra/docker/docker-compose.staging.yml logs --tail=100 migrate api poll-feed-snapshot-cleanup
```

Проверить `GET https://<staging-host>/health/ready` и зафиксировать migration status из фактической staging database. Эти команды пока не запускались: в этом workspace нет staging URL и `.env.staging`.
