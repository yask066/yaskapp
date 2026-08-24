# PRD: Модерация и административное управление

**Статус:** Draft  
**Дата:** 2026-08-24  
**Продукт:** Yaskapp  
**Владелец:** Product / Backend

## 1. Краткое описание

Yaskapp должен получить серверную систему модерации, которая позволит
модераторам и суперадминистраторам поддерживать порядок в приложении:

- управлять ролями и permissions;
- просматривать и управлять пользователями и опросами;
- блокировать и разблокировать пользователей;
- удалять нарушающие опросы и комментарии;
- видеть полный аудит административных действий;
- гарантировать, что Flutter не может обойти ограничения.

Backend является единственным источником истины для прав доступа. Наличие
кнопки в Flutter никогда не считается защитой endpoint.

## 2. Контекст текущего проекта

В проекте уже есть:

- JWT-аутентификация с `request.user.sub`;
- таблица `users` со статусами `active`, `blocked`, `deleted`;
- таблицы `profiles`, `polls`, `comments`, `likes`, `follows` и
  `notifications`;
- soft-delete через `deleted_at` для пользователей, опросов и комментариев;
- серверная проверка владельца при удалении собственного опроса;
- Flutter mobile client и Node.js/Fastify API;
- PostgreSQL как источник данных и Redis/WebSocket для инфраструктурных задач.

Новая функция должна расширить существующую модель, не превращая обычное
удаление владельцем в административное удаление.

## 3. Цели

1. Дать moderator и superadmin безопасные инструменты управления контентом.
2. Гарантировать серверную проверку каждой административной операции.
3. Сохранить историю: кто, что, над каким объектом и когда сделал.
4. Сделать блокировку пользователя действующей сразу для API-сессий и новых
   запросов.
5. Исключить возможность модератора повысить собственные права или права
   другого пользователя.
6. Обеспечить единообразное поведение в Feed, Profile, Subscriptions и
   realtime-обновлениях.

## 4. Не входит в первый релиз

- публичные жалобы пользователей и очередь reports;
- автоматическая модерация, ML и keyword-фильтры;
- appeals/апелляции и workflow пересмотра решения;
- бан по IP, устройству или fingerprint;
- массовые операции над тысячами объектов;
- экспорт аудита в SIEM или внешнюю систему;
- восстановление физически удалённых данных;
- отдельная web-панель: первый административный интерфейс остаётся во
  Flutter, API проектируется независимо от UI.

## 5. Роли и permissions

### 5.1 Роли

Роль хранится на backend в `users.role` и входит в authenticated user context.
Рекомендуемый набор:

| Роль | Назначение |
|---|---|
| `user` | Обычный пользователь приложения |
| `moderator` | Модерация пользователей и контента, без управления ролями |
| `superadmin` | Полный контроль над модерацией, ролями и аудитом |

Роль по умолчанию для регистрации — `user`. Первый `superadmin` создаётся
только через безопасный server-side bootstrap/CLI или миграцию, а не через
публичный endpoint.

### 5.2 Permissions

Проверка должна использовать permissions, а не разрозненные проверки строковой
роли внутри routes. Базовая матрица:

| Permission | user | moderator | superadmin |
|---|:---:|:---:|:---:|
| `admin.users.read` | — | ✓ | ✓ |
| `admin.users.block` | — | ✓ | ✓ |
| `admin.users.unblock` | — | ✓ | ✓ |
| `admin.users.delete` | — | — | ✓ |
| `admin.users.roles.read` | — | — | ✓ |
| `admin.users.roles.update` | — | — | ✓ |
| `admin.polls.read` | — | ✓ | ✓ |
| `admin.polls.delete` | — | ✓ | ✓ |
| `admin.comments.delete` | — | ✓ | ✓ |
| `admin.audit.read` | — | — | ✓ |

Правила эскалации:

- moderator не может менять роли;
- moderator не может блокировать или удалять `superadmin`;
- moderator не может заблокировать другого moderator без отдельного
  permission, которого в MVP нет;
- superadmin не может удалить или заблокировать сам себя;
- нельзя снять последнего активного `superadmin`;
- неизвестная или отсутствующая роль не даёт доступа;
- permissions вычисляются на backend по роли, а не принимаются из тела запроса.

