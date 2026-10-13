# Карта данных: удаление аккаунта Yaskapp

**Статус:** текущая схема проекта и предлагаемая логика удаления для AD-01.
**Источник истины:** рабочие migrations и действующие модули, перечисленные ниже.

Термин «удалить» для основной базы означает физическое удаление записи и её
содержимого после немедленной блокировки аккаунта. Soft-delete (`deleted_at`)
прекращает выдачу данных пользователю, но сам по себе не завершает очистку.
Чужие документы, связанные с удаляемым пользователем, сначала обрабатываются
по правилам этой карты; затем worker удаляет аккаунт и контролируемые копии.

В таблице «проверка» описывает критерий задачи, а не готовую утилиту или
уже автоматизированный release gate. Идентифицируемая история модерации и
сроки хранения остаются предложениями PRD, требующими утверждения.

## Основной социальный граф

Схема создана в `services/api/src/db/migrations/001_initial_social_schema.sql`.

| Таблица / поля | Источник и связи | Предлагаемое действие | Проверка после шага |
| --- | --- | --- | --- |
| `users` | Email, username, password hash, role, status, session version, last seen, timestamps, deletion timestamp | Немедленно закрыть доступ, сменить `session_version`, в финальной фазе физически удалить. Не переносить credential hash или identity в журнал | В действующих таблицах и media payload нет записи user ID; JWT/cookie больше не принимаются |
| `profiles` | Display name, bio, country, avatar/cover object key, website/location при наличии, прикладные счётчики; FK на `users` cascade | До удаления скопировать и проверить принадлежность media keys в защищённый manifest; стереть профиль. `cover_object_key` присутствует в схеме, даже если интерфейс не найден | Профиля нет, оставшиеся URL и кэшированные карточки не выдают изображение |
| `polls` | Question, description, author, visibility, счетчики, `deleted_at`, `image_object_key`; FK author → users cascade | Удалить собственные опросы, включая soft-deleted; записать `image_object_key` до каскада; связанные действия и обсуждение собственного poll удалить | Опрос и прямой `/media/polls/:pollId` не доступны, keys включены в manifest |
| `poll_options` | Text и counts; FK poll → cascade | Удалить вместе с собственным poll; в сохраняемых опросах обновить затронутые варианты | Нет options удалённого poll; votes match оставшимся строкам |
| `poll_votes` | Полная запись выбора option и voter; FK poll/option/voter → cascade | Удалить свои голоса во всех сохранившихся чужих опросах, в том числе закрытых; пересчитать `votes_count` poll и options | Голоса отсутствуют; сумма counts совпадает с оставшимися rows, revisions обновлены |
| `comments` | `body`, `author_id`, `parent_comment_id`, likes/replies counts, `deleted_at`; FK poll/author/parent → cascade | Удалить собственные комментарии и реакции. До удаления перепривязать чужие сохранённые ответы к ближайшему живому предку или `NULL`; в собственном удаляемом poll каскадом удалить всё обсуждение | Ни один survivor не ссылается на удалённый comment; дерево, counts и содержание соответствуют правилу PRD |
| `account_deletion_content_targets` | Operation ID, type и UUID затронутого poll/comment; без пользовательского текста | Хранить цели для последующего пересчёта AD-08 до окончания операции; удаляется каскадом с retention-записью operation | После очистки retention нет целей завершённой операции |
| `likes` | Связь user с poll либо comment; FK user/poll/comment → cascade | Удалить действия удалённого аккаунта. Каскад у удалённого poll/comment дополняет явную очистку на сохранённых объектах | Нет likes пользователя; surviving target counts совпадают с rows |
| `follows` | `follower_id`, `followee_id`; оба FK → cascade | Удалить связи в обоих направлениях; пересчитать счётчики затронутых пользователей | Нет ни входящих, ни исходящих связей; surviving profile counters корректны |
| `notifications` | Получатель FK cascade; actor FK `SET NULL`; poll/comment после migration 021 FK `SET NULL`; свободный `payload JSONB` | Удалить входящие уведомления; удалить/очистить уведомления других получателей, где удалённый user — actor или target удаляемых данных. До стирания целей проверить `payload` на имя, excerpt и иные копии | Нет строк с deleted recipient/actor/target; surviving notifications не включают удаляемый профиль или контент |

