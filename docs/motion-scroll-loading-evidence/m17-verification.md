# M17: стабилизация и baseline без motion

Дата: 7 октября 2026 года (UTC+3).

**Статус: частично выполнено; M17 остаётся открытой из-за неподтверждённого Android AC-12 и незакрытых ручных проверок.** Текущий scope: Flutter на Android и web; iOS вынесен в отдельный будущий этап и не блокирует M17. Новые motion-эффекты не включались.

## Автоматические проверки

| Проверка | Результат |
|---|---|
| Web full suite: `npm run test -w @yaskapp/web -- --run` | 210/210 passed, 32 файла, exit 0. Покрывает текущие poll state/races, error/retry, scroll/restore, skeleton/loading и страницы. [Полный лог](m17-web-tests.txt) |
| Web typecheck | passed, exit 0. [Лог](m17-web-typecheck.txt) |
| Web lint | passed, exit 0. [Лог](m17-web-lint.txt) |
| Production web build | passed, 125 modules, exit 0. [Лог](m17-web-build.txt) |
| Flutter strict M06 race regressions | 6/6 passed with `M02_RUN_KNOWN_FAILURES=true`. [Лог](m17-flutter-m06-optin.txt) |
| Flutter strict M14 page-dedup regression | Initial run failed: expected 7 rows, found 9. Root cause: Search pagination appended the second page without deduplicating stable result IDs. After the fix, strict regression passed 1/1. [Passing log](m17-flutter-m14-optin.txt) |
| Flutter full suite: `flutter test --no-pub --reporter expanded` | 236 passed, 1 skipped, exit 0 on 8 October after the Flutter suite fixes. [Full log](m17-flutter-tests-2026-10-08.txt) |
| Flutter analyze after M10 repair | Full package analyze exits 1 with 11 existing diagnostics outside the repaired layout/accessibility paths. Focused analysis of the edited files reports only two existing warnings: unused `_SimplePlaceholderScreen` in `home_screen.dart` and local `navy` in `feed_screen_test.dart`. [Full analyze log](m17-flutter-analyze-after-m10.txt), [focused changed-files analyze](m17-flutter-changed-files-analyze-after-m10.txt) |
| Flutter devices | Свежий scan 7 октября: физический Samsung SM A325F, Android 13/API 33, плюс Windows, Chrome 155 и Edge 154. Старый [снимок списка устройств](m17-flutter-devices.json) отражает более раннюю инвентаризацию; Android device был подключён позднее. |

Web прогон чистый. Flutter failures не скрыты: auth cases вне поверхности M17, profile cases связаны с незавершёнными periodic timers в test lifecycle, Search cases соответствуют уже записанным finder/layout/loading ожиданиям. В частности, тест пустого поиска передаёт `Network unavailable.`, а затем ожидает старую generic строку `Could not complete search.`; отдельный тест ожидаемого API-сообщения проходит. Search load-more Retry проходит. M14 dedup defect исправлен в [search_screen.dart](../../apps/mobile/lib/src/features/search/search_screen.dart): cursor pages объединяются по стабильным `poll-<id>`/`user-<id>`, сохраняя порядок первого появления и последнее значение элемента.

## Browser smoke: navigation и keyboard focus

- Запуск: React/Vite development server на `127.0.0.1:5174` с T02 fixture server (`profiling`, seed `20261002`, 100 уникальных polls). Это функциональный smoke, не production profiling.
- Codex in-app browser, viewport 1280×720 CSS px, DPR 1.1979166; во время измеряемых циклов пользовательский scroll не менялся.
- Для 50-й карточки выполнено 20 циклов list → comments/detail → back. Положение карточки после каждого возврата сохранилось; максимальный и итоговый сдвиг: 0 CSS px.
- Клавиатурный Tab перемещает focus на именованную кнопку `More poll actions`; browser accessibility tree содержит имена кнопок голосования/лайка/комментариев и заголовки опросов. Это проверка дерева доступности, не проверка реальным screen reader.
- На исходном desktop viewport горизонтальный overflow отсутствовал. Ручной text-scale 200% в M17 не измерен.

## Production build: дополнительный headless Chromium baseline

