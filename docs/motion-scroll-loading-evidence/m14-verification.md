# M14: Flutter scroll integration verification

Дата: 6 октября 2026 года (UTC+3).

## Реализация

- Добавлен `ListScrollAnchorHost`, который подключает screen-owned `ScrollController` к общему ID-anchor store. `ListScrollAnchorItem` регистрирует измеряемые строки; host сохраняет первую видимую строку и восстанавливает её координату после layout/изменения списка.
- Host подключён к feed, search results, собственному и публичному профилям, subscriptions, poll comments и notifications. Контекст включает текущего пользователя, route/list и доступные query/filter/sort. В search и notifications контексты фильтров разделены.
- Загруженные элементы остаются во владении экранов и notification store. Anchor observer не вызывает read mutations и не меняет pagination. Явная comment target сохраняет приоритет над обычным restore.
- При logout scroll contexts пользователя очищаются; смена аккаунта также очищает прежний контекст.

## Проверки

| Проверка | Результат |
|---|---|
| Anchor host: удаление элементов выше видимого ID | passed; координата сохранилась в пределах 2 logical px |
| Existing `list_scroll_state_test.dart` | 12/12 passed, включая fallback после удаления anchor и нескольких строк |
| Feed, public profile, subscriptions, comments/replies, notifications и notification navigation + новый host test | 70/70 passed |
| Полный набор выбранных M14 экранных tests, включая profile/search | 95 passed, 10 известных failures, 1 skipped. Failures воспроизводят список в [аудите](../motion-scroll-loading-audit.md#15-flutter-failures-все-воспроизведены): profile `RealtimeClient` periodic timers и существующие search layout/loading ожидания. Новые тесты и затронутые целевые suites выше прошли. |
| `flutter analyze` по host/state/search/subscriptions/public profile/comments/notifications | No issues found |
| Полный `flutter analyze` | 12 прежних info/warning diagnostics; новых diagnostics в scroll host/state не выявлено |
| Android emulator smoke | не измерено: Pixel 7 AVD не запустился, установленный system image отсутствует (`Cannot find AVD system path`; ожидаемый путь `D:\android\system-images\android-37.0\google_apis_playstore_ps16k\x86_64`) |
| `git diff --check` | passed |

## Ограничения

- Физическое Android/iOS устройство недоступно; ручные viewport/keyboard smoke сценарии на устройстве не измерены. Widget tests проверили существующие keyboard composer, expanded replies, explicit comment target, unread filter, inbox arrivals/load-more и навигацию.
- Выбранный экранный test run сохраняет 10 уже зарегистрированных profile/search failures, не относящихся к новой scroll host логике; task-specific passing результат указан отдельно.