## 6. Управление пользователями

Администратор должен видеть список пользователей с пагинацией и фильтрами:

- username/email/display name;
- роль;
- статус `active`, `blocked`, `deleted`;
- дата регистрации;
- дата последней активности;
- количество созданных опросов.

Карточка пользователя должна показывать профиль, статус, роль и доступные
администратору действия.

### 6.1 Блокировка

При блокировке:

- пользователь получает статус `blocked`;
- новые login и refresh/authenticated операции блокируются;
- активные JWT должны перестать работать при следующем запросе, поскольку
  `authenticate` обязан повторно проверить актуальный статус пользователя;
- публичные профиль, опросы и подписки заблокированного пользователя не
  выдаются;
- созданные им опросы исключаются из публичных лент;
- существующие данные сохраняются для аудита и целостности связей;
- действие записывается в audit log с причиной.

Разблокировка переводит пользователя в `active`, но не восстанавливает
физически удалённые данные и не изменяет роль.

Причина блокировки обязательна, длина и формат валидируются backend.

## 7. Управление опросами и комментариями

Moderator и superadmin могут:

- просматривать административный список опросов независимо от публичности;
- находить опрос по ID, автору, тексту, статусу и дате;
- удалять нарушающий опрос;
- удалять нарушающий комментарий;
- указывать обязательную причину удаления.

Административное удаление использует soft-delete и не должно менять
исторические audit records. В обычных пользовательских списках удалённый
контент не показывается.

Административное удаление должно:

- быть идемпотентным для повторного запроса;
- проверять, что объект существует или уже удалён;
- не позволять обычному пользователю вызвать admin endpoint;
- публиковать realtime-событие удаления, чтобы объект исчезал во всех
  открытых вкладках;
- не удалять audit log и не нарушать агрегаты/внешние связи.

В MVP модератор не редактирует текст чужого опроса или комментария: решение
ограничивается блокировкой доступа и удалением нарушающего контента.

## 8. Аудит административных действий

Создаётся append-only таблица `admin_audit_log`.

Минимальные поля:

| Поле | Назначение |
|---|---|
| `id` | UUID события |
| `actor_user_id` | Кто выполнил действие |
| `actor_role` | Роль на момент действия |
| `action` | Нормализованный тип действия |
| `target_type` | `user`, `poll`, `comment` |
| `target_id` | ID объекта |
| `reason` | Обязательное обоснование для destructive actions |
| `metadata` | JSONB без паролей, токенов и секретов |
| `request_id` | Корреляция с API-логом |
| `ip_hash` | Опциональный privacy-safe идентификатор источника |
| `created_at` | Время действия |

Типы действий MVP:

- `user.blocked`;
- `user.unblocked`;
- `user.role_changed`;
- `user.deleted`;
- `poll.deleted_by_admin`;
- `comment.deleted_by_admin`.

Audit log нельзя изменять или удалять через API. Каждая успешная destructive
операция и изменение роли должна записываться в той же транзакции, что и
изменение объекта. Неуспешные попытки доступа не изменяют audit log, но
должны попадать в обычные security/application logs с request id.

Superadmin видит журнал с фильтрами по actor, action, target и диапазону дат,
с cursor pagination. Moderator не получает доступ к журналу в MVP.

## 9. Backend API

Все endpoints ниже требуют `Authorization: Bearer <JWT>` и соответствующее
server-side permission.

### Пользователи

```text
GET    /admin/users?status=&role=&query=&limit=&cursor=
GET    /admin/users/:userId
POST   /admin/users/:userId/block       { reason }
POST   /admin/users/:userId/unblock     { reason }
DELETE /admin/users/:userId             { reason }
PATCH  /admin/users/:userId/role        { role, reason }  # superadmin only
```

### Контент

```text
GET    /admin/polls?status=&authorId=&query=&limit=&cursor=
GET    /admin/polls/:pollId
DELETE /admin/polls/:pollId             { reason }
DELETE /admin/comments/:commentId      { reason }
```

### Аудит

```text
GET    /admin/audit?action=&actorId=&targetType=&targetId=&from=&to=&limit=&cursor=
```