- Для прогона использована свежая production-сборка web-клиента (`apps/web/dist`) и локальный T02 profiling fixture: seed `20261002`, 100 уникальных polls. API-ответы выдавались локально; задержки сети и production backend не измерялись.
- Среда: Windows x64, `HeadlessChrome/155.0.8059.39`. В CDP выставлены 1440×900, DPR 1 и 390×844, DPR 3 с mobile/touch emulation. Реальная частота монитора и GPU-путь не измерены; headless конфигурация не равна reference Chrome Stable с физическим 60 Hz монитором.
- Для каждого прогона на 30 секунд задавалось прокручивание вниз шагом 32 CSS px за `requestAnimationFrame`, с `behavior: instant`; это прошло 57 664 px по ленте. В CDP записывались `disabled-by-default-devtools.timeline.frame` и `viz`; к файлам оставлены frame-related events для обозримого размера traces.
- Каждая строка ниже содержит 1 802 `DrawFrame` events. `MISSED` — число уникальных `DisplayScheduler::BeginFrame` с Chromium subtype `MISSED`; p95/max — интервалы между `BeginFrame.frame_time_us`, а не длительность CPU/GPU исполнения кадра.
- Наблюдаемая `BeginFrame` cadence — около 60 Hz (медианный интервал около 16,664 мс); это cadence headless compositor, не показание физического монитора. Сборка соответствует HEAD `9f57952de060cbd33897c2c31cfde4885eb4296f`; web-исходники в рабочем diff отсутствуют.

Полные значения в машиночитаемом виде: [summary JSON](m17-chromium-profile-summary.json).

| Viewport / DPR | Run | BeginFrames | MISSED | p95 interval | max interval | Trace |
|---|---:|---:|---:|---:|---:|---|
| 1440×900 / 1 | 1 | 1 803 | 0 | 16,693 мс | 17,338 мс | [trace](m17-chromium-desktop-1.trace.json.gz) |
| 1440×900 / 1 | 2 | 1 803 | 0 | 16,695 мс | 17,371 мс | [trace](m17-chromium-desktop-2.trace.json.gz) |
| 1440×900 / 1 | 3 | 1 804 | 1 | 16,695 мс | 17,130 мс | [trace](m17-chromium-desktop-3.trace.json.gz) |
| 390×844 / 3 | 1 | 1 803 | 0 | 16,697 мс | 16,762 мс | [trace](m17-chromium-responsive-1.trace.json.gz) |
| 390×844 / 3 | 2 | 1 804 | 1 | 16,692 мс | 17,347 мс | [trace](m17-chromium-responsive-2.trace.json.gz) |
| 390×844 / 3 | 3 | 1 804 | 1 | 16,697 мс | 17,215 мс | [trace](m17-chromium-responsive-3.trace.json.gz) |

Separate initial-load trace содержит 13 428 событий: [compressed trace](m17-chromium-initial-load.trace.json.gz). На локальной fixture navigation `firstContentfulPaint` случился через 60,5 мс после `navigationStart`; это локальный warm-host результат, не production-network SLA.

## Physical Chrome / monitor profile

- 7 октября сняты три видимых headful прогона в Google Chrome 155.0.8059.39 на физическом Windows display `1680×1050 @ 60 Hz` (Win32 `EnumDisplaySettings`). Chrome зафиксировал bounds `1403×877 CSS px`, scale/DPR `1.19792`; maximized page viewport — `1403×742 CSS px`. DPR, viewport и Hz не эмулировались.
- Чистый отдельный Chrome profile, production web build на HEAD `9f57952de060cbd33897c2c31cfde4885eb4296f`, локальный T02 fixture (100 уникальных poll cards, seed `20261002`). Каждый workload длится ~30.0 с и прокручивает вниз на 32 CSS px за `requestAnimationFrame`; каждый прогон дал 1 801 RAF callback / `DrawFrame` и прошёл ~57 131 CSS px.
- GPU path из CDP `SystemInfo.getInfo`: compositing/rasterization включены; Skia GaneshGL через ANGLE D3D11 использовал Intel UHD Graphics (`27.20.100.9268`). NVIDIA GTX 1650 обнаружена, но фактическим GL renderer был Intel UHD. Начальный Chrome запуск из AppContainer sandbox воспроизводимо завершался `0x80000003` до startup log; вне sandbox Chrome открыл видимое окно и CDP. Поэтому профиль снимался процессом на host с изолированным временным user-data-dir.
- В trace есть два compositor BeginFrame sources. Source `0` — активная страница: 1 801 уникальный BeginFrame на run, совпадает с 1 801 RAF/`DrawFrame`; он используется для late-frame proxy. Дополнительный source `4` (304 BeginFrames, 96 `MISSED` в каждом run) сохранён в traces и JSON, но не входит в denominator активной страницы: его cadence не совпадает с measured scroll workload. P95 использует индекс `round((n−1)×0.95)`; `MISSED` дедuplicated по sequence number.

