# PRD: Закрытая web-панель модерации и система жалоб

**Статус:** Draft  
**Дата:** 2026-08-25  
**Продукт:** Yaskapp  
**Владелец:** Product / Trust & Safety

## 1. Краткое описание

Yaskapp должна получить отдельную закрытую web-панель, через которую
модераторы и superadmin обрабатывают жалобы пользователей и принимают
санкции в отношении контента и аккаунтов.

Мобильное приложение не является административной панелью. Обычный пользователь
не должен видеть или использовать moderation UI. При этом backend остаётся
единственным источником истины: удаление web-панели, подмена URL или ручной HTTP
запрос не должны давать доступ к административным операциям.

## 2. Проблема и контекст

Текущий Admin UI встроен в Flutter-приложение. Это неудобно для полноценной
модерации и создаёт риск ошибочного отображения административных функций
обычному пользователю.

В проекте уже существуют:

- JWT-аутентификация и серверная проверка статуса пользователя;
- роли `user`, `moderator`, `superadmin`;
- server-side permissions для `/admin/*`;
- soft-delete пользователей, опросов и комментариев;
- PostgreSQL audit log;
- rate limit административных destructive-операций;
- security/application logging неуспешных admin-запросов;
- realtime-события модерации и удаления контента.

Новая система должна использовать эти backend-механизмы и не переносить
проверку прав в web-клиент.

## 3. Цели

1. Дать модераторам единую рабочую очередь жалоб.
2. Обеспечить безопасный доступ к панели только сотрудникам с нужными правами.
3. Позволить удалять контент, выдавать страйки, ограничения и блокировки.
4. Сохранять полную историю жалобы, решения и действий модератора.
5. Сделать санкции единообразными и проверяемыми на backend.
6. Исключить доступ обычных пользователей к panel UI и moderation API.
7. Поддержать повторную обработку, апелляции и защиту от гонок.

## 4. Не входит в MVP

- автоматическая модерация, ML и keyword-фильтры;
- бан по IP, устройству или fingerprint;
- публичный рейтинг модераторов;
- массовые операции над тысячами объектов;
- внешняя SIEM-интеграция;
- сложная workflow-маршрутизация по командам;
- восстановление физически удалённых данных;
- полноценная аналитика качества модерации;
- самостоятельная регистрация модераторов через web-панель.

## 5. Архитектура и границы доступа

### 5.1 Компоненты

```text
Flutter mobile app
  └── POST /reports                 пользователь создаёт жалобу

Moderation web app
  └── /moderation/*                 закрытый интерфейс сотрудников

API backend
  ├── /reports                      пользовательские жалобы
  ├── /moderation/*                 cases, sanctions, appeals
  └── /admin/*                      низкоуровневые защищённые операции

PostgreSQL
  ├── reports / moderation_cases
  ├── sanctions / user_strikes
  └── audit log
```

Рекомендуемый production-домен: `moderation.yaskapp.com` или внутренний
VPN-only домен. Web-панель не должна собираться в мобильный APK.

### 5.2 Доступ

- `user` имеет доступ только к созданию и просмотру собственных жалоб в
  разрешённом объёме;
- `moderator` получает доступ к назначенной очереди и разрешённым санкциям;
- `superadmin` получает полный доступ, включая роли, audit и настройки policy;
- роли назначаются только через server-side bootstrap/CLI или защищённую
  superadmin-операцию;
- отсутствие или истёкшая сессия web-панели даёт `401`;
- недостаточный permission даёт `403`;
- скрытие кнопки в UI не считается проверкой доступа.

Рекомендуемый production hardening:

- отдельная web-сессия с короткоживущим access token;
- обязательная MFA для moderator и superadmin;
- optional IP allowlist/VPN для панели;
- отдельный cookie scope и CSRF-защита для cookie-based web auth;
- CSP, secure/httpOnly cookies и запрет хранения admin token в localStorage.

## 6. Роли и permissions

