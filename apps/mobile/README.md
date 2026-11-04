# Мобильное приложение

Сначала подготовить API по [корневому README](../../README.md#локальный-запуск).
Команды выполняются из `apps/mobile`:

```sh
flutter pub get
flutter run --dart-define=API_BASE_URL=http://192.168.0.10:3000 --dart-define=API_WEBSOCKET_URL=ws://192.168.0.10:3000/realtime
```

Заменить `192.168.0.10` на доступный телефону адрес компьютера с API.
Для Android Emulator обычно подходит `10.0.2.2`. Оба адреса должны вести
в одно окружение; для HTTPS использовать `https://` и `wss://`.

Значения по умолчанию в [ApiConfig](lib/src/core/config/api_config.dart):
`https://api.yaskapp.org` для API и `wss://api.yaskapp.org/realtime` для WebSocket.
Для другого окружения задавать `API_BASE_URL` и `API_WEBSOCKET_URL` через
`--dart-define`. После изменения адресов нужно пересобрать приложение;
существующая установленная сборка продолжит использовать прежние значения.

## Флаги сборки

`YASKAPP_FEED_PAGINATION`, `YASKAPP_REACTIONS_MOTION` и `YASKAPP_ENTRY_MOTION`
по умолчанию `false`. Пример проверки реакций:

```sh
flutter run --dart-define=API_BASE_URL=http://192.168.0.10:3000 --dart-define=API_WEBSOCKET_URL=ws://192.168.0.10:3000/realtime --dart-define=YASKAPP_REACTIONS_MOTION=true
```

Те же `--dart-define` используются с `flutter build apk` или
`flutter build appbundle --release`. Для отката нужно собрать и распространить
новую версию с `false` или без флага; удалённого переключателя нет.

Проверки и ограничения выпуска — в [общем чек-листе](../../docs/staging-smoke-test.md).