| Run | Активные BeginFrames | MISSED | MISSED % | BeginFrame interval p95 / max | `DirectRenderer::DrawFrame` p95 / max | GPU `SwapBuffers` p95 / max |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 801 | 1 | 0.0555% | 16.701 / 17.399 ms | 0.180 / 2.030 ms | 0.241 / 0.631 ms |
| 2 | 1 801 | 0 | 0% | 16.697 / 17.206 ms | 0.193 / 0.365 ms | 0.261 / 0.823 ms |
| 3 | 1 801 | 0 | 0% | 16.695 / 16.945 ms | 0.187 / 0.302 ms | 0.257 / 0.804 ms |

По page source сумма составляет 1/5 403 `MISSED` BeginFrames (0.0185%); все три прогона ниже абсолютного порога 1% для этой Chrome scheduler classification. Compositor/GPU slice durations — измеренные этапы рендеринга, не end-to-end photon presentation latency; этот результат закрывает физический Chrome baseline, но не заменяет Android/Flutter coverage или парные off/on замеры M26. [Summary и классификация](m17-chrome-physical-summary.json), [видимый page screenshot](m17-chrome-physical-desktop.png), [GPU details](m17-chrome-physical-gpu.json), [Profiler](m17-physical-chrome-profile.mjs), [analyzer](m17-physical-chrome-analyze.mjs), [local production host](m17-physical-chrome-host.mjs). Полные trace runs: [run 1](m17-chrome-physical-desktop-1.trace.json.gz), [run 2](m17-chrome-physical-desktop-2.trace.json.gz), [run 3](m17-chrome-physical-desktop-3.trace.json.gz).

В production-сборке также проведено 20 циклов list → detail → back для 50-й карточки: 20 detail routes, 20 back navigations, максимальный и итоговый anchor delta — 0 CSS px при 1440×900/DPR 1. Browser keyboard smoke прошёл по последовательности skip link → Yaskapp → Login → Register → Create poll → Post → feed controls → `More poll actions`. Accessibility tree содержал именованные кнопки `Like (...)`/`Comments (...)` и заголовки карточек. Это CDP keyboard/AX smoke; Android TalkBack проверен отдельно.

## Непроведённые обязательные проверки