| Permission | user | moderator | superadmin |
|---|:---:|:---:|:---:|
| `reports.create` | ✓ | ✓ | ✓ |
| `moderation.queue.read` | — | ✓ | ✓ |
| `moderation.case.read` | — | ✓ | ✓ |
| `moderation.case.assign` | — | ✓ | ✓ |
| `moderation.case.resolve` | — | ✓ | ✓ |
| `moderation.content.delete` | — | ✓ | ✓ |
| `moderation.strike.issue` | — | ✓ | ✓ |
| `moderation.restriction.issue` | — | ✓ | ✓ |
| `moderation.user.ban` | — | ✓* | ✓ |
| `moderation.appeal.read` | — | ✓ | ✓ |
| `moderation.appeal.resolve` | — | — | ✓ |
| `moderation.audit.read` | — | — | ✓ |
| `moderation.policy.update` | — | — | ✓ |
| `admin.users.roles.update` | — | — | ✓ |

`*` Возможность moderator выдавать permanent ban должна быть отдельной policy
настройкой. В MVP moderator может выдавать временные ограничения, а
permanent ban подтверждает superadmin.

## 7. Жалобы пользователей

### 7.1 Создание жалобы

Пользователь может пожаловаться на:

- опрос;
- комментарий;
- пользователя.

Обязательные поля:

- `targetType`;
- `targetId`;
- `category`;
- краткое описание;
- optional evidence metadata без секретов и приватных токенов.

Категории MVP:

- spam;
- harassment;
- hate_or_discrimination;
- sexual_content;
- violence_or_threat;
- fraud_or_scam;
- impersonation;
- other.

Ограничения:

- пользователь не может отправить одинаковую активную жалобу на тот же объект
  повторно;
- текст ограничивается по длине;
- нельзя жаловаться на несуществующий или недоступный объект;
- собственная жалоба не раскрывает внутренние данные других пользователей;
- rate limit применяется по actor и target.

### 7.2 Статусы жалобы

```text
open -> triaged -> in_review -> resolved
                         └── dismissed
                         └── escalated
```

Допустимые состояния:

- `open` — новая жалоба;
- `triaged` — проверена и попала в очередь;
- `in_review` — назначен модератор;
- `resolved` — решение принято и применено;
- `dismissed` — нарушение не подтверждено;
- `escalated` — передана superadmin;
- `duplicate` — объединена с другим кейсом.

Изменение статуса и причины должно записываться в audit.

## 8. Moderation case и очередь

Жалоба превращается в `moderation_case`. Один case может объединять несколько
одинаковых жалоб на один target.

Карточка case содержит:

- target и его текущий статус;
- все связанные жалобы;
- историю предыдущих нарушений target/user;
- активные и истёкшие санкции;
- текущего владельца case;
- priority и SLA deadline;
- внутренние заметки модераторов;
- историю решений и audit entries.

Фильтры очереди:

- статус;
- категория;
- priority;
- target type;
- assigned moderator;
- дата создания и дата последнего изменения;
- наличие предыдущих strikes;
- cursor pagination.

Сортировка по умолчанию — priority, затем SLA deadline, затем created date.

Назначение case должно быть атомарным: два модератора не должны одновременно
получить право на единственное активное решение без явного takeover.

## 9. Санкции

### 9.1 Типы санкций

| Санкция | Target | Эффект |
|---|---|---|
| `warning` | user | уведомление без ограничения |
| `strike` | user | фиксирует подтверждённое нарушение |
| `posting_restriction` | user | запрещает создание контента на период |
| `comment_restriction` | user | запрещает комментарии на период |
| `temporary_ban` | user | запрещает вход и authenticated API до даты |
| `permanent_ban` | user | бессрочно блокирует аккаунт |
| `content_removal` | poll/comment | soft-delete контента |

Каждая санкция содержит:

- тип;
- actor;
- причину;
- source case;
- createdAt;
- `startsAt`;
- `expiresAt` для временной санкции;
- status `active`, `expired`, `revoked`;
- optional metadata без секретов.

### 9.2 Strikes и policy