Каскад из `users` помогает удалить связанные rows, но не управляет счётчиками,
JSON-копиями, файлами, provider jobs и связями без FK. Поэтому он выполняется
в последней фазе после явной очистки и сверки счётчиков.

## Медиа и объектное хранилище

| Источник | Формат / поиск | Действие | Критерий |
| --- | --- | --- | --- |
| Аватар профиля | `profiles.avatar_object_key`; upload создаёт `avatars/{userId}/...`; replacement может оставить orphan; endpoint выдаёт `/media/avatars/:userId` | Сохранить ссылочный key до DB delete; перечислить только проверенный user prefix, включая историю/версии, когда API storage позволяет её читать; удалить media и не отдавать media endpoint закрытого user | Ссылка отсутствует, media prefix очищен и direct GET не выдаёт bytes |
| Изображение опроса | `polls.image_object_key`; текущий сервис использует `poll-images/{authorId}/...`, доставка — `/media/polls/:pollId` | Снять keys удаляемых polls до cascade; проверить orphan prefix и версии; запретить выдачу удалённого poll | Нет активных/старых объектов, новых ссылок и успешного GET |
| Cover/profile images | `profiles.cover_object_key` существует в исходной схеме; текущий UX и маршрут не обнаружены | Проверить фактические исторические rows и все producers прежде чем утверждать поддержку; удалять найденные keys | Нет объектов по заполненным cover keys; отсутствие producer документировано |
| Неизвестные uploads / старые orphan | S3/MinIO; связи с БД может уже не быть | Enumerate только принадлежащие пользователю namespaced prefixes; никогда не строить широкий delete из клиентского ввода | Повтор scan не обнаруживает принадлежащие аккаунту current/orphan/versioned objects, чужие prefixes не изменились |

На дату карты API предоставляет `putObject`, `deleteObject`, `deleteObjects`,
`getObject`, `listObjects` в `services/api/src/config/storage.ts`; перечисление
версий, точный запрос orphan cleanup и проверка частичных batch errors требуют
технического решения в AD-10. Не считать удаление single key или удаление
bucket prefix через substring безопасным доказательством завершения.

## Уведомления и доставка

| Таблица / система | Что содержит | Действие и проверка |
| --- | --- | --- |
| `notification_preferences` (`022_notification_preferences.sql`) | Настройки каналов/типов; FK `user_id` cascade | Удаляется каскадом; проверить отсутствие строки пользователя |
| `notification_devices` (`023_notification_devices.sql`) | Push tokens, platform, timestamps, revocation state; FK user cascade | Удалить серверные tokens до удаления пользователя; отключить доставку этим токенам; проверить повторную регистрацию старого устройства |
| `notification_push_jobs` (`024_notification_push_jobs.sql`, retry metadata в `025_notification_push_retry.sql`) | Recipient, notification, poll/comment IDs, тип, состояние/попытки, ошибки; FK job → notification/user cascade | Удалить jobs связанные с удаляемым получателем/уведомлением и удаляемым контентом. Worker сверяет job непосредственно перед provider call и не воссоздаёт job из уже прочитанной очереди | После закрытия нет provider calls для новых удаляемых jobs, записей/устройств и повторных job для этих targets |
| Redis realtime channel, локальные hub sockets | События направленным получателям и открытые соединения, не долговечная БД | Распространить короткое invalidation/deleted событие по всем узлам; при недоступности Redis не выдавать закрытый аккаунт по GET и не отправлять ему буферизированные данные | Два узла больше не авторизуют user; reconnect и запрос данных также отклоняются |
| Server-side/session transport | Bearer JWT, HttpOnly cookie, `session_version` | Инвалидировать все текущие сессии и очищать response cookie. JWT не сохраняется в deletion receipt | Старый Bearer/cookie отозван на всех API handlers, включая optional auth и websocket |

