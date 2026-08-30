# Yaskapp — handoff-контекст

Дата: 30 августа 2026 года  
Рабочая папка: `D:\yaskapp`

## Структура

- Flutter: `apps/mobile`
- Backend Node.js/TypeScript: `services/api`
- Docker staging: `infra/docker`
- Moderation web-панель

Backend развёрнут на VPS в `/opt/yaskapp`.

## Уведомления

Реализованы:

- notifications, notification devices и push jobs;
- cursor pagination;
- mark one/all as read;
- notification preferences;
- realtime WebSocket-события;
- FCM push через Firebase Admin SDK;
- Docker `notification-worker` с retry/backoff;
- обработка невалидных FCM-токенов;
- проверка Firebase service-account JSON;
- credentials подключаются только к `notification-worker`;
- ошибки worker не скрываются через `|| true`.

Service-account JSON не хранится в Git. На VPS он должен находиться в:

`/opt/yaskapp/infra/docker/secrets/firebase-service-account.json`

## Flutter-конфигурация

Подключены `firebase_core`, `firebase_messaging`, Firebase Gradle Plugin в Kotlin DSL и `google-services.json` в `apps/mobile/android/app`.

Текущий staging API:

```text
http://5.44.44.197
ws://5.44.44.197/realtime
```

Запуск приложения:

```powershell
cd D:\yaskapp\apps\mobile
flutter run -d I2407 `
  --dart-define=API_BASE_URL=http://5.44.44.197 `
  --dart-define=API_WEBSOCKET_URL=ws://5.44.44.197/realtime
```

FCM-токен автоматически регистрируется после входа и отзывается при logout.

## Notifications UI

В `apps/mobile/lib/src/features/notifications/notifications_screen.dart` есть группы `New`/`Earlier`, подробная карточка, аватары, тип, дата, связанный объект, refresh, pagination и realtime-обновления.

Уведомления загружаются только после активации вкладки Notifications. После её открытия они автоматически отмечаются прочитанными. Кнопка `Mark all read` удалена.

Если пользователь уходит со вкладки во время загрузки, `mark-all-read` не вызывается.

В `HomeScreen` badge:

- получает `unreadCount` при запуске главной страницы;
- обнуляется сразу после перехода на Notifications;
- не восстанавливает старое значение из запоздалого ответа;
- обновляется realtime-событиями.

## Последнее изменение

Размер выпадающего меню настроек профиля увеличен с `144 px` до `220 px`, чтобы полностью помещались `Notifications`, `My reports`, `Edit profile` и `Logout`.

## Проверки

Последние targeted-тесты:

```text
notifications_screen_test.dart — 5 passed
home_navigation_test.dart — 2 passed
profile settings menu width test — 1 passed
```

Запуск:

```powershell
cd D:\yaskapp\apps\mobile
flutter test --no-pub test/notifications_screen_test.dart
flutter test --no-pub test/home_navigation_test.dart
flutter test --no-pub test/profile_screen_test.dart
```

Полный `profile_screen_test.dart` ранее имел 2 нестабильных UI-теста, не связанных с меню.

## Известные моменты

1. Warning про KGP у `firebase_core` не блокирует сборку.
2. На Windows Flutter иногда требует доступ к `C:\Users\user\AppData\Local\.dartServer`.
3. Локальная база ранее имела расхождение checksum migration 025; migration guard останавливает `npm test`.
4. Для показа системного уведомления при открытом Android-приложении нужна отдельная local notifications-интеграция; в фоне FCM работает.

## Продолжение работы

```powershell
cd D:\yaskapp
git status
git diff --check
```

Не добавлять в Git service-account JSON, `.env` и другие секреты.