Strikes — отдельные записи, а не только счётчик в `users`.

Рекомендуемая базовая policy:

- первый подтверждённый случай — warning или 1 strike;
- 2 активных strikes — временное ограничение публикации;
- 3 активных strikes — temporary ban;
- повторные тяжёлые нарушения могут сразу эскалироваться в permanent ban;
- strike может истекать после configurable retention period;
- тяжелые категории могут иметь повышенный вес.

Пороги и сроки должны храниться в moderation policy и изменяться только
superadmin. Применение санкции и обновление strike state выполняются одной
PostgreSQL transaction.

### 9.3 Permanent ban

Permanent ban должен:

- переводить пользователя в `blocked` или отдельный `banned` статус;
- отзывать refresh tokens/sessions;
- блокировать login и authenticated requests;
- блокировать создание нового контента;
- сохранять профиль и историю для audit/appeal;
- быть идемпотентным;
- требовать обязательную причину и подтверждение.

Разблокировка permanent ban — только через отдельный superadmin workflow с
обязательной причиной.

## 10. Апелляции

Пользователь должен иметь возможность подать апелляцию на активную санкцию.

MVP:

- одна активная апелляция на одну санкцию;
- текст апелляции обязателен;
- moderator может просматривать, но не принимать финальное решение по
  permanent ban;
- superadmin может `uphold`, `reduce`, `revoke` или `request_more_info`;
- решение по апелляции не удаляет исходный audit trail.

## 11. Web UI

Основные разделы закрытой панели:

1. Login/MFA.
2. Moderation queue.
3. Case details.
4. Reports.
5. Users and sanctions.
6. Content review.
7. Appeals.
8. Audit log — superadmin only.
9. Moderation policy — superadmin only.

Обязательные UX-правила:

- destructive action требует подтверждение и причину;
- permanent ban требует дополнительного явного подтверждения;
- недоступные действия скрываются по capabilities, но backend всегда проверяет
  permission;
- после действия UI показывает request/case result, а не предполагает успех;
- конфликт назначения или устаревшие данные показываются как recoverable error;
- долгие списки используют cursor pagination;
- все даты и статусы отображаются с часовым поясом и локализацией.

## 12. Backend API

Все moderation endpoints требуют JWT web-сессии и server-side permission.

### Reports

```text
POST /reports
GET  /reports/mine
GET  /reports/:reportId
```

### Queue and cases

```text
GET   /moderation/cases?status=&category=&priority=&assigneeId=&cursor=
GET   /moderation/cases/:caseId
POST  /moderation/cases/:caseId/assign
POST  /moderation/cases/:caseId/takeover
POST  /moderation/cases/:caseId/resolve
POST  /moderation/cases/:caseId/dismiss
POST  /moderation/cases/:caseId/escalate
POST  /moderation/cases/:caseId/notes
```

### Actions

```text
POST /moderation/content/:type/:id/remove
POST /moderation/users/:userId/warning
POST /moderation/users/:userId/strike
POST /moderation/users/:userId/restriction
POST /moderation/users/:userId/temporary-ban
POST /moderation/users/:userId/permanent-ban
POST /moderation/sanctions/:sanctionId/revoke
```

### Appeals and audit

```text
POST /appeals
GET  /moderation/appeals?status=&cursor=
POST /moderation/appeals/:appealId/resolve
GET  /moderation/audit?action=&actorId=&targetType=&targetId=&from=&to=&cursor=
```

Mutation requests должны поддерживать `Idempotency-Key`. Повтор того же
запроса не должен выдать второй strike, вторую санкцию или вторую audit-запись.

## 13. Модель данных и миграции

Рекомендуемые таблицы:

### `reports`

- `id` UUID;
- `reporter_user_id`;
- `target_type`, `target_id`;
- `category`, `description`;
- `status`;
- `case_id`;
- `created_at`, `updated_at`.

### `moderation_cases`

- `id` UUID;
- `status`, `priority`;
- `assigned_to_user_id`;
- `target_type`, `target_id`;
- `resolution_code`, `resolution_note`;
- `created_at`, `updated_at`, `resolved_at`.