Уведомление, уже переданное внешнему push provider до приёма запроса, может
появиться на устройстве пользователя; Yask удаляет свои записи и запрещает
новые отправки после закрытия. Это технический предел, который нужно включить
в понятный текст пользователю до релиза.

## Жалобы, санкции и аудит

Источники: `009_admin_audit_log.sql`, `010_moderation_reports.sql`,
`011_moderation_case_workflow.sql`, `013_moderation_note_author_retention.sql`,
`014_moderation_sanctions.sql`, `015_moderation_idempotency.sql`,
`017_moderation_appeals.sql`, `018_moderation_appeal_audit.sql`.

| Таблица / поля | Текущая модель связи | Предлагаемая очистка |
| --- | --- | --- |
| `reports` | `reporter_user_id` → users cascade; `target_type/target_id`, category, description без FK на target | Удалить пользовательские reports, созданные аккаунтом. В оставшихся reports других авторов удалить target/profile/quoted content copies, сохранив допустимые category/status/date. Проверить свободный description |
| `moderation_cases` | Полиморфные `target_type/target_id` без FK; `resolution_note`, assignment user FK set-null | Для закрываемого target отвязать target и удалить snapshots/profile/`resolution_note`, сохранив допустимый outcome. Освободить дела, назначенные удалённому модератору |
| `moderation_case_reports` | FK на case и report cascade | Дать DB cascade удалить связь при удалении пользовательского report; чужие cases и reports сохранить |
| `moderation_case_notes` | Note author `ON DELETE SET NULL`, свободный `body` | Очистить/санацировать текст заметок других пользователей, если в нём скопированы личные данные/удаляемый контент. Авторство модератора сохранять только пока это допускает утверждённая retention policy |
| `sanctions`, `user_strikes` | User, actor, revoker и case FK преимущественно `SET NULL`; причина и `metadata JSONB` — свободный текст | Удалить references/metadata/snapshots, содержащие данные пользователя. Предложение PRD — сохранить минимум type/status/date с ограниченным сроком; не реализовывать как утверждённое правило без решения |
| `appeals` | Собственный `user_id` cascade; `reason`, `decision_note`; sanction FK cascade; resolver FK set-null | Удалить appeals пользователя, их текст и idempotency response. В затронутых чужих appeals очистить связанные копии; снять FK на удаляемый resolver при нужде |
| `moderation_idempotency_keys` | Составной ключ actor user; FK cascade; сохранённый fingerprint/response | Удалить ключи/response пользователя при закрытии сессий или каскаде; удостовериться, что response JSON не содержит персональные поля |
| `admin_audit_log` | Actor FK `SET NULL`; `target_type/target_id` не FK; `reason`, `metadata JSONB` | Стереть target references, snapshots и персональные свободные тексты по карте. Минимальная остаточная запись возможна только согласно утверждённому правилу и сроку |
| `moderation_policies` и actor IDs | Одна общая строка политики; updater FK `SET NULL` | Сохранить применимую общую политику, очистить связь updater. Удаление пользователя не удаляет глобальные настройки |

В `admin_audit_log` и moderation tables нет общей целостности для полиморфных
target IDs, а `reason`, `resolution_note`, `body`, metadata/payload могут
содержать PII даже без FK. Техническая возможность сохранить UUID/type/date
не означает автоматическое согласование срока хранения этих данных.
Сначала удалить/санировать свободный текст и snapshots согласно решению AD-01,
затем разрешить физическое удаление user rows. Нельзя добавлять имя или UUID в
служебный журнал без утверждения и срока.

## Поиск, клиенты и локальное состояние

