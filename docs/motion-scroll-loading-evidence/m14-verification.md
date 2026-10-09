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

## Ограничения на момент первоначальной проверки (6 октября 2026 года)

- Физическое Android/iOS устройство недоступно; ручные viewport/keyboard smoke сценарии на устройстве не измерены. Widget tests проверили существующие keyboard composer, expanded replies, explicit comment target, unread filter, inbox arrivals/load-more и навигацию.
- Выбранный экранный test run сохраняет 10 уже зарегистрированных profile/search failures, не относящихся к новой scroll host логике; task-specific passing результат указан отдельно.

## Повторная проверка 9 октября 2026 года

- `flutter test --no-pub test/list_scroll_state_test.dart test/list_scroll_anchor_host_test.dart` — 13/13 passed.
- Feed, public profile, subscriptions, comments/replies, notifications и notification navigation: 71/71 passed.
- Profile и Search: 25 passed, 1 skipped.
- Всего по повторно запущенным M14 suites: 109 passed, 1 skipped. Десять ранее зарегистрированных profile/search failures в этом запуске не воспроизвелись.
- Фокусный `flutter analyze` по 21 M14 source/test files завершился с пятью lint/info diagnostics: три в `profile_screen.dart`, один в `feed_screen_test.dart` и один в `list_scroll_anchor_host_test.dart`. Все пять совпадают с diagnostics в M17 analyze evidence; новых diagnostics нет.
- В начале повторной проверки `adb devices -l` не обнаружил подключённых устройств. Pixel 7 AVD указывает на отсутствующий `system-images/android-37.0/google_apis_playstore_ps16k/x86_64` каталог; в Android SDK нет установленных system images. Позже физический Samsung был подключён; лицензии не принимались, SDK image не устанавливался.

**Статус после automated recheck:** automated M14 scope перепроверен; следующая попытка была отложена до входа в приложение. Итоговый device smoke указан ниже.

## Повторная попытка device smoke 9 октября 2026 года

- ADB обнаружил Samsung SM-A325F, Android 13/API 33, 1080×2400. Debug APK собран и установлен через `adb install -r`; сертификат совпал с установленной сборкой, данные приложения не удалялись.
- Приложение запустилось на Login screen. Авторизованной сессии нет, поэтому Feed/Search и authenticated list → detail → back smoke не выполнялись. Голосование, лайки и изменения уведомлений не производились.

## Device smoke пройден 9 октября 2026 года

- Телефон: Samsung SM-A325F, Android 13/API 33, 1080×2400, density 420 dpi.
- `flutter build apk --debug --no-pub` прошёл. APK установлен через `adb install -r`; сертификат debug совпал с установленным приложением, данные приложения не сбрасывались.
- На Feed прокручен список, открыт существующий poll comments, раскрыты replies. Пустой composer получил фокус; системная клавиатура показалась и скрылась, текст не вводился и не отправлялся.
- После Back вернулся Feed на прежнее место. Bounds того же видимого элемента до и после route: `[231,1134][891,1260]` — вертикальное смещение `0 physical px` (`0 logical px`). Повторный возврат после replies дал те же bounds.
- Голосование, лайки, публикация комментария и изменение уведомлений не выполнялись.

**Результат:** physical Android smoke пройден. Вместе с automated suites `109 passed / 1 skipped` и сохранёнными lint/info diagnostics M14 закрыта. AC-12 performance profiling не входил в этот smoke и остаётся отдельной проверкой M17/M26.
