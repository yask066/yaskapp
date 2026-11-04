# Архитектура

Flutter и React обращаются к одному API. API хранит данные в PostgreSQL,
медиафайлы — в S3-совместимом хранилище, а события между процессами передаёт через Redis.
В staging Caddy принимает HTTPS и WebSocket, раздаёт клиенты и проксирует API.

## Где находится код

| Каталог | Назначение |
| --- | --- |
| [apps/mobile](../apps/mobile) | Flutter, функциональные разделы в `lib/src/features` |
| [apps/web](../apps/web) | React + Vite, запросы в `src/api`, экраны в `src/features` |
| [apps/moderation-web](../apps/moderation-web) | Статическая панель модерации |
| [services/api/src/modules](../services/api/src/modules) | Fastify: маршруты, бизнес-правила и работа с БД по предметным областям |
| [services/api/src/realtime](../services/api/src/realtime) | WebSocket, соединения и Redis bus |
| [services/api/src/jobs](../services/api/src/jobs) | Push, удаление аккаунтов и периодическая очистка |
| [packages/shared/src](../packages/shared/src) | Общие TypeScript-контракты; Flutter-модели согласуются с ними вручную |
| [infra/docker](../infra/docker) | Локальные и staging-сервисы, Caddy, backup |
| [services/api/src/db/migrations](../services/api/src/db/migrations) | Полная схема БД и её история |

## Данные и транзакции

| Данные | Основные таблицы |
| --- | --- |
| Аккаунты и профили | `users`, `profiles` |
| Опросы и обсуждения | `polls`, `poll_options`, `poll_votes`, `comments`, `likes` |
| Подписки | `follows` |
| Уведомления | `notifications`, `notification_preferences`, `notification_devices`, `notification_push_jobs` |
| Модерация | Таблицы дел, жалоб, санкций, апелляций и аудита из миграций `009–020` |
| Удаление аккаунтов | Операции, шаги очистки и архив из миграций `028–033` |
| Пагинация | Индексы и снимки ленты из миграций `034–035` |

PostgreSQL — источник истины. Уникальность голоса, лайка и подписки обеспечивается
БД; связанные счётчики меняются в той же транзакции. В БД сохраняются ключи объектов,
а доступ к файлам организует API. Применённые миграции не переписываем:
изменение схемы получает новую миграцию.

## Авторизация

Публичный web использует HttpOnly cookie `yaskapp_session`; JavaScript не хранит JWT.
Flutter и текущая панель модерации используют `Authorization: Bearer <token>`.
Cookie-записи и WebSocket проверяют доверенный `Origin`. Токены в URL WebSocket
не принимаются. При HTTPS cookie получает `Secure`.

Проверки ролей, санкций, владельца и доступности объекта выполняются на сервере.
Скрытая кнопка в клиенте не заменяет проверку API.

## Карта API

Точные тела, ошибки и ограничения находятся в схемах маршрутов и общих типах.
Эта таблица помогает найти нужный модуль без дублирования полного контракта.

| Задача | Основные маршруты | Исходник |
| --- | --- | --- |
| Регистрация и сессия | `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me` | [auth.routes.ts](../services/api/src/modules/auth/auth.routes.ts) |
| Профили и подписки | `/profiles/me`, `/users/:userId`, `/users/:userId/follow` | [profiles.routes.ts](../services/api/src/modules/profiles/profiles.routes.ts) |
| Опросы, голоса, лайки, комментарии | `/polls`, `/polls/subscriptions`, `/polls/:pollId` и дочерние маршруты | [polls.routes.ts](../services/api/src/modules/polls/polls.routes.ts) |
| Поиск | `/search` | [search.routes.ts](../services/api/src/modules/search/search.routes.ts) |
| Уведомления и настройки | `/notifications`, `/notification-preferences`, `/notification-devices` | [notifications.routes.ts](../services/api/src/modules/notifications/notifications.routes.ts) |
| Жалобы и модерация | `/moderation/*`, `/appeals*` | [moderation.routes.ts](../services/api/src/modules/moderation/moderation.routes.ts) |
| Администрирование | `/admin/*` | [admin.routes.ts](../services/api/src/modules/admin/admin.routes.ts) |
| Удаление аккаунта | `/auth/account-deletion/verification`, `DELETE /auth/me`, `/auth/account-deletion/status` | [account-deletion.routes.ts](../services/api/src/modules/account-deletion/account-deletion.routes.ts) |

## Пагинация и состояние клиента

`nextCursor` — непрозрачная строка или `null`. Клиент возвращает её без изменений,
не вычисляет страницы по ID и не считает короткую страницу признаком конца.
Параметры запроса и пользователь должны совпадать с контекстом курсора.

Популярная лента использует серверный снимок; актуальная доступность опроса
проверяется при его чтении. Подпись курсоров использует
`PAGINATION_CURSOR_SECRET`, отдельный от `JWT_SECRET`. Смена секрета делает
старые курсоры недействительными. Типы — в
[pagination.ts](../packages/shared/src/pagination.ts).

Поздний ответ старого запроса не должен заменять состояние после смены аккаунта,
фильтра или обновления списка. `stateRevisions` хранит отдельные версии голосов,
лайков и комментариев. Данные текущего пользователя принимаются только из его
авторизованного ответа; общий broadcast их не заменяет. Анимация отображает
принятое состояние, не меняя его.

## Уведомления и realtime

Запись уведомления и push-задание сохраняются в PostgreSQL.
После commit API публикует событие в Redis-канал `yaskapp:realtime:v1`.
Каждая реплика отправляет его только соединениям получателя.
Все реплики одного окружения должны использовать один `REDIS_URL`.

Доставка через Redis — best effort, отдельного надёжного outbox для realtime
уведомлений нет. HTTP восстанавливает пропущенные изменения после `connection.ready`,
reconnect, возврата web-вкладки и Flutter resume. Push имеет собственную очередь
`notification_push_jobs` и отдельный worker.

Версия событий — `1`: `notification.created`, `notification.read`,
`notifications.read_all`. Неизвестные типы и версии игнорируются.
Контракт — в [notifications.ts](../packages/shared/src/notifications.ts).
