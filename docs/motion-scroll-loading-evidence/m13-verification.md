# M13: Web scroll integration verification

Дата: 6 октября 2026 года (UTC+3).

## Реализация

- Общий M11 hook подключён к feed, search, public profile, comments/replies и notifications. Poll, notification, comment, reply и user rows имеют устойчивые list item IDs.
- Search query/type/sort и notifications unread filter отражаются в URL. Это сохраняет контекст списка при переходе на detail/profile/comment и возврате; query cache продолжает хранить загруженные страницы и прежний контент во время refetch.
- Restore при POP немедленный, без smooth scroll; focus возвращается к сохранённому anchor. Явная цель комментария и новые элементы сохраняют приоритет над обычным anchor.
- Notifications используют существующую доставку: вне верха arrivals буферизуются и доступны через фиксированное действие «Новые уведомления», у верха на расстоянии до 24 px автоматически добавляются в список. Новый transport не создавался.

## Проверки

| Проверка | Результат |
|---|---|
| Изменённые scroll/feed/search/profile/notifications tests | 55/55 passed |
| Полный `npm run test -w @yaskapp/web -- --run` | 195/195 passed, 31 test files |
| `npm run typecheck -w @yaskapp/web` | exit 0 |
| `npm run lint -w @yaskapp/web` | exit 0 |
| Browser: feed poll 020 → detail → Back | карточка сохранила `getBoundingClientRect().top`; delta 0 CSS px, список из 100 карточек остался доступен, сохранённый item получил focus |
| `git diff --check` | passed |

Изменённые тесты проверяют feed/detail/back anchor и focus, сохранение поискового контекста при возврате, public profile anchor, unread URL filter, notification grouping/deletion fallback и auto-insert/buffering существующих arrivals у границы 24 px. Существующие MSW unhandled-request diagnostics в unrelated page tests остаются в полном прогоне; падений нет.

## Ограничения

- Для browser geometry выполнен прямой feed → poll detail → Back сценарий. Остальные маршруты проверены интеграционными/component tests, но не отдельными браузерными проходами.
- Реализация сохранена в task commit `feat(web): integrate list scroll restoration` в текущем checkout.