Ответы должны использовать единый формат ошибок:

- `401 unauthorized` — нет или недействителен JWT;
- `403 forbidden` — JWT валиден, но permission отсутствует;
- `404 not_found` — объект не раскрывается пользователю без права доступа;
- `409 invalid_admin_transition` — запрещён переход роли/статуса;
- `422 validation_error` — отсутствует или некорректна причина/параметры.

Для блокировки и удаления endpoint не должен доверять `actorId`, `role` или
`permission` из request body: actor берётся только из проверенного JWT.

## 10. Server-side authorization design

Добавить общий слой:

```text
authenticate -> loadCurrentUserAndStatus -> requirePermission(permission)
```

`authenticate` должен:

1. проверить подпись и срок JWT;
2. загрузить пользователя по `sub`;
3. отклонить deleted/blocked пользователя;
4. положить в request context `id`, `role`, `status` и вычисленные permissions.

`requirePermission` используется в каждом `/admin/*` route. Проверка владельца
и проверка роли — разные политики: владелец может удалить свой собственный
опрос по обычному endpoint, а администратор — только через admin policy.

Нельзя полагаться на скрытие admin-раздела во Flutter. Прямой HTTP-запрос к
каждому admin endpoint должен быть покрыт тестом для user, moderator и
superadmin.

## 11. Flutter UX

Flutter получает роль и доступные capabilities из `/auth/me` или текущей
сессии, после чего:

- показывает Admin section только пользователю с admin capability;
- отображает вкладки Users, Polls и Audit в зависимости от permissions;
- требует подтверждение и причину перед block/unblock/delete/role change;
- удаляет заблокированный/удалённый контент из Feed, Profile,
  Subscriptions и других открытых экранов по realtime-событию;
- корректно обрабатывает `401`, `403`, `404`, `409`, `422`;
- после `403` скрывает недоступное действие, но не считает UI проверкой прав;
- при потере роли обновляет session capabilities и закрывает Admin section.

Admin UI не должен позволять вводить произвольные permissions. Выбор роли —
только из server-supported enum.

## 12. Realtime-события

Добавить события с минимальным payload:

```text
user.blocked       { userId }
user.unblocked     { userId }
poll.admin_deleted { pollId }
comment.admin_deleted { commentId, pollId }
```

События не должны содержать пароль, email, причину модерации или внутренние
audit metadata. Сервер сначала применяет транзакцию и audit record, затем
публикует событие. Повторная доставка должна быть безопасной.

## 13. Безопасность и приватность

- bcrypt/password hash и JWT не меняются без отдельной задачи;
- blocked user не может обойти блокировку старым JWT;
- role change и block/delete требуют повторной проверки актуального actor
  status в транзакции;
- причины и metadata очищаются от секретов и ограничиваются по размеру;
- audit endpoint доступен только superadmin;
- email и IP не выдаются в публичные DTO;
- destructive endpoints защищены rate limit и request id;
- нельзя удалить последнего superadmin или изменить его роль так, чтобы в
  системе не осталось superadmin;
- все SQL-запросы параметризованы;
- soft-delete сохраняется, физическое удаление выполняется отдельной
  retention-политикой, которой нет в MVP.

## 14. Модель данных и миграции

Предлагаемые изменения:

1. Добавить enum `user_role` со значениями `user`, `moderator`, `superadmin`.
2. Добавить `users.role user_role NOT NULL DEFAULT 'user'`.
3. Создать `admin_audit_log` с индексами по `created_at`, `actor_user_id`,
   `(target_type, target_id)` и `action`.
4. Добавить при необходимости `deleted_by_user_id` и
   `deletion_reason` в polls/comments либо хранить эти данные только в
   audit log; рекомендуемый вариант для MVP — audit log как источник
   модерационной причины, без дублирования в доменных таблицах.
5. Обновить user DTO и shared contracts так, чтобы роль не появлялась в
   публичном профиле без необходимости.
6. Добавить bootstrap-механизм первого superadmin без публичной регистрации.

Миграции должны быть backward-compatible для существующих пользователей:
все существующие записи получают `user`.

## 15. Критерии приёмки

