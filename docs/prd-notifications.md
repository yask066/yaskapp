# PRD: Уведомления Yaskapp

## 1. Цель

Создать единый центр уведомлений, который информирует пользователя о важных
действиях вокруг его контента и социальных связей. Уведомления должны быть
доступны в приложении после перезапуска, обновляться в реальном времени и не
создавать дубликаты при повторной доставке событий.

## 2. Контекст текущего проекта

- Backend: Fastify/TypeScript, PostgreSQL, Redis, WebSocket.
- Mobile: Flutter.
- В PostgreSQL уже существует таблица `notifications` с типами
  `poll_vote`, `comment`, `comment_reply`, `like`, `follow`.
- В приложении уже есть `RealtimeClient`, но он обрабатывает только события
  опросов, комментариев и модерации.
- Push-провайдер для iOS/Android пока не подключен.

## 3. Цели и метрики

### Цели

1. Пользователь видит все непрочитанные уведомления в одном inbox.
2. Новые уведомления появляются без ручного обновления при активном WebSocket.
3. Состояние прочитанности сохраняется на backend и синхронизируется между
   устройствами.
4. Повторная обработка одного события не создает дубликаты.
5. Пользователь может управлять типами уведомлений и push-доставкой.

### Метрики успеха

- 0 дубликатов при повторной доставке одного domain-события.
- Не менее 99% созданных in-app уведомлений доступны после перезапуска клиента.
- Счетчик непрочитанных уведомлений одинаков на всех авторизованных клиентах.
- Все операции чтения/изменения уведомлений защищены авторизацией владельца.

## 4. Пользовательские сценарии

1. Пользователь открывает приложение и видит badge с количеством непрочитанных
   уведомлений.
2. Пользователь открывает экран Notifications и видит список от новых к старым.
3. Нажатие на уведомление помечает его прочитанным и открывает связанный объект:
   опрос, комментарий или профиль.
4. Пользователь нажимает Mark all as read.
5. Пользователь получает уведомление, когда:
   - кто-то проголосовал в его опросе;
   - кто-то прокомментировал его опрос;
   - кто-то ответил на его комментарий;
   - кто-то поставил лайк его опросу или комментарию;
   - кто-то подписался на него.
6. Если связанный контент удален или стал недоступен, уведомление остается в
   истории, но открытие показывает безопасное состояние «Content unavailable».
7. Пользователь меняет настройки типов уведомлений и push-доставки.

## 5. Объем первой версии

### Входит в MVP

- In-app inbox с cursor pagination.
- Непрочитанный счетчик.
- Mark one as read и Mark all as read.
- Создание уведомлений на backend в тех же транзакциях, что и исходное
  действие, где это возможно.
- Idempotency для повторной обработки domain-событий.
- WebSocket-события для новых уведомлений и изменения unread-счетчика.
- Flutter-экран, badge и переходы к связанным сущностям.
- Безопасная обработка удаленного/недоступного контента.

### Не входит в MVP

- Email-уведомления.
- SMS.
- Push через FCM/APNs.
- Группировка уведомлений в сложные агрегаты вроде «5 пользователей поставили
  лайк».
- Полнотекстовый поиск по уведомлениям.

## 6. Типы уведомлений

| Тип | Получатель | Связь | Текстовый шаблон |
|---|---|---|---|
| `poll_vote` | автор опроса | poll | `@user voted in your poll` |
| `comment` | автор опроса | poll, comment | `@user commented on your poll` |
| `comment_reply` | автор родительского комментария | poll, comment | `@user replied to your comment` |
| `like` | автор объекта | poll или comment | `@user liked your poll/comment` |
| `follow` | пользователь | actor | `@user started following you` |

Ограничения:

- self-notifications не создаются;
- actor может быть `NULL`, если пользователь удален;
- private/restricted payload не отправляется в WebSocket;
- текст и имя actor формируются из актуальных данных при отображении, а не
  доверяются клиенту.

## 7. Data model

Сохранить существующую таблицу `notifications`, расширив ее миграциями:

- добавить стабильный `event_key` или `deduplication_key` с уникальным индексом;
- добавить `entity_type` при необходимости для безопасной навигации;
- сохранить `payload` только для минимальных идентификаторов и параметров
  отображения;
- добавить индексы для `(recipient_user_id, read_at, created_at DESC, id)` и
  cursor pagination;
- не удалять уведомления каскадно при удалении poll/comment: ссылки должны
  стать недоступными, а история сохраниться;
- предусмотреть retention policy для старых уведомлений отдельной фоновой
  задачей, например 180 дней после подтверждения нагрузки.

Рекомендуемый deduplication key:

`<event-type>:<source-event-id>:<recipient-user-id>`

Если одно действие легитимно должно создать несколько уведомлений, source event
ID должен быть разным.

## 8. Backend API

Все endpoint’ы требуют авторизованный access token и работают только с
уведомлениями текущего пользователя.

### Получение списка

`GET /notifications?limit=25&cursor=<cursor>&unreadOnly=<bool>`

Ответ:

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "comment",
      "actor": {
        "id": "uuid",
        "username": "ada",
        "displayName": "Ada",
        "avatarUrl": null
      },
      "pollId": "uuid",
      "commentId": "uuid",
      "readAt": null,
      "createdAt": "2026-08-28T12:00:00.000Z",
      "isTargetAvailable": true
    }
  ],
  "nextCursor": "opaque-cursor-or-null",
  "unreadCount": 3
}
```

### Пометить одно прочитанным

`POST /notifications/:id/read`

- `204` при успешной операции;
- повторный вызов безопасен;
- чужой ID не раскрывается: ответ `404`.

### Пометить все прочитанными

`POST /notifications/read-all`

- атомарно помечает все непрочитанные уведомления текущего пользователя;
- повторный вызов безопасен;
- возвращает новый `unreadCount`.

### Возможные ошибки

- `401` — нет/недействителен access token;
- `404` — уведомление не принадлежит пользователю или удалено политикой
  retention;
- `422` — некорректный cursor или limit;
- `429` — превышен rate limit для массовых операций.

## 9. Создание и доставка

1. Domain-операция выполняется в PostgreSQL transaction.
2. В этой же transaction создается notification через `INSERT ... ON CONFLICT
   DO NOTHING`.
3. После успешного commit публикуется внутреннее событие в Redis/outbox.
4. Realtime hub доставляет событие только авторизованному получателю.
5. Если WebSocket недоступен, уведомление не теряется: клиент загрузит его из
   inbox при следующем запросе.

Для операций, которые уже имеют транзакционный repository, запись уведомления
должна быть частью того же transaction boundary. Для будущих асинхронных
операций использовать outbox-паттерн, чтобы не публиковать событие до commit.

## 10. Realtime contract

### Новое уведомление

```json
{
  "type": "notification.created",
  "payload": {
    "notification": {
      "id": "uuid",
      "type": "follow",
      "actorId": "uuid",
      "pollId": null,
      "commentId": null,
      "createdAt": "2026-08-28T12:00:00.000Z"
    },
    "unreadCount": 4
  }
}
```

### Изменение прочитанности

```json
{
  "type": "notification.read",
  "payload": {
    "notificationId": "uuid",
    "unreadCount": 3
  }
}
```

События не должны содержать email, password, moderation reason, полный текст
комментария или приватные поля профиля. При переподключении клиент выполняет
синхронизацию через HTTP, а не пытается восстановить пропущенные события.

## 11. Flutter UX

- В основной навигации отображается иконка колокольчика с badge только при
  `unreadCount > 0`.
- Экран имеет состояния loading, empty, error, content и pagination loading.
- Непрочитанные элементы имеют легкий фон/маркер, но сохраняют доступность и
  контраст.
- Нажатие на элемент:
  1. оптимистично помечает уведомление прочитанным;
  2. вызывает backend mutation;
  3. открывает poll/comment/profile, если target доступен;
  4. показывает безопасный fallback, если target недоступен.
- Ошибка mark-as-read не должна удалять уведомление локально; после ошибки
  состояние синхронизируется с backend.
- При открытом экране новые уведомления добавляются сверху без сброса позиции
  прокрутки пользователя.

## 12. Настройки уведомлений

После MVP добавить endpoint и экран настроек:

`GET /notification-preferences`

`PATCH /notification-preferences`

Настройки по каждому типу должны иметь независимые флаги `inApp` и `push`.
Отключение типа предотвращает создание соответствующего уведомления, кроме
обязательных системных сообщений. Изменение настроек идемпотентно.

## 13. Push-доставка, Phase 2

- зарегистрировать device token на backend;
- хранить несколько устройств пользователя с платформой, последней активностью
  и revoked state;
- FCM для Android и APNs для iOS через отдельный notification worker;
- удалять/отзывать недействительные токены по ответу провайдера;
- deep link из push в poll/comment/profile;
- не помещать приватный текст в payload push;
- применять пользовательские настройки и quiet hours.

## 14. Безопасность и надежность

- Проверять recipient ownership на backend, не полагаться на Flutter.
- Не принимать от клиента `recipientUserId`, `actorUserId` или тип связанного
  объекта для создания уведомления.
- Не отправлять уведомления заблокированным/удаленным получателям.
- Учитывать block/privacy rules при формировании notification.
- Защитить list и mark-all rate limits от злоупотребления.
- Логировать технические ошибки без текста уведомления и персональных данных.
- Все операции создания, read-state и unread counter должны быть устойчивы к
  повторным HTTP-запросам и повторной доставке Redis/WebSocket.

## 15. Тестирование и acceptance criteria

### Backend

- repository tests для cursor pagination, unread count и ownership;
- transaction tests: domain action + notification commit/rollback;
- idempotency tests для повторного source event;
- endpoint tests для `401`, `404`, `422`, `429` и повторных запросов;
- tests на отсутствие self-notifications;
- realtime tests на recipient isolation и safe payload;
- tests на удаленный target без падения inbox.

### Flutter

- отображение badge и unread count;
- loading/empty/error states;
- mark one/read-all с pending state;
- добавление realtime-уведомления без потери текущего scroll position;
- пагинация cursor и отсутствие дублей;
- навигация к poll/comment/profile и fallback для недоступного target;
- восстановление inbox после перезапуска приложения.

### Definition of Done для MVP

- уведомления создаются для всех пяти MVP-событий;
- список и unread count доступны через HTTP;
- realtime работает при активном WebSocket, а offline-сценарий восстанавливается
  через HTTP;
- повторные действия не создают дубликаты;
- сервер изолирует уведомления разных пользователей;
- целевые backend и Flutter тесты проходят;
- API и realtime contracts документированы.

Phase 1 foundation is limited to inbox persistence and authenticated read-state
operations. Notification producers, realtime delivery, and Flutter UI remain in
the following phases.

## 16. План реализации

1. **Phase 1 — Backend foundation:** миграции/dedup key, repository, cursor API,
   unread count, read mutations.
2. **Phase 2 — Domain integration:** подключение vote/comment/reply/like/follow
   с транзакционным созданием уведомлений.
3. **Phase 3 — Realtime:** recipient-scoped hub events, reconnect sync и тесты
   payload isolation.
4. **Phase 4 — Flutter inbox:** экран, badge, pagination, read actions и deep
   links.
5. **Phase 5 — Preferences:** per-type in-app/push settings.
6. **Phase 6 — Push:** device tokens, worker, FCM/APNs и deep links.
7. **Phase 7 — Hardening:** rate limits, retention, metrics, observability и
   end-to-end smoke tests.

## 17. Открытые решения перед реализацией

- Точный retention period: 90, 180 или 365 дней.
- Нужна ли агрегация частых лайков/голосов в одну запись.
- Нужно ли сохранять уведомление при удалении actor или полностью обезличивать
  его.
- Провайдер push-доставки и способ хранения секретов FCM/APNs.
- Нужны ли quiet hours в первой версии push.
