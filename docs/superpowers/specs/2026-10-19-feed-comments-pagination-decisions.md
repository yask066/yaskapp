# ADR: Решения по пагинации ленты и комментариев

**Дата:** 19 октября 2026 года<br>
**Статус:** Принято для T01; поведение ещё не реализовано.<br>
**Основание:** [PRD пагинации](../../prd-feed-comments-pagination.md), FR-01 и API-02–04.<br>
**Область:** совместимость API, cursors, popular snapshots, поколения Following и rollout Flutter Android/web.

## Контекст

Текущий `GET /polls` возвращает `{ items }`, а `GET /polls/:pollId/comments` выдаёт roots в ASC с default `limit=50`. Новые клиенты должны получать roots newest-first, не меняя старого поведения. Replies уже продолжаются base64url cursor с `createdAt` и `id`; он не подписан и не связан с poll/root. Popular сейчас ранжируется по `votes_count * 2 + likes_count * 1.5 + comments_count`, поэтому последующие запросы к текущему score могут пропускать записи.

API использует PostgreSQL и Redis. В API есть одноразовые cleanup-команды, но нет общего in-process scheduler. Web и Flutter умеют только build-time rollout flags для motion; remote kill switch в текущем приложении отсутствует. Flutter Feed не имеет сортировки популярности, а Following открыт отдельной вкладкой.

## Решения

### 1. Порядок, capability detection и ошибки

- Новые клиенты передают `order=newest` для корневых комментариев. Запрос без `order` сохраняет legacy `oldest` и текущий default `limit=50`; новые клиенты явно передают `limit=20`.
- Все новые ответы пагинации имеют `{ items, nextCursor }`. Наличие поля с типом `string | null` означает поддержку; `null` означает конец. Отсутствующее поле означает legacy-сервер без поддержки pagination и запрещает append. Поле другого типа — ошибка контракта.
- Ошибки используют общий JSON envelope `{ error, message, details? }`; `details` остаётся только для validation errors. Неверный, чужой или неподдерживаемый cursor отвечает `400 pagination_cursor_invalid`; истёкший или вытесненный popular snapshot — `410 pagination_expired`. Авторизация и текущие visibility/moderation правила применяются независимо от cursor.

### 2. Cursor v1 и legacy replies

- Новый wire format — `c1.<payload-base64url>.<signature-base64url>`. Payload — UTF-8 JSON фиксированной схемы версии 1; подпись — HMAC-SHA-256 над `c1.<payload-base64url>`. Base64url не шифрует payload, поэтому в нём нет текста контента или секретов.
- Payload связывает cursor с типом списка, sort/order, `pollId`/`rootId`, если они применимы, и владельцем персональной выдачи. Для chronological страниц он несёт точные PostgreSQL tuple boundary/high-watermark `(timestamp, id)`; timestamp сериализуется строкой с микросекундами. Для popular он несёт `snapshotId` и позицию. `limit` может меняться в разрешённом диапазоне и не входит в scope.
- Ключ `PAGINATION_CURSOR_SECRET` независим от `JWT_SECRET`, содержит минимум 32 случайных байта и одинаков на всех API replicas. В production ключ задаётся явно. Ротация ключа намеренно отзывает существующие v1 cursors; клиент получает `pagination_cursor_invalid` и начинает новую выдачу. Смена формата или semantics требует версии `c2`.
- Legacy replies decoder принимает прежний unsigned `{ createdAt, id }` base64url формат только на endpoint replies, строго проверяет схему, а запрос остаётся ограничен `pollId`/`rootId` и текущими правилами доступности. Совместимость длится 180 дней с production-выпуска Android-клиента, который использует v1 cursor; дату начала и завершения заносят в release checklist. После срока legacy cursor отвечает `400 pagination_cursor_invalid`.
- Для chronological cursors отдельный срок истечения не вводится. Popular continuation действует только пока жив snapshot, то есть 30 минут с создания без продления чтением.

### 3. Popular snapshots

