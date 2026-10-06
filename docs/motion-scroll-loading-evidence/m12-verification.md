# M12: Flutter scroll context verification

Дата: 6 октября 2026 года (UTC+3).

## Реализация

- Добавлены `ListScrollContext`, `ListAnchor` и in-memory `ListScrollStateStore`, изолирующий scroll state по пользователю, route, list, query, filter и sort.
- Удалённый anchor заменяется ближайшим сохранившимся следующим или предыдущим item с сохранением экранной координаты.
- `ListScrollRestoration` корректирует offset после следующего layout через переданный screen-owned `ScrollController`, учитывает текущие scroll extents и пропускает восстановление при explicit target.
- Poll rows получили `ValueKey` по poll ID на Feed, Subscriptions, Profile, Public profile и Comments. Poll options используют poll/option IDs. Search, comment items и notifications уже имели item ID keys.
- Состояния страниц остаются частью экранного State; scroll primitive не владеет controller или страницами.

## Проверки

| Проверка | Результат |
|---|---|
| `flutter test --no-pub test/list_scroll_state_test.dart test/poll_card_layout_test.dart` | 12/12 passed |
| M12 feed row key regression | passed; RED→GREEN |
| Затронутые Feed/Subscriptions/Profile/PublicProfile/Comments/Search/Notifications suites с M12 tests | 88 passed, 10 известных failures, 1 skipped |
| Полный `flutter test --no-pub --reporter expanded` | 208 passed, 14 failures, 1 skipped; failures входят в исторический M01/M08 перечень, новых сбоев M12 нет. PollCard test, ранее падавший в M01, сейчас проходит. См. [полный лог](m12-mobile-full-suite.txt). |
| Analyze новых scroll/PollCard файлов и соответствующих тестов | No issues found |
| Полный `flutter analyze` | 12 ранее существовавших info/warning, включая unused declarations/variable; новых diagnostics в M12 файлах нет |
| `git diff --check` | passed |

Widget tests проверяют restore после layout без animation, clamp к актуальному max extent (включая изменённый viewport), explicit comment target, смену контекста, append, удалённый anchor и удаление нескольких items. Физическое keyboard/device profiling не выполнялось.