| Область | Текущее место | Действие |
| --- | --- | --- |
| Поиск | `search.repository.ts` строит ответы из `users/profiles/polls` | Прямые запросы после закрытия не находят пользователя; после purge не остаются строки профиля/poll; поисковые response caches не возвращают старые результаты |
| Flutter auth | `apps/mobile/lib/src/features/auth/auth_session_store.dart` — secure storage access token | Стереть обычный token, остановить realtime и очистить account-owned state |
| Flutter poll state | `apps/mobile/lib/src/features/polls/poll_state_store.dart` — state store живёт в памяти сессии | Инвалидировать viewer/session epoch и отфильтровать поздние HTTP/realtime ответы; очистить вместе с сессией |
| Flutter push | Локальный Firebase registration state плюс серверная `notification_devices` | Отозвать server device; очистить session/push association согласно доступному plugin API; старый push не открывает приватный экран |
| Web auth/query | `apps/web/src/app/session-provider.tsx` очищает session/query on signout/401; HTTP-only cookie нельзя читать из JS | Удалять query/auth/private route состояние только на принятии deletion либо подтверждённом отзыве этой сессии; token операции держать в отдельном receipt-store |
| Web tab | Realtime client и session provider | Передать `account.deleted` другим открытым вкладкам без токенов/PII; стирать старые ответы, блокировать запросы старого account |
| Лента/scroll/navigation/media cache | Проверить реальное наличие persistent cache и image cache в Flutter/web на момент реализации | Стирать всё account-scoped, что на самом деле хранится. Не обещать очистку приложения/браузера за пределами управляемых хранилищ и установленных response-cache сроков |
| Уже отправленные события/provider payloads | Уведомление может содержать идентификаторы полей; push provider получает данные до передачи | Очистить доступные server copies, остановить повторы и не заявлять удаление пользовательских скриншотов, delivered OS payloads или сторонних копий |

На момент составления карты web query cache — in-memory TanStack Query cache,
session использует HttpOnly cookie; `localStorage` для продуктовых данных в
просмотренном web-коде не найден. Persistent `localStorage` предусмотрен только
временной квитанцией, контракт которой описан отдельно. В mobile просмотренная
сессия хранит токен в secure storage, poll state — в памяти; точные MediaCache
и push plugin APIs подтвердить при реализации клиента.

## Восстановление и хранение

- Backup PostgreSQL и архивные версии storage могут вернуть account rows,
  object keys и payload после восстановления старого снимка.
- До открытия трафика после restore применить журнал принятых удалений,
  очистить соответствующие media/DB снова и сверить результат по этой карте.
- Журнал должен переживать восстановление основной БД; операции, manifest и
  журнал завершения не подлежат обычному TTL, если операция ещё незавершена.
- Проектные предложения по срокам: backup — до 30 дней, минимальная
  идентифицируемая moderation history — до 30 дней, журнал завершённых
  операций — до 35 дней. Решение и реальные параметры storage/backup до выпуска
  должны быть утверждены; числа в этой карте пока не являются политикой.

## Исходники в репозитории

- Базовая social schema: `services/api/src/db/migrations/001_initial_social_schema.sql`.
- Admin audit/reports/workflow: `009`–`013`.
- Sanctions, idempotency, appeals: `014`–`019`.
- Notifications, preferences, devices, jobs/retries: `001`, `021`–`025`.
- Storage keys: `services/api/src/config/storage.ts`,
  `services/api/src/modules/profiles/avatars.service.ts`,
  `services/api/src/modules/polls/poll-images.service.ts`.
- Web/mobile session and realtime: `apps/web/src/app/session-provider.tsx`,
  `apps/web/src/api/client.ts`, `apps/mobile/lib/src/app.dart`,
  `apps/mobile/lib/src/features/auth/auth_session_store.dart`,
  `apps/mobile/lib/src/features/polls/poll_state_store.dart`.
