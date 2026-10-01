# T02 — baseline scrolling and loading

Дата: 1 октября 2026 г.  
Проект: D:\yaskapp  
Основание: TASKS-motion-scroll-loading.md, T01 и AC-12 из PRD 1.0.

## Статус

Эталонная матрица T02 зафиксирована на 1 октября 2026 г. как воспроизводимая reference-матрица. Конкретные устройства физически в текущей среде не обнаружены; поэтому зафиксированный набор определяет цели замеров, а не наличие подключённого тестового парка. AC-12 остаётся без результатов до прогонов на этих устройствах.
## Данные

Общая JSON-фикстура: test/fixtures/t02-motion-scroll-loading-polls.json.

| ID | Длинный текст | Медиа | Votes / likes / comments |
|---|---|---|---:|
| motion-long-text | Вопрос на несколько экранных строк | Нет | 9 |
| motion-count-10 | Короткий | SVG 16:9 | 10 |
| motion-count-99 | Короткий | SVG 4:5 | 99 |
| motion-count-100-image-error | Короткий | намеренно отсутствующий ресурс | 100 |

Фикстура содержит два cursor-набора по две карточки для существующего мобильного cursor-поиска. Mock API отдаёт их через `/search`: первый запрос без cursor возвращает `motion-long-text` и `motion-count-10` с `nextCursor: "t02-page-2"`; запрос с этим cursor возвращает `motion-count-99` и `motion-count-100-image-error` с `nextCursor: null`. API ленты не поддерживает cursor; проверка не добавляет пагинацию в ленту.

## Наблюдаемое исходное поведение

- Flutter PollCard обрезает вопрос до 3 строк с многоточием. При загрузке/ошибке изображения сохраняет область с AspectRatio(16/9) и показывает placeholder при ошибке.
- Flutter FeedScreen при pending like отключает callback карточки и показывает индикатор; повторное нажатие не отправляет второй запрос. Widget-тест фиксирует это поведение.
- Web PollCard не ограничивает вопрос числом строк и рендерит изображение без заданного размера/соотношения сторон и error fallback. После ответа изображения это может сдвинуть содержимое ниже по карточке.
- Web like остаётся доступным пока mutation pending. Web-тест удерживает ответ vote, получает ответ like первым, затем отдаёт старый ответ vote. Последний содержит целую устаревшую Poll и возвращает like к false / count 9. Порядок ответов в проверке: vote-start → like-finish → vote-finish.
- Сейчас обе ленты загружают одну страницу. Навигация к poll detail и восстановление позиции в этом baseline вручную не профилировались.

## Запуск mock-сценариев

Из корня D:\yaskapp запустить API и web dev server в отдельных терминалах:

    $env:T02_SCENARIO = 'normal'
    node scripts/t02-motion-scroll-baseline-server.mjs
    npm run dev -w @yaskapp/web -- --host 0.0.0.0

Открыть http://localhost:5173. Vite проксирует API и /media на http://localhost:3000. Mock API обслуживает только тестовую фикстуру и не требует БД. SVG-файлы находятся в test/fixtures/media; /media/missing.svg преднамеренно отвечает 404.

