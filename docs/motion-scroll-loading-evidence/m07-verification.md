# M07 — Web deadlines, retry и session lifecycle

Дата: 5 октября 2026 года. База: `bb8d31ff73c04d608e2444bcfceebd18ccad7631`.
Ветка: `codex/m07-web-lifecycle`. Windows, Node `v24.7.0`, npm `11.5.1`.

Выполнена только M07 из `docs/superpowers/plans/2026-10-02-motion-scroll-loading.md`.
Новые анимации, зависимости, pagination и Poll realtime channel не добавлены.

## Реализация

- GET завершается ошибкой `read_timeout` после 10 000 мс, включая чтение JSON body. Внутренний AbortController объединяет deadline, query cancellation и смену сессии; таймер и listeners очищаются в finally. Promise race завершает ожидание даже при транспорте, игнорирующем abort. Перед decode/401 callback повторно проверяется отмена.
- Mutation deadline не менялся. Сетевой сбой, 5xx или malformed successful mutation запускают одну HTTP-сверку затронутого Poll, без повторного POST/DELETE. Подтверждённый 404 удаляет Poll из cache. Создание комментария/ответа также сверяет Poll и обновляет существующий comment query.
- Query callers Feed, profile, detail, comments/replies передают signal. Отменённый Poll query не выполняет общий merge. Search переведён с mutation на query по submitted query/type/sort/session epoch; изменение ввода/фильтра отменяет прежний запрос и разрешает новую отправку.
- Logout, новый вход и unmount отменяют запросы; auth epoch защищает restore/login/register. При успешном новом входе очищаются query cache и Poll store. Старые mutation error/pending не показываются новой сессии. Ошибка входа после отменённого restore выходит из loading.
- Foreground и online используют существующие TanStack focus/online managers. Существующий notification `connection.ready` запускает HTTP-сверку известных Poll. Notification payload не используется как Poll snapshot. Одновременные сверки одного ID объединяются; failure освобождает flight для следующего lifecycle события и не запускает бесконечный retry.
- Добавлен Retry для Search и initial comment read. Данные Search и comments сохраняются при background read failure.

## RED → GREEN

До соответствующих изменений наблюдались строгие failures:

| Проверка | Исходное поведение | Итог |
|---|---|---|
| Read deadline, body deadline, caller cancellation | timeout/cancellation error не возникает | pass |
| Late restore 200/401 после нового входа; login после logout | старый пользователь/anonymous заменяет новую сессию; поздний login восстанавливает logout | pass |
| Search query/type/sort changes | Search остаётся disabled на старом запросе | pass |
| Cancelled query shared merge | late response разрешается и меняет другой cache | pass |
| Foreground/online/connection.ready | cached Poll не сверяется HTTP | pass |
| Ambiguous vote/delete | Poll остаётся прежним после потенциально выполненной записи | pass |
| Ambiguous root comment/reply; initial comments Retry | count остаётся прежним; Retry отсутствует | pass |
| Self-review: interrupted restore + login error; previous viewer mutation error | loading не завершается; отмена показывается новой сессии | pass |

Дополнительные интеграционные проверки: настоящий Feed показывает error через 10 с, не делает автоматических retries в следующие 20 с, Retry получает свежие данные, late first response их не заменяет; logout → вход вторым viewer → late Poll response не меняет новую сессию; lifecycle unsubscribe после unmount не создаёт запросов. Mutation response спустя 12 с проходит без read timeout. Клиентские тесты проверяют отсутствие оставшихся deadline timers.

## Финальные команды

```text
npm run test -w @yaskapp/web -- --run
Test Files: 27 passed (27)
Tests: 159 passed (159)
exit 0

npm run typecheck -w @yaskapp/web
exit 0

npm run lint -w @yaskapp/web
exit 0; 0 errors, 0 warnings
```

Полный вывод: [m07-web-tests.txt](m07-web-tests.txt). Baseline перед изменениями: 136/136.
В baseline и финальном suite присутствуют MSW diagnostics от прежних тестов, которые заканчиваются раньше read и снимают handlers. Это записано в выводе; они не объявлены чистым stderr.

## Решения и ограничения

- Работа сохранена в отдельной локальной ветке текущего checkout; новый worktree не создавался. Стоимость пересмотра: перенос ветки в отдельный checkout.
- Проведён самостоятельный review. План требует отдельного разрешения пользователя для делегирования; независимый reviewer не запускался. Стоимость: независимая проверка до merge остаётся возможной отдельно.
- Test harness использует Node AbortController/AbortSignal из `node:util`, совместимые с Node fetch/MSW. Для Feed fake-timer test отключён TanStack GC: его таймеры 300 000 мс не относятся к deadline.
- Browser/device profiling, 20 полных browser navigation циклов и численные scroll/layout замеры — **не измерено** в M07; они относятся к последующим задачам. Backend DB verification M04 и G0 этим результатом не закрываются.
