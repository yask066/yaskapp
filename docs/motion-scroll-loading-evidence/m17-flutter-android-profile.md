# M17 Flutter frame profile: Samsung A32

Дата: 7 октября 2026 года (UTC+3).

## Устройство и сборка

- Физическое устройство: Samsung SM A325F (`RF8R321M9LJ`), Android 13/API 33, 1080×2400 px, 420 dpi.
- Активный режим встроенного дисплея: 90 Hz (Android `dumpsys display`, mode 2; доступен также 60 Hz).
- Flutter 3.44.5 / Dart 3.12.2; profile APK, renderer из runtime log — Impeller/Vulkan.
- Feed загружен из локального T02 profiling fixture: seed `20261002`, 100 уникальных poll cards; сеть подключалась через `adb reverse tcp:3128 tcp:3128`. Локальный WebSocket `/realtime` отвечает на heartbeat `pong`; Node handshake/heartbeat smoke прошёл. Flutter device listing раньше показывал `hardwareRendering:false`, но фактический runtime engine log в profile app сообщил Impeller/Vulkan.
- Перед тремя замерами приложение запускалось отдельным процессом; после первой чистой загрузки выполнялись 30 секунд чередующихся свайпов вверх/вниз по ленте (высота свайпа 1 320 px, длительность жеста 300 ms). На прогон сбрасывался Android `gfxinfo` counter. Для первого запуска после выявленного `404` на fixture WebSocket run 1 повторён с рабочим heartbeat; сохранён именно повторный чистый trace.

## Scroll traces

Каждый файл — Flutter timeline в Perfetto proto format (`--trace-to-file`); длительность — Stopwatch вокруг реальных ADB swipe gestures. Файлы скопированы после завершения процесса приложения.

| Run | Измеренная длительность | Свайпы | Trace |
|---:|---:|---:|---|
| 1 | 30.36 s | 75 | [m17-flutter-run-1.binpb](m17-flutter-run-1.binpb) |
| 2 | 30.23 s | 76 | [m17-flutter-run-2.binpb](m17-flutter-run-2.binpb) |
| 3 | 30.38 s | 74 | [m17-flutter-run-3.binpb](m17-flutter-run-3.binpb) |

Фактические stopwatch значения сохранены в [run 1](m17-flutter-run-1-measurement.txt), [run 2](m17-flutter-run-2-measurement.txt) и [run 3](m17-flutter-run-3-measurement.txt). Дополнительные Android `dumpsys gfxinfo ... framestats` outputs: [run 1](m17-android-gfxinfo-run-1.txt), [run 2](m17-android-gfxinfo-run-2.txt), [run 3](m17-android-gfxinfo-run-3.txt).

## Initial load

Flutter `--trace-startup` штатно собрал отдельный [startup summary](m17-flutter-initial-load-startup.json) и [timeline JSON](m17-flutter-initial-load-timeline.json). VM timeline измерил `timeToFirstFrameMicros=788768` (789 ms) и `timeToFirstFrameRasterizedMicros=899350` (899 ms); Flutter CLI также напечатал `Time to first frame: 788ms`.

## Ограничения интерпретации

`dumpsys gfxinfo` для всех трёх Flutter surface возвращает `Total frames rendered: 0`, поэтому Android ViewRoot frame table не годится для frame statistics. Flutter Perfetto traces разобраны Perfetto Trace Processor v58.2; сбор и расчёты сохранены в [машиночитаемом summary](m17-flutter-frame-metrics.json).

Окно каждого прогона ограничено интервалом от Android `gfxinfo Stats since` до этого времени плюс длительность stopwatch прокрутки. `Frame` — длительность верхнего Flutter timeline slice на UI thread; `p95` использует Flutter `findPercentile` (индекс `round((n−1)×0.95)`). При активных 90 Hz бюджет равен 11.111 ms. `SceneDisplayLag` — отдельный engine event: Flutter создаёт его, когда `raster_finish_time > frame_target_time`; `vsync_transitions_missed` сообщает число пропущенных бюджетов. Поэтому число этих событий показано отдельно и не делится на UI `Frame` count как точный late-frame percentage.

| Run | UI Frame slices | UI Frame p95 / max | UI slices >11.111 ms | SceneDisplayLag events | missed-vsync p95 / max |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 460 | 5.723 / 14.929 ms | 4 (0.274%) | 1 423 | 2 / 3 |
| 2 | 2 053 | 4.032 / 16.575 ms | 1 (0.049%) | 2 011 | 2 / 3 |
| 3 | 2 161 | 5.416 / 25.550 ms | 13 (0.601%) | 1 811 | 2 / 4 |
| Сумма | 5 674 | — / max 25.550 ms | 18 (0.317%) | 5 245 | — / max 4 |

Все три трассы содержат `clock_sync_unrelatable_clock_domains=1` и потерянные TrackEvent packets с отрицательным временем (`track_event_invalid_timestamp`: 248 234 / 269 534 / 234 076 по runs 1/2/3). Поэтому подсчёты событий из trace могут быть неполными. Значения длительности `Frame` описывают работу UI thread, а не end-to-end presentation; числа `SceneDisplayLag` дают engine-сигнал опоздания raster, но trace не предоставляет надёжный общий denominator всех представленных кадров. Следовательно, эти результаты не подтверждают и не опровергают порог AC-12 ≤1% late frames; нужен здоровый trace с достоверной классификацией всех кадров и их presentation deadlines.

Пересобранная после замера обычная profile APK использует staging endpoints, установлена на телефон; временный fixture server остановлен, USB reverse удалён. Настройки телефона: font scale 1.1, TalkBack выключен.