Перед запуском API выставить T02_SCENARIO в его терминале. Для живого теста загрузки изображений можно дополнительно задать T02_MEDIA_DELAY_MS=5000: задержка применяется ко всем /media/* ответам, в том числе к намеренному 404; query-параметр процесса заставляет браузер запросить новую копию изображения.

| Режим | Воспроизводимое поведение |
|---|---|
| normal | Мгновенная выдача четырёх карточек; реакции отвечают сразу |
| delay | Ответ списка задержан на 2 секунды |
| reorder | Vote snapshot отвечает через 800 мс, like snapshot — через 100 мс; поздний полный snapshot vote воспроизводит сброс более нового like |
| error | Первый GET /polls отвечает 503; повторный запрос успешен. Использовать Retry в экране |
| timeout | GET /polls отвечает через 15 секунд. Flutter FeedScreen сообщает timeout через 10 секунд; web API client не задаёт клиентский deadline и оставляет loading до ответа |

Для Flutter указать адрес mock API при запуске: Android Emulator — --dart-define=API_BASE_URL=http://10.0.2.2:3000; физическое устройство — адрес хоста в LAN. Текущий mock server не реализует realtime WebSocket; realtime-события не входят в этот сценарий.

Автоматический web-тест с управляемым MSW gate запускается командой:

    npm run test -w @yaskapp/web -- --run src/features/feed/FeedPage.test.tsx src/components/PollCard.test.tsx src/features/polls/usePollMutations.test.tsx

Flutter widget tests — из D:\yaskapp\apps\mobile:

    flutter test --no-pub test/feed_screen_test.dart
    flutter test --no-pub

Проверка двух страниц cursor-поиска из корня D:\yaskapp:

    node --test scripts/t02-motion-scroll-baseline-server.test.mjs

Виджетный сценарий мобильного SearchScreen — из D:\yaskapp\apps\mobile:

    flutter test --no-pub test/search_screen_test.dart --plain-name "loads both T02 cursor-search pages and keeps their results"

## Результаты доступных проверок

- Web: выбранные тесты после добавления fixture/race-сценария — 30/30, 3 файла. Вывод содержал 7 MSW warnings о необработанном GET /polls?limit=20; результаты тестов при этом успешны.
- Web typecheck: npm run typecheck -w @yaskapp/web завершился успешно.
- Mock API: синтаксис Node.js проверен; normal отдаёт 4 карточки и SVG 200 / intentionally missing 404; error возвращает 503 на первый GET /polls и 4 карточки при retry.
- git diff --check завершился без ошибок; Dart formatter подтвердил форматирование feed_screen_test.dart и search_screen_test.dart.
- Cursor-поиск T02: Node HTTP-тест запустил mock server и выполнил оба реальных GET `/search`; проверены IDs обеих страниц и переход `null → t02-page-2 → null`. Мобильный виджетный сценарий выполнил запросы с cursor `[null, t02-page-2]`, показал результат второй страницы и сохранил первую после прокрутки вверх — 1/1.
- Flutter SDK: 3.44.5 stable; Dart 3.12.2.
- `flutter test --no-pub test/feed_screen_test.dart`: 11/11 прошли. Включены T02 fixture/truncation и pending-like проверки. Проверка pending like теперь утверждает, что действие скрыто под индикатором и повторный API-вызов не произошёл.
- T02 мобильный cursor-сценарий `flutter test --no-pub test/search_screen_test.dart --plain-name "loads both T02 cursor-search pages and keeps their results"`: 1/1 прошёл; обе страницы отрисованы, cursor-последовательность `[null, t02-page-2]` подтверждена.
- Полный `search_screen_test.dart`: 13/18 прошли; T02-сценарий прошёл. Упали `shows discovery sections before a query is entered`, `shows the latest successful searches in reverse chronological order`, `clears the query from the search bar`, `shows empty and retryable error states`, `filter changes preserve query and reset pagination`.
- Полный `flutter test --no-pub`: 141 прошёл, 15 упали (exit code 1; 156 тестов). Упавшие: `auth_api_client_avatar_test.dart` — `uploads avatar as multipart field avatar`; `auth_screen_test.dart` — `does not select a country by default`, `keeps selected country after registration error`; `poll_card_report_test.dart` — `renders the poll actions with hierarchy and optional edit`; `profile_screen_test.dart` — `profile opens a dedicated settings page`, `refreshes my polls when requested after a new poll is created`, `updates my poll after like response`, `removes a poll after unliking it from liked polls`, `updates my polls comments count after returning from comments`; `search_screen_test.dart` — пять сценариев выше; `widget_test.dart` — `shows auth entry point`.
- Чтобы suite мог завершиться, в `report_dialog_test.dart` тестовая навигация переведена на tap по самому dropdown и прокрутку `Cancel` в viewport; отдельный файл прошёл 1/1.
- `adb` не найден в PATH; Android/iOS устройства и эмуляторы в среде недоступны. Проверены только программные Flutter widget tests; device-run и AC-12 frame-time замеры не выполнены. T01 оставил модели и версии устройств открытыми; эталонная матрица закреплена ниже.
- Замеры длительности кадров и доли кадров за бюджетом не проводились.

### Живой web-прогон прокрутки и медиа — 1 октября 2026

Приложение открыто в Codex in-app browser: Vite `127.0.0.1:5174` → отдельный fixture API `127.0.0.1:3117`, `T02_MEDIA_DELAY_MS=5000`. Скриншоты браузера: 724 × 612 px. Это функциональный прогон web-сборки с тестовой фикстурой, не замер AC-12.

| Сценарий | Наблюдение |
|---|---|
| Лента → detail → назад | Перед открытием detail контрольная карточка `motion-count-99`: нижний край portrait image около y=214 px, варианты около y=230 px, строка действий около y=470 px. После Back видимые якоря и scrollbar совпали; сдвиг якоря — 0 px по экрану. Числовое `window.scrollY` интерфейс браузера не предоставил, поэтому сохранён экранный якорь. |
| Счётчик 9 → 10 | Like первой карточки обновился с 9 на 10; соседняя кнопка Comments визуально осталась на x≈109 px. Сдвига соседнего действия или карточки не видно. |
| Счётчик 99 → 100 | Like `motion-count-99` обновился с 99 на 100; Comments остался у x≈109 px. Сдвига соседнего действия или карточки не видно. |
| Медиа при загрузке | При ожидании SVG у `motion-count-10` область изображения отсутствовала: варианты начинались сразу под вопросом. После ответа появилась картинка шириной около 604 px; её SVG 16:9 даёт высоту около 340 px, и варианты перемещаются вниз примерно на эту высоту. |
| Ошибка медиа | `missing.svg` вернул HTTP 404 через 5,13 с. После ошибки карточка осталась без изображения и placeholder: варианты начинались сразу под вопросом, зарезервированная высота — 0. |

На этом окружении проверена только web-лента. Flutter на физическом устройстве/эмуляторе не прогонялся: `adb` и подключённые устройства отсутствуют. Замеры FPS/frame budget не проводились.

## Зафиксированная матрица

| Цель | Устройство / версия / режим | Измерение |
|---|---|---|
| Android 60 Hz | Google Pixel 8; Android 17; build CP3A.260905.009, security patch 2026-09-05; Smooth Display выключен, подтвердить 60 Hz | Flutter profile; 3 × 30 с |
| Android до 120 Hz | Тот же Pixel 8 и build; Smooth Display включён; фиксировать фактическую частоту во время прогона | Flutter profile; 3 × 30 с |
| iOS до 120 Hz, ограниченный режим | iPhone 17; iOS 27.0.1 (24A446); Settings → Accessibility → Motion → Limit Frame Rate включён, максимум 60 fps | Flutter profile; 3 × 30 с |
| iOS ProMotion | Тот же iPhone 17 и build; Limit Frame Rate выключен; фиксировать фактическую адаптивную частоту (до 120 Hz) | Flutter profile; 3 × 30 с |
| Chromium desktop | Windows 11 25H2 x64, OS build 26200.9457; Google Chrome Stable 154.0.8037.93; монитор 60 Hz; viewport 1440 × 900 CSS px, DPR 1 | Production web build, Chrome Performance; 3 × 30 с |
| Узкий responsive viewport | Тот же Windows/Chrome; viewport 390 × 844 CSS px, DPR 3, mobile/touch emulation | Production web build, Chrome Performance; 3 × 30 с |

Pixel 8 выбран как общая Android-платформа для режимов 60 и 120 Hz: его дисплей поддерживает Smooth Display 60–120 Hz. Google выпустил Android 17 16 июня 2026 г.; сентябрьский Pixel update для Pixel 8 — CP3A.260905.009. [Android 17](https://blog.google/products-and-platforms/platforms/android/android-17-features/), [Pixel update September 2026](https://support.google.com/pixelphone/thread/467705218/google-pixel-update-september-2026?hl=en), [Pixel 8 display specs](https://store.google.com/us/product/pixel_8_specs).

Для iOS выбран iPhone 17 с iOS 27.0.1 (24A446). iOS 27 поддерживает эту модель; ProMotion достигает 120 Hz, а Limit Frame Rate задаёт максимум 60 fps. [iOS 27.0.1 release](https://developer.apple.com/news/releases/?id=09142026a), [iPhone 17 specs](https://www.apple.com/iphone-17/specs/), [iOS 27 compatibility](https://support.apple.com/en-md/guide/iphone/iphe3fa5df43/ios), [Limit Frame Rate instructions](https://support.apple.com/en-au/guide/iphone/iph0b691d3ed/ios).

Для desktop закреплены Windows 11 25H2 build 26200.9457 и Chrome Stable 154.0.8037.93 — стабильные выпуски на дату матрицы. Узкий viewport эмулируется тем же Chromium. [Windows release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information), [Chrome Stable update, September 29, 2026](https://chromereleases.googleblog.com/2026/09/stable-channel-update-for-desktop_01807488085.html).

Перед каждым прогоном сохранить фактические build/version, CPU/GPU и модель/частоту монитора. Если используемый физический парк отличается от reference-матрицы, записать замену с точной моделью и build, затем повторять все три прогона на одной и той же конфигурации.

## Протокол AC-12 для продолжения

На каждом target выполнить три одинаковых 30-секундных прогона на общей фикстуре. Записать число кадров, число кадров дольше бюджета, их процент и медианную/максимальную длительность кадра. Порог PRD: не более 1% кадров за бюджетом; 16,7 мс для 60 Hz и 8,3 мс для 120 Hz. Сравнение включённой анимации с последующей стабилизированной версией должно укладываться в прирост не более 0,5 процентного пункта.

| Цель | Конфигурация | Прогон 1 | Прогон 2 | Прогон 3 | Итог |
|---|---|---|---|---|---|
| Android 60 Hz | Pixel 8 / Android 17 / CP3A.260905.009 | Не измерен | Не измерен | Не измерен | Ожидает устройство |
| Android до 120 Hz | Pixel 8 / Android 17 / CP3A.260905.009 | Не измерен | Не измерен | Не измерен | Ожидает устройство |
| iOS 60 fps cap | iPhone 17 / iOS 27.0.1 (24A446) | Не измерен | Не измерен | Не измерен | Ожидает устройство |
| iOS ProMotion | iPhone 17 / iOS 27.0.1 (24A446) | Не измерен | Не измерен | Не измерен | Ожидает устройство |
| Chromium desktop | Windows 11 25H2 build 26200.9457 / Chrome 154.0.8037.93 | Не измерен | Не измерен | Не измерен | Ожидает Performance |
| Узкий viewport | Та же версия Chrome / 390 × 844, DPR 3 | Не измерен | Не измерен | Не измерен | Ожидает Performance |