### Roles and permissions

- [ ] Новый пользователь получает роль `user`.
- [ ] Только superadmin может менять роль.
- [ ] User получает 403 на каждый `/admin/*` endpoint.
- [ ] Moderator получает доступ только к разрешённым user/content действиям.
- [ ] Superadmin получает доступ к audit и role management.
- [ ] Нельзя заблокировать себя или удалить последнего superadmin.

### User moderation

- [ ] Block требует непустую причину и меняет статус пользователя.
- [ ] Заблокированный пользователь не может login и выполнять authenticated
      операции со старым JWT.
- [ ] Unblock возвращает пользователя в active.
- [ ] Заблокированный пользователь не появляется в публичных списках.

### Content moderation

- [ ] Moderator может удалить чужой poll/comment через admin endpoint.
- [ ] User не может вызвать тот же endpoint напрямую.
- [ ] Удалённый контент исчезает из всех пользовательских списков.
- [ ] Повторное удаление идемпотентно.
- [ ] Причина удаления сохраняется в audit log.

### Audit

- [ ] Каждая успешная admin mutation имеет ровно одну audit запись.
- [ ] Audit содержит actor, роль, действие, target, reason, request id и время.
- [ ] Audit записи нельзя изменить или удалить через API.
- [ ] Только superadmin может читать audit log.

### Client

- [ ] Admin UI отображается только при наличии capability.
- [ ] Перед destructive action показывается подтверждение с обязательной
      причиной.
- [ ] 403 корректно отображается и не приводит к ложному успеху.
- [ ] Realtime-удаление обновляет Feed, Profile и Subscriptions.

## 16. Тестирование

Backend:

- unit-тесты permission matrix;
- integration-тесты для каждого admin endpoint с user/moderator/superadmin;
- тесты blocked JWT, self-protection и last-superadmin protection;
- тесты транзакционности mutation + audit;
- тесты идемпотентного удаления и повторных запросов;
- тесты отсутствия административных полей в публичных DTO;
- realtime-тесты без утечки причины и приватных данных.

Flutter:

- API client tests для admin endpoints и error mapping;
- widget tests для capability-based visibility;
- widget tests для confirmation/reason flow;
- tests на обновление списков после admin realtime events.

Smoke/E2E:

1. Bootstrap superadmin.
2. Создать обычного пользователя и опрос.
3. Заблокировать пользователя.
4. Проверить невозможность использовать старую сессию.
5. Удалить опрос moderator'ом.
6. Проверить исчезновение опроса в открытых вкладках.
7. Проверить audit log под superadmin и отказ под moderator.

## 17. Этапы поставки

### Phase 1 — Backend foundation

- migration для role и audit log;
- permission resolver и актуальная проверка user status;
- bootstrap первого superadmin;
- integration tests authorization.

### Phase 2 — User and content moderation

- admin user/poll/comment repositories, services и routes;
- block/unblock/delete;
- audit transaction helper;
- realtime events.

### Phase 3 — Flutter admin UI

- capabilities в session;
- Admin section Users/Polls;
- confirmations, reasons и error states;
- realtime refresh/removal.

### Phase 4 — Superadmin audit and hardening

- audit viewer;
- role management;
- rate limits, security logs и smoke-test сценарии;
- review публичных DTO и утечек данных.

## 18. Открытые решения перед реализацией

1. Нужно ли в MVP разрешать moderator блокировать обычных пользователей, или
   только удалять контент?
2. Должен ли `user.delete` быть только soft-delete и доступен только
   superadmin? В этом PRD принято именно такое поведение.
3. Должны ли moderator видеть email пользователей в admin UI? Рекомендация —
   нет, если email не нужен для модерации.
4. Какой retention period нужен для audit log? Для MVP записи бессрочны в
   базе, отдельная политика хранения выносится в следующую задачу.

## 19. Метрики успеха

- 100% admin mutations проходят server-side permission check.
- 100% успешных admin mutations имеют audit record.
- 0 случаев, когда blocked user выполняет authenticated mutation после
  проверки статуса.
- 0 расхождений между списками после realtime content deletion.
- Все acceptance и security integration tests проходят в CI.