### `moderation_case_reports`

Связь many-to-one между reports и case с уникальным report в case.

### `moderation_notes`

Внутренние заметки, доступные только moderation staff.

### `sanctions`

- `id`, `user_id`, `case_id`;
- `type`, `status`;
- `reason`, `metadata`;
- `starts_at`, `expires_at`;
- `created_by_user_id`, `revoked_by_user_id`;
- `created_at`, `revoked_at`.

### `user_strikes`

- `id`, `user_id`, `case_id`, `sanction_id`;
- `severity`, `status`;
- `expires_at`;
- `created_at`.

### `appeals`

- `id`, `sanction_id`, `user_id`;
- `status`, `reason`, `decision_note`;
- `resolved_by_user_id`;
- `created_at`, `resolved_at`.

Добавить индексы по status/priority, target, assignee, user_id, created_at и
expires_at. Все migration scripts должны быть backward-compatible.

## 14. Транзакции и консистентность

Следующие действия выполняются в одной PostgreSQL transaction:

- claim/assign case;
- resolve case + создать sanction/strike;
- content removal + audit;
- ban + revoke sessions + audit;
- revoke sanction + восстановить доступ + audit;
- решение appeal + изменение sanction + audit.

При ошибке audit или любой части mutation все изменения откатываются.

После успешного commit публикуется realtime-событие. До commit realtime
событие не отправляется.

## 15. Audit и security logging

Audit должен фиксировать:

- создание и объединение жалобы;
- изменение case status;
- assignment/takeover;
- каждую санкцию;
- удаление и восстановление контента;
- решения по апелляциям;
- изменение moderation policy.

Неуспешные попытки доступа и rate-limit события попадают в structured
application/security logs с request ID, actor ID если он известен, route и
status. Body, токены и полные тексты приватных полей в log не записываются.

Audit append-only: API не предоставляет update/delete для audit records.

## 16. Безопасность

- backend проверяет JWT, актуальный статус пользователя и permission на каждом
  protected endpoint;
- обычный user получает `403` на все `/moderation/*` и внутренние `/admin/*`;
- moderator не может назначить себе роль или выдать себе санкцию;
- moderator не может изменить или удалить audit;
- permanent ban и policy update доступны только superadmin;
- все destructive endpoints защищены rate limit и idempotency;
- mutation выполняется с актуальной проверкой actor в transaction;
- SQL-запросы параметризованы;
- report description, notes и reasons ограничены по длине и очищаются от
  неподдерживаемых payloads;
- внутренние notes, IP и email не попадают в public DTO;
- web-панель имеет отдельный origin и deployment pipeline;
- CORS разрешает только web-panel origin для moderation API.

## 17. Realtime-события

Минимальные события:

```text
moderation.case_updated       { caseId, status }
moderation.sanction_created   { userId, sanctionType }
moderation.sanction_revoked   { userId, sanctionId }
moderation.content_removed    { targetType, targetId }
```

События не содержат reason, внутренние notes, email, token или audit metadata.
Повторная доставка должна быть безопасной.

## 18. Критерии приёмки

### Access control

- [ ] Обычный пользователь не видит ссылку или route web-панели.
- [ ] Обычный пользователь получает `403` при прямом запросе к moderation API.
- [ ] Moderator видит только разрешённые разделы и действия.
- [ ] Superadmin видит audit, appeals и policy settings.
- [ ] Backend не доверяет capabilities из frontend.

### Reports and cases

- [ ] Пользователь может создать жалобу на poll/comment/user.
- [ ] Дублирующая активная жалоба не создаётся.
- [ ] Жалоба попадает в очередь и связывается с case.
- [ ] Case можно назначить, взять в takeover и закрыть.
- [ ] Два модератора не могут одновременно получить конфликтующее решение.

### Sanctions