Выбрано хранение в PostgreSQL нормализованными строками: metadata снимка и отдельные ordered ID с `snapshotId`, `position` и `pollId`. Первый запрос сохраняет полный порядок доступного набора по текущей формуле score, затем `created_at DESC, id DESC`; ограничивать снимок первыми N ID нельзя. На следующих страницах продвигается исходная позиция. Карточки, viewer state и visibility повторно гидратируются при каждом чтении; недоступные ID пропускаются без tombstone с текстом. Между HTTP-запросами транзакция или соединение не удерживаются.

- TTL — 30 минут с момента создания, без продления чтением.
- На одного владельца допускается не более 3 активных snapshots. Создание четвёртого вытесняет самый старый; его дальнейший cursor отвечает `410 pagination_expired`. Проверка квоты и вытеснение выполняются атомарно для владельца.
- Идентификатор владельца для аккаунта строится из user ID; для гостя — из `request.ip`, определённого Fastify с текущими trusted-proxy правилами. В таблицах хранится только HMAC-SHA-256 owner key, вычисленный с domain separation через `PAGINATION_CURSOR_SECRET`; исходные IP и user ID не сохраняются. Гостевые клиенты за одним NAT делят квоту.
- Cleanup реализуется как отдельная одноразовая команда, запускаемая deployment scheduler каждые 5 минут. Она удаляет просроченные snapshots и их ordered IDs. Если текущая staging-конфигурация не предоставляет scheduler, T22 добавляет отдельный job container с тем же cadence.
- Если полная первая snapshot-страница не укладывается в PRD budget p95 1,5 секунды на согласованном staging fixture, оптимизируется запрос/индексы или решение пересматривается до выпуска popular. Уменьшать полный набор до фиксированного cap запрещено.

### 4. Following generation, auth и клиентский cache

- Подтверждённый follow/unfollow увеличивает generation только выдачи Following текущего пользователя. Открытая выдача отменяет pending append и заменяет цепочку с первой страницы; скрытая выдача инвалидируется и перечитывает первую страницу при следующем открытии. For you/newest и popular сохраняют свои pages и scroll context.
- Logout и смена аккаунта немедленно увеличивают session epoch, очищают viewer-scoped pages/cursors/pending и не переносят гостевые данные в аккаунт или данные одного аккаунта в другой. Серверные snapshot rows остаются до TTL/cleanup; их нельзя продолжить с другим owner key.
- Неактивная клиентская page cache вместе с anchor context хранится не более 5 минут. В пределах окна возврат к поверхности восстанавливает pages и anchor; после истечения cache создаётся новая generation с первой страницы и без старого cursor. Logout/account switch очищает это состояние сразу.

### 5. Точка входа и rollout

- Flutter получает минимальный переключатель `Newest / Popular` в шапке Feed. Сортировка Following остаётся отдельной существующей вкладкой; scope PRD не сокращается.
- Пагинация включается build-time flags `YASKAPP_FEED_PAGINATION` (`--dart-define`) и `VITE_FEED_PAGINATION`; обе по умолчанию `false`. Текущие release controls не дают remote kill switch. Rollout: additive server API, затем ограниченный web/Android build с флагом `true`, smoke/метрики, дальнейшее расширение. Rollback требует нового web build / Android build с флагом `false`; первая страница остаётся доступна.

## Последствия и контроль

- T03/T04/T22 должны брать из ADR точный page/error contract, формат и scope cursor, secret policy, таблицы snapshot, quota, owner identity и cleanup cadence; клиентские T08/T15/T24 используют flags, generation и retention выше.
- Полный snapshot хранит только ID, но размер таблиц и latency растут с числом публичных опросов. P5 проверяет p95, рост глубокой страницы, cleanup lag и полный обход на PRD fixture.
- Квота гостя по IP объединяет людей за NAT; следствие — новый guest snapshot может вытеснить старую выдачу другого гостя за той же сетью. Возврат восстанавливается refresh и новой первой страницей.
- T14/T21 rollout нельзя остановить удалённо. Release record должен содержать значения flags, build/version и фактические даты выкладки, чтобы выполнить 180-дневное окно v0 replies cursors.
- ADR не меняет scope PRD и не подтверждает реализацию, нагрузочные измерения или готовность к выпуску.
