# Pagination release record

**Status:** NOT RELEASED — T28 закрыта решением пользователя 2026-10-28 без staging; release документы подготовлены, staging, rollout и rollback smoke не выполнялись.

## Подготовка

| Поле | Значение |
|---|---|
| Prepared | 2026-10-28 |
| Staging verification start / end (UTC) | NOT RUN |
| Limited rollout start / end (UTC) | NOT RUN |
| Source commit reviewed | `857e29b` — T24 pagination rollout flags and popular/expired client work; includes T27 base |
| API build / image digest | Не собран для T28 |
| Web build ID | Не собран для T28 |
| Android build ID | Не собран для T28 |
| Staging API URL / host | Не предоставлен; в workspace не настроен |
| Staging database migration status | Не проверен. Для сверки: `034_poll_pagination_indexes.sql`, `035_poll_feed_snapshots.sql` |
| Staging devices / browsers | Не запускались |
| Engineering/Product Release Owner | Не назначен |
| QA Owner | Не назначен |
| API/DB Operator | Не назначен |
| Web Release Engineer | Не назначен |
| Android Release Engineer | Не назначен |
| Pagination build flags | Реализованы в T24 commit `857e29b`: web `VITE_FEED_PAGINATION` и Flutter `YASKAPP_FEED_PAGINATION`, оба default `false`. Локальные builds с web `false`/`true`, web disabled-mode test и Flutter default-off проверены; см. T24 в [task breakdown](../superpowers/plans/2026-10-19-feed-comments-pagination-task-breakdown.md). Staging builds не запускались |
| Legacy replies window | Не начато. Начало — timestamp первого production Android v1 cursor release; конец — +180 дней UTC |

## Результаты release verification

| Область | Результат | Evidence / версия / устройство |
|---|---|---|
| AC-01–18 на staging | NOT RUN — последняя матрица T27 остаётся partial | [acceptance matrix](acceptance-matrix.md) |
| Старый и новый client/API compatibility | NOT RUN | — |
| API p95: chronological first/deep, popular first/continuation | NOT RUN — T26 load run отменён | — |
| Средний рост deep/first | NOT RUN — T26 load run отменён | — |
| Android frame budget по workload | Есть только T27 profile evidence; это не rollout run | Samsung SM-A325F, Android 13; см. матрицу T27 |
| Web frame budget | Есть только T27 headless traces; physical-display pacing не проверен | Chrome 156 headless; см. матрицу T27 |
| Browser/device, OS, refresh rate, build | Для T28 не запускалось | — |
| Known limitations / принятое исключение | AC matrix, TalkBack, полный API suite, T26 server budgets и перечисленные T27 frame misses | Ссылка выше; отдельное решение Release Owner ещё не записано |

## Зависимости и принятые ограничения

T27 закрыта решением пользователя 2026-10-28 с частичными evidence. AC-01–18, TalkBack speech checks и полный API suite не запускались. Android workloads Feed 100 (35.90%), Feed 1 000 (10.83%) и roots 1 000 (5.12%) превысили порог 5%; headless web RAF workload показал 25.45–36.82% интервалов >16.7 ms. T26 staging load run не проводился, поэтому server performance targets остаются непроверенными. Подробности — [acceptance matrix](acceptance-matrix.md).

T04 и T13 закрыты с локальными evidence, приведёнными в [task breakdown](../superpowers/plans/2026-10-19-feed-comments-pagination-task-breakdown.md). T24 закрыта в commit `857e29b`; build-time flags с default `false` проверены локально. T28 закрыта решением пользователя без staging; staging rollout и rollback smoke не выполнялись. Остальные release gates и ограничения T21/T26/T27 остаются зафиксированы выше и в [acceptance matrix](acceptance-matrix.md). Staging setup здесь недоступен: нет target URL и локального `services/api/.env.staging`.

**Release decision:** HOLD. Не расширять охват и не объявлять rollout готовым. Требуются named owners, staging target/access, закрытие или явное письменное принятие blockers и выполненные проверки из [release checklist](../pagination-release-checklist.md).

## Staging compatibility checks

| Проверка | Результат | Evidence / build / устройство | UTC timestamp |
|---|---|---|---|
| Старый web/Android client → новый additive API | NOT RUN — staging target отсутствует | — | — |
| Старый replies cursor → новый API | NOT RUN | — | — |
| Новый web/Android client → legacy `{ items }` response | NOT RUN — staging target отсутствует | — | — |
| Pagination flag off → первая страница, без append | NOT RUN на staging; локально web disabled-mode test и Flutter controller default-off проверяют первую страницу без append | См. T24 в [task breakdown](../superpowers/plans/2026-10-19-feed-comments-pagination-task-breakdown.md) | — |
| API health, migrations 034/035, snapshot cleanup | NOT RUN | — | — |
| Metrics observation window | NOT RUN — endpoint/build отсутствуют | — | — |

## Rollout and rollback

| Поле | Результат |
|---|---|
| Limited web cohort | NOT RUN |
| Android closed-test cohort | NOT RUN |
| Rollback web build with flag `false` | NOT RUN |
| Rollback Android build with flag `false` | NOT RUN |
| Previous API image restore | NOT RUN |
| First production Android v1 cursor rollout (legacy window start) | Не назначен |
| Legacy replies cursor expiry (start + 180 days) | Невозможно вычислить до production release |
| Final Go/No-Go and expansion owner decision | Не принято |

**Result:** NOT RUN. Этот документ фиксирует подготовку и текущие ограничения; он не является evidence прохождения release/rollback smoke.