- [ ] Strike, restriction и ban требуют reason и source case.
- [ ] Повтор idempotent-запроса не создаёт вторую санкцию.
- [ ] Активный ban блокирует login и authenticated requests.
- [ ] Permanent ban требует superadmin или настроенного отдельного permission.
- [ ] Revoked/expired sanction больше не блокирует пользователя.
- [ ] Каждая санкция имеет audit record.

### Transactions and audit

- [ ] Mutation и audit commit/rollback выполняются атомарно.
- [ ] Неуспешные попытки доступа не создают успешный audit action.
- [ ] Audit нельзя изменить или удалить через API.
- [ ] После commit realtime-событие доставляется без приватных данных.

### Appeals

- [ ] Пользователь может создать одну активную апелляцию на санкцию.
- [ ] Moderator может просматривать апелляцию.
- [ ] Только superadmin может принять финальное решение по permanent ban.
- [ ] Решение сохраняет первоначальный audit trail.

## 19. Тестирование

Backend:

- permission matrix для user/moderator/superadmin;
- integration-тесты всех reports/cases/sanctions/appeals endpoints;
- тесты прямого доступа обычного пользователя к web moderation API;
- тесты duplicate reports и idempotency keys;
- тесты last-superadmin и permanent-ban protection;
- transaction rollback для каждой mutation + audit;
- concurrency tests для assignment и выдачи strike;
- blocked/temporary/permanent session tests;
- тесты отсутствия приватных полей в public DTO и realtime payloads.

Web:

- route guard и redirect без staff session;
- capability-based visibility;
- reason/confirmation flows;
- queue filters, cursor pagination и stale case handling;
- обработка `401`, `403`, `404`, `409`, `429`.

E2E smoke:

1. User создаёт жалобу на комментарий.
2. Жалоба появляется в закрытой очереди.
3. Moderator назначает case и удаляет комментарий.
4. Пользователь видит, что контент удалён, без внутренних деталей кейса.
5. Moderator выдаёт strike.
6. Policy автоматически применяет ограничение после порога.
7. Superadmin видит audit и принимает апелляцию.
8. Обычный пользователь не может открыть panel route или вызвать API.

## 20. Этапы поставки

### Phase 1 — Reports foundation

- reports/cases migrations;
- POST `/reports` и пользовательская история;
- basic queue API;
- permissions и web authentication foundation.

### Phase 2 — Closed moderation panel

- отдельный web app и deployment;
- queue, case detail, assignment;
- content review и soft-delete;
- audit integration.

### Phase 3 — Sanctions

- strikes, restrictions, temporary ban;
- session revocation;
- policy evaluation;
- rate limit/idempotency/concurrency hardening.

### Phase 4 — Permanent bans and appeals

- permanent ban workflow;
- appeals;
- superadmin approvals;
- realtime updates и E2E smoke tests.

### Phase 5 — Flutter cleanup

- убрать встроенный Admin UI из обычной mobile-навигации;
- оставить только пользовательскую кнопку Report;
- удалить client-side admin capability probing, если оно больше не нужно;
- сохранить server-side `/admin/*` только как внутренний API для panel/backend.

## 21. Открытые решения

1. Будет ли web-панель доступна через VPN или публичный домен с MFA?
2. Может ли moderator выдавать temporary ban без подтверждения superadmin?
3. Каков срок истечения strike: 30, 90 или 180 дней?
4. Нужно ли показывать пользователю категорию и статус собственной жалобы?
5. Должен ли permanent ban менять `users.status` на отдельный enum `banned`?
6. Каков SLA для priority `high` и `critical`?
7. Нужна ли возможность назначать case конкретной команде/региону?

## 22. Метрики успеха

- 100% moderation mutations проходят server-side permission check.
- 100% санкций и решений имеют audit record.
- 0 успешных обращений обычного пользователя к moderation API.
- 0 дублей санкций при повторной доставке запроса.
- 0 случаев рассинхронизации sanction state и audit после rollback.
- Медианное время от жалобы до triage измеряется и снижается после запуска.
- Все acceptance, concurrency и E2E smoke-тесты проходят в CI.