- AC-12 (общий): physical Chrome baseline проходит абсолютный порог `MISSED` ≤1% в трёх runs. Android `FrameTiming` profiles охватывают scroll, vote/like count updates и свежую Feed загрузку с задержанным T02 fixture; `Loading polls` подтверждён во всех шести загрузках. Scroll **не проходит** абсолютный порог: на 90 Hz late rate 98.875–99.957% во всех runs; на 60 Hz 1.474% в одном. Reaction/update **не проходит** во всех runs: 97.600–99.749% на 90 Hz и 3.588–3.883% на 60 Hz. Устройство SM-A325F (Android 13/API 33, Mali-G52 MC2) поддерживает 60/90 Hz, но не 120 Hz. Motion-off pair отсутствует, поэтому сравнительная часть AC-12 не проверена; см. [Android AC-12 report, summary и raw records](android-ac12-2026-10-08/README.md). iOS profile исключён из текущего scope; headless Chromium остаётся дополнительным evidence.
- Исторические Flutter Perfetto traces от 7 октября на Samsung SM A325F: 30.36/30.23/30.38 с, с 75/76/74 свайпами по фиксированному 100-poll fixture. UI `Frame` slices p95/max составили 5.723/14.929, 4.032/16.575 и 5.416/25.550 мс; всего 18/5 674 UI slices превысили предполагаемый бюджет 11.111 мс при 90 Hz (0.317%). Engine `SceneDisplayLag` выдал 1 423/2 011/1 811 событий с missed-vsync p95/max 2/3, 2/3 и 2/4. Из-за потерянных trace events и отсутствующего presentation denominator эти исторические данные сами по себе не подтверждали AC-12; новый поддержанный `FrameTiming` profile приведён выше. Подробности: [historical device profile](m17-flutter-android-profile.md), [JSON summary](m17-flutter-frame-metrics.json). Отдельный startup trace дал 789 мс до первого кадра и 899 мс до первого rasterized frame. Android AVD ранее не запускался из-за отсутствующего system image.
- Ручная Android text-scale проверка проведена повторно после M10 repair при `font_scale=2.0`. Composer reflows и полностью показывает кнопку “Create poll”, правая Share action переносится на вторую строку, Search heading оборачивается на две строки без clipping. [Начальный Feed 100%](m17-android-100.png), [старый Feed 200%](m17-android-200.png), [исправленный Feed 200%](m17-android-200-after-m10.png), [исправленный Search 200%](m17-search-200-after-m10.png).
- Samsung TalkBack включён при проверке: accessibility hierarchy на Feed именует author avatar как `Open yask066 profile` и center tab как `Create poll`, без безымянных кликабельных Feed-контролов. Keyboard focus smoke сосредоточил именованный Search control. Телефонная запись вывода TalkBack сохранена локально, но независимое подтверждение произнесённого содержимого не выполнено; её следует прослушать вручную. TalkBack выключен, `font_scale=1.1` и исходное состояние accessibility service восстановлены. См. [Feed hierarchy](m17-accessibility-after-m10-feed.xml) и [focus evidence](m17-accessibility-focus-after-m10.xml).
- 8 октября повторён полный `flutter test --no-pub --reporter expanded`: exit 0, 236 passed, 1 skipped. [Свежий лог](m17-flutter-tests-2026-10-08.txt). Предыдущий лог с 13 failures относится к HEAD до последнего ремонта Flutter suite.
- На Samsung 8 октября проведены три новых 30-секундных scroll captures. Per-layer SurfaceFlinger TimeStats считает 2,040/2,067/2,058 presents; доля `present2present` интервалов больше 11.111 ms — 31.7647%/32.6076%/32.7988%, p95 — 22 ms. Это presentation-cadence signal, а не late-frame классификация: `totalTimelineFrames=0` у слоя Flutter SurfaceView, который Android FrameTimeline не поддерживает. См. [обновлённый профиль и ограничения](m17-flutter-android-profile.md), [summary JSON](m17-android-timestats-summary.json) и [capture/analyzer](m17-android-timestats-profile.ps1).
- Для Android создан profile-only Flutter `SchedulerBinding.addTimingsCallback` probe: [исходник](../../apps/mobile/lib/src/performance/ac12_frame_timing_probe.dart). APK собран с `--dart-define=M17_AC12_PROBE=true`; probe пишет engine `FrameTiming` для rasterized frames, включая `totalSpan` от OS vsync до raster finish и wall-clock timestamp. После первой неудачной попытки из-за отключившегося ADB устройство переподключили, log records укоротили для защиты от logcat truncation и затем успешно сняли 3×scroll runs при 90 Hz и 3× при 60 Hz. Замеры классифицировали late frames: они превышают порог AC-12 при 90 Hz во всех прогонах и при 60 Hz в одном. [Итоги и raw logs](android-ac12-2026-10-08/README.md). Flutter описывает `addTimingsCallback` как источник frame timing для missed-frame/latency диагностики ([API](https://api.flutter.dev/flutter/scheduler/SchedulerBinding/addTimingsCallback.html)). SurfaceFlinger cadence остаётся дополнительным system-level signal, но Android FrameTimeline не классифицирует Flutter SurfaceView.
- Команды и фактические ограничения этой Android-сессии подробно записаны в [Android follow-up](m17-android-checks.md).
- Backend M04 DB verification/evidence остаётся открытой отдельной зависимостью; G0 не пройден, motion-задачи после M17 не допущены.

## Итог

Автоматические Web проверки, strict M06/M14 cases, полный Flutter suite (236 passed, 1 skipped, exit 0), 20 production navigation cycles, headless и physical Chrome traces, повторный ручной Android smoke при 200% и Android profile evidence документируют проверенные сценарии. На физическом Chrome дисплее scheduler `MISSED` дал 0–0.0555% в каждом run; profile и renderer/GPU p95/max сохранены. На Android новые `FrameTiming` profiles охватили scroll, реакции и first Feed loads со skeleton: все 90 Hz scroll/reaction runs и все 60 Hz reaction runs превышают предел 1%; один 60 Hz scroll run также превышает предел. Skeleton hierarchy подтверждена 6/6. Сравнение с motion-off отсутствует, 120 Hz режим на Samsung недоступен; Android AC-12 не пройден. Подробности и сырые записи: [Android AC-12 profile](android-ac12-2026-10-08/README.md). Прослушивание TalkBack output тоже остаётся неподтверждённым. M17 и G0 не закрыты; iOS отложен и не входит в текущую матрицу.
