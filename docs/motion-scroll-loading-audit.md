# Motion, scroll and loading — аудит M01

Дата: 2 октября 2026 года (UTC+3).
План: D:/yaskapp/docs/superpowers/plans/2026-10-02-motion-scroll-loading.md, задача M01.
Основание: D:/yaskapp/docs/prd-motion-scroll-loading.md и исторический docs/T02-motion-scroll-loading-baseline.md.
Проверенный checkout: D:/yaskapp, main, HEAD 455e8f443a982ec3c5cbe7063a4b4670a06d1dec.

## Статус и границы

Матрица поверхностей составлена; race/media T02 и все 15 исторических Flutter failures перепроверены свежими запусками. Ни один исторический результат не использован как текущий. Новые анимации, изменения приложения, fixture, backend и тестов проекта не выполнялись.

**M01 завершена:** готовый `m01-audit.patch` перенесён в D:/yaskapp; отчёт и evidence сохранены в репозитории. Проверены полнота матрицы, соответствие исходного HEAD и приложенных результатов, сценарии и владельцы дефектов. Исходные PRD и план уже были untracked до аудита; commit M01 содержит только аудит и evidence. Исторический T02 не изменялся.

Evidence раздела 3 получен при подготовке патча 2 октября 2026 года и сохранён без изменений. Повторные проверки при применении патча описаны отдельно в разделе 8; Flutter и browser media в этом завершающем запуске повторно не выполнялись.

Статусы ниже:

- **Воспроизведён** — новое наблюдение браузера, HTTP-probe или тестовый failure в этом запуске.
- **Не воспроизведён** — соответствующий выполненный сценарий не выявил дефект; это не доказательство для других сценариев.
- **Не проверен** — сценарий не выполнен. Статический признак в коде указан отдельно от runtime-доказательства.
- **Не измерено** — нет числового замера по протоколу PRD; успешные widget/unit tests не заменяют измерение.

## 1. Реальные поверхности Flutter

Навигация HomeScreen сохраняет Feed, Subscriptions, Notifications и Profile через IndexedStack. Feed и Profile имеют GlobalKey экранного State. Это удерживает экземпляр экрана при переключении вкладок, но не реализует содержательный anchor или контекст позиции по пользователю.

| Поверхность | Store/cache и запросы | Подписки / обновление |
|---|---|---|
| F1 Feed | Локальные _polls, _pollsFuture, _hasLoadedPolls. PollsApiClient.listPolls; одна страница. Initial read timeout 10 с на экране. Refresh заменяет список после ответа, старый список сохраняется до ответа. HTTP mutations заменяют целый PollSummary по ID. | Общий RealtimeClient из HomeScreen: pollVotes и pollDeletions. Vote event сохраняет только текущий viewerVoteOptionId, остальные поля берёт из snapshot. Возврат из comments заменяет PollSummary, создание вставляет карточку. |
| F2 Search / discovery | Локальные _items, _topPolls, _topUsers, _nextCursor, query/type/sort; SearchHistory и analytics. SearchApiClient.search с cursor; discovery — listPopularUsers и listPolls. Search/top users timeout 10 с; top polls и mutations без экранного deadline. _requestId защищает ответы поиска при смене запроса; append просто конкатенирует страницы. | Poll realtime-подписки в SearchScreen нет. PollSummary обновляется локально после действий, preview и возвращённого результата comments; общей синхронизации с Feed/Profile нет. |
| F3 Subscriptions | Локальные _polls, _pollsFuture, _hasLoaded. listSubscriptions, одна страница, read timeout 10 с. Refresh и mutations заменяют данные локально. | pollVotes и pollDeletions общего RealtimeClient. Vote snapshot сохраняет только viewerVoteOptionId. Возврат comments заменяет PollSummary. |
| F4 Profile: My polls / Liked | Локальные _myPolls, _likedPolls, futures и флаги первого load, _selectedTab. listMyPolls. Liked — listPolls(limit:50) с локальным фильтром viewerHasLiked, не отдельный бесконечный список. Экранного timeout на reads нет. _syncPollLike обновляет два локальных списка; unlike удаляет элемент из Liked. | Только pollDeletions; подписки pollVotes нет. HomeScreen вызывает refreshMyPolls при выборе Profile и после создания опроса. Comments возвращает обновлённый PollSummary. |
| F5 Public profile | Локальные _profile, _profileFuture, _pollsFuture. getPublicProfile; listUserPolls только если передан PollsApiClient. Refresh заново запускает futures. Follow имеет локальное optimistic состояние с rollback. Экранного read timeout нет. | Poll realtime-подписок нет. Карточки здесь отображаются без callbacks реакций и comments. |
| F6 PollCommentsScreen / reply threads | Входной PollSummary копируется в локальный _poll. _comments, _commentsFuture; listComments(limit в API), getComment для target/root, create/delete/like comments, like poll. Replies — локальный список и cursor-пагинация listCommentReplies с load-more. Общего poll store и read deadline нет. | Realtime-подписки этого экрана нет. Create/reply/like могут заменить _poll целым HTTP snapshot. PopScope возвращает _poll вызывающему экрану. |
| F7 Notifications | Session-owned NotificationStore в RealtimeSession: itemsById, ids, pending IDs, nextCursor, unreadCount, sessionEpoch и single-flight load-more. Экранные _loading/_loadingMore, unread filter. NotificationsApiClient.listTyped/unreadCount/read; list/count имеют timeout 10 с. | Существующие notification realtime events через RealtimeSession/store; HTTP reconciliation и resetSession. Store проверяет epoch поздних ответов; экран слушает store. Смена активной вкладки запускает нужный initial load. |

| Поверхность | Identity и scroll container | Pending / loading / back |
|---|---|---|
| F1 Feed | CustomScrollView → SliverList.separated. PollCard не получает key=ID; findChildIndexCallback и отдельного scroll context нет. | Sets _votingPollIds и _likingPollIds раздельны: vote/like одного poll могут идти одновременно. Initial spinner, error+Retry, empty; refresh сохраняет содержимое, ошибка — Snackbar. Navigator.push comments/public profile/search, затем pop к сохранённому экрану. Сохранение anchor ≤2 logical px не измерено. |
| F2 Search | Результаты: ListView.separated с ScrollController, порог load-more 240 px. Poll result имеет ValueKey(search-poll-result-ID), discovery poll — ValueKey(search-top-poll-ID). В discovery — SingleChildScrollView; user result без отдельного стабильного ID key. Scroll state живёт только в State этого route. | Sets voting/liking/following ID; preview имеет свои pending booleans. Initial spinner, empty/error+Retry, footer spinner. Reset очищает _items; load-more сохраняет предыдущую страницу. При _error и непустом _items локальная load-more ошибка в builder не отображается. Comments/profile — push/pop; preview — dialog/pop; back закрывает search route. |
| F3 Subscriptions | RefreshIndicator → ListView.separated (empty также ListView). PollCard без ID key; контроллера/содержательного anchor нет. | Sets voting/liking ID. Initial spinner/error+Retry/empty, cached content при refresh. Refresh ловит PollsApiException, TimeoutException отдельно не обработана. Comments push/pop; вкладка живёт в IndexedStack. |
| F4 Profile | CustomScrollView; список карточек — Column в SliverToBoxAdapter. PollCard без ID key; нет context/anchor для каждой вкладки. | Set _likingPollIds; initial spinner/error+Retry/empty; старые данные сохраняются при subsequent futures. Доступны like/unlike, собственный delete, comments. Vote callback отсутствует. Comments/settings/edit — push/pop; повторный выбор вкладки Profile вызывает refresh. |
| F5 Public profile | RefreshIndicator → ListView → _PublicPollsList/Column; PollCard без ID key. | Follow boolean pending; initial profile/polls spinner, ошибки+Retry, empty polls. Refresh переключает FutureBuilder в waiting и заменяет видимый контент индикатором. Navigator.pop к Feed/Search; реакции/comments карточки недоступны. |
| F6 Comments | Success — SingleChildScrollView/Column; waiting/error — ListView. CommentTile имеет ValueKey(comment-tile-ID), target root — GlobalKey; ответы имеют target keys и локальный thread State. Нет общего контроллера восстановления списка. | _isSubmittingComment, _isDeletingComment и _isLikingPoll; tiles/thread имеют локальные guards. Initial spinner/error+Retry/empty; replies loading/error+Retry/footer. Composer отдельно от scroll, учитывает keyboard inset через существующий AnimatedPadding. Target использует ensureVisible; disableAnimations даёт Duration.zero. Back/AppBar/system pop возвращает текущий _poll. Vote/cancel poll на этом экране отсутствуют. |
| F7 Notifications | ListView с ScrollController, карточки/semantics имеют keys с notification ID. atTop сейчас offset ≤1 px, PRD требует порог 24 px. Общего fallback anchor после удаления нет. | Store pending read IDs/read-all; экранные initial/load-more guards. Уже есть статический notification skeleton, initial error/Retry/empty, footer/error states. Новые элементы ниже top удерживаются в pending store; действие переводит в начало и materializePending. NotificationNavigator push → poll/comments/public profile, назад к сохранённой вкладке. |

Общие Flutter-компоненты: PollCard резервирует Image.network через AspectRatio(16/9); errorBuilder занимает тот же slot. Вопрос ограничен тремя строками; варианты строятся по индексу без ValueKey(option.id). Уже существуют TweenAnimationBuilder для progress/percent (350 мс) и эффекты чисел; это исходное поведение, не новая реализация M19–M24. Статический baseline M17 должен учитывать эти эффекты явно. Сохранение viewerHasLiked при vote realtime и согласованность независимых HTTP snapshots не доказаны.

## 2. Реальные поверхности web

Основной scroll container — документ/window: feature pages не создают отдельные scroll containers. router.tsx использует createBrowserRouter; ScrollRestoration, useListScrollState и ID anchor в проверенных файлах не подключены. Browser back может сохранять позицию сам, но это не гарантия AC-05/AC-06 после refetch, удаления или remount.

| Поверхность | Cache/store, запросы, subscriptions | Identity, pending, loading и back |
|---|---|---|
| W1 Feed | TanStack Query: ['polls', sort], ['popular-users']; listPolls → GET /polls?limit=20, trending добавляет popular. For you/Following отправляют одинаковый listPolls: отдельного following endpoint здесь нет. Одна страница. usePollMutations полностью заменяет Poll в ['polls'], ['user-polls'], ['poll', ID]. Poll realtime-подписки нет. | PollCard key=poll.id, option key=option.id. Общий mutations.isPending передаётся как isVoting всем карточкам. Like не учитывает pending, cancel/delete не имеют per-poll guards. Initial AsyncState — текст, error+Retry/empty; cached data остаются при refetch, но error banner может изменить geometry. navigate/Link → detail/user → browser Back; sort — локальный State, не сохранён в route context. |
| W2 Search | Результат useMutation(search({q,type,sort})), без query key и общего poll cache. Параметры локальны; сохранения страниц нет. API умеет cursor, но UI load-more не подключён. Discovery отдельного экрана здесь нет. Poll realtime и usePollMutations не подключены. | key=poll-ID/user-ID. Search submit disabled pending; начальный pending не имеет skeleton, error — alert; empty выдача без отдельного empty state/Retry. PollCard без vote/like/comments callbacks, только link вопроса ведёт в detail; user link → profile. После route remount локальная выдача/параметры теряются. |
| W3 PublicProfile | Queries ['profile', userId], ['user-polls', userId]; getPublicProfile/listUserPolls. Follow mutation обновляет только profile cache. Poll snapshots в user-polls могут меняться из usePollMutations других экранов. Poll realtime нет. | PollCard key=poll.id. Follow pending блокирует кнопку; vote/like недоступны. Comments/link → detail. Profile/polls initial AsyncState; polls error+Retry, отдельного empty состояния списка нет. Для своего ID Navigate('/me', replace). Back к исходному route; ID anchor отсутствует. |
| W4 PollDetail / CommentList / CommentThread | ['poll', pollId], ['comments', pollId], ['comment-target', pollId, commentId/rootId]; replies useInfiniteQuery ['comment-replies', pollId, rootId]. GET poll/comments/target/replies; create/like/delete comments, replies, poll reactions. Root comments одна страница; replies имеют существующую cursor-пагинацию. Create/reply заменяет целый Poll в cache. Poll/comment realtime-подписок нет. | PollCard в detail без внешнего key=ID; root/reply rows key=comment.id. Poll mutation pending общий; comment like без per-comment guard, reply/form pending локальны. Poll AsyncState/Retry; CommentList initial текст, initial error без Retry и return вместо cached rows; replies error/Retry/empty/load-more, fetchNextPage guard. Target focus/scrollIntoView; reduced motion читается при вызове. Browser Back; страницы replies в QueryClient сохраняются, expanded/focus State remount не сохраняет. |
| W5 Notifications | NotificationProvider reducer вне page: itemsById/ids/pendingIds/cursor/unreadCount, session epoch, reconcile single-flight. GET notifications/unread count, POST read/read-all. NotificationRealtimeClient имеет reconnect/foreground reconciliation и cleanup. HTTP/WS guards учитывают session identity. | keys=group/item.id; filter локален в page, scroll — window. Initial статический skeleton, error/Retry/empty; existing data при refresh, local error/Retry, Load more disabled loading. Read/read-all optimistic updates; явного UI per-operation pending slot нет. Links → existing target detail/comment/profile; Back. В WS callback applyRealtime(event) получает default atTop=true независимо от scroll; новые строки могут вставляться выше viewport. |

Web /me (MyProfilePage) — форма редактирования профиля и avatar, без списка своих/liked polls. Она не создаёт дополнительную поверхность списка для этого PRD. Отдельного web Subscriptions route нет. Псевдодействия в feed rail и topic labels не расширяют scope.

Общие web-компоненты: PollCard рендерит img без aspect-ratio/width/height/error fallback; global.css не задаёт media slot для poll-card__image. Avatar имеет заданный размер, но текст/числа, pending и error banners всё равно требуют числовой проверки. ApiClient.fetch не задаёт deadline и queryFn не передаёт Query AbortSignal; session-provider.clear() очищает QueryClient, но poll mutation callbacks не имеют своей epoch-защиты. NotificationProvider уже имеет такую защиту — её нельзя считать проверкой poll state.

## 3. Повторная проверка T02 и свежий evidence

Все приведённые ниже результаты получены 2 октября 2026 года на том же коде HEAD, плюс существовавшие до аудита untracked PRD/план.

| Проверка | Свежий результат | Evidence |
|---|---|---|
| Node cursor HTTP test | 1/1, exit 0; реальные две /search страницы и nextCursor | motion-scroll-loading-evidence/m01-node-tests.log |
| Web выбранные T02 файлы | 30/30, 3 файла, exit 0. 7 MSW сообщений Error: intercepted a request without a matching request handler, GET /polls?limit=20; это не чистый вывод | motion-scroll-loading-evidence/m01-web-targeted.log |
| Web полный suite | 122/122, 24 файла, exit 0; предупреждения/ошибки MSW сохранены в полном логе | motion-scroll-loading-evidence/m01-web-suite.log |
| Flutter полный widget suite | 141 passed, 15 failed, всего 156, exit 1; новые проверки на копии lib/test, а не повторение результатов T02 | motion-scroll-loading-evidence/m01-flutter-suite.log |
| Flutter devices --machine | Только Windows desktop target; Android/iOS targets не обнаружены | motion-scroll-loading-evidence/m01-flutter-devices.log |
| Live web media | Slot=0 во время ожидания и после error; успешные изображения изменяют высоту карточек значительно больше 2 CSS px | motion-scroll-loading-evidence/m01-media.json |
| HTTP normal/delay/error/reorder/timeout | Отдельные scratch probes, без изменения server/test проекта. Все пять probes passed, exit 0: normal 4 polls/media 200/404; delay 2010.34 мс; error 503→200; reorder 10/true→9/false при votesCount=10; timeout HTTP 504 через 15008.79 мс. HTTP mock не проверяет realtime и client merge | motion-scroll-loading-evidence/m01-http-probes.log и m01-http-probes.mjs |

### Race

Выполнен существующий FeedPage.test.tsx: records a stale vote response replacing a newer like response. Порядок MSW gate: vote-start → like-finish → vote-finish. После like кнопка показывает Like(10), aria-pressed=true; после старого vote — Like(9), aria-pressed=false. **Дефект воспроизведён.** Положительный результат теста здесь подтверждает старую ошибку, а не корректность merge. Тест находится в FeedPage.test.tsx; usePollMutations.test.tsx отдельно проверяет обычную полную замену cache.

HTTP reorder fixture сам возвращает независимые snapshots от initial и не строит итоговый авторитетный combined state; это генератор входов, а не доказательство сходимости backend. Обратный порядок, realtime между HTTP, duplicate и stale refetch в клиентском harness **не проверены**; их готовит M02 и проверяют M03/M05/M06.

### Media: live web, dev build

Vite 127.0.0.1:5179 → fixture API 127.0.0.1:3128, normal, T02_MEDIA_DELAY_MS=5000. Build: существующие исходники в Vite dev mode; это функциональная проверка, не production profiling. Viewport 739×626 CSS px, DPR 1.1979166269302368; browser — Codex in-app browser, точная версия движка не установлена. Между двумя measurements пользовательского scroll не было.

| ID | Высота img pending → complete, CSS px | Высота карточки до → после, CSS px | Delta |
|---|---:|---:|---:|
| motion-count-10 / landscape | 0 → 345.9261 | 459.1305 → 786.6913 | +327.5609 |
| motion-count-99 / portrait | 0 → 768.7435 | 459.1305 → 1209.5088 | +750.3783 |
| motion-count-100-image-error | 0 → 0, naturalWidth=0 | 459.1305 → 459.1305 | 0, но зарезервированной области нет |

Координата options первого media poll изменилась 1173.6914 → 1501.2523; options следующих двух карточек — на +1077.9393/+1077.9392 CSS px, включая рост карточек выше них. Delta карточки не приравнивается к intrinsic высоте изображения: записан фактический итог layout. Условия cold media воспроизведены reload; error не даёт fallback 16:9.

Flutter media проверен по текущему коду AspectRatio(16/9)+errorBuilder и успешному fixture/truncation widget test полного suite. Живой Flutter media loading/error, text scale 200% и anchor ≤2 logical px на устройстве **не проверены**. Исторический web Back=0 px из T02 в свежий результат не перенесён.

### 15 Flutter failures: все воспроизведены

Это failures тестов. Их наличие само по себе не доказывает, что наблюдаемый продуктовый сценарий сломан: для некоторых видны устаревшие finders или проблемы test lifecycle.

| Файл / тест | Свежая причина в логе | Связь / задача для разбора |
|---|---|---|
| auth_api_client_avatar_test.dart — uploads avatar as multipart field avatar | Bad state: Can't finalize a finalized Request | Вне motion scope; существующий test/API harness defect. Учитывать в общей приёмке M17, не чинить в M01. |
| auth_screen_test.dart — does not select a country by default | tap Sign Up вне 800×600 viewport; Select your country не найден | Вне поверхности PRD; отдельный auth/test follow-up, M17 фиксирует исключение. |
| auth_screen_test.dart — keeps selected country after registration error | Bad state: No element при finder | Вне поверхности PRD; отдельный auth/test follow-up. |
| poll_card_report_test.dart — renders the poll actions with hierarchy and optional edit | Cancel vote не найден | Связан с существующими actions/overflow; M10, сверить текущую навигацию меню и тест, не расширять действия. |
| profile_screen_test.dart — profile opens a dedicated settings page | Timer still pending after widget tree disposed | Test/lifecycle, M08; не объявлять ошибкой navigation без отдельной проверки. |
| profile_screen_test.dart — refreshes my polls when requested after a new poll is created | Timer still pending | M08; сценарий сохранения/refresh — M06/M14. |
| profile_screen_test.dart — updates my poll after like response | Timer still pending | M08; обновление state — M06. |
| profile_screen_test.dart — removes a poll after unliking it from liked polls | Timer still pending | M08; удаление/anchor — M12/M14. |
| profile_screen_test.dart — updates my polls comments count after returning from comments | Timer still pending | M08; back/state — M06/M14. |
| search_screen_test.dart — shows discovery sections before a query is entered | Ожидаемый вопрос Which feature should be next? не найден | M16/M10: discovery loading/layout/test expectations. |
| search_screen_test.dart — shows the latest successful searches in reverse chronological order | Две Y-координаты равны 226, ожидается строгий порядок | M10/M14: фактическая геометрия/history; root cause не установлена. |
| search_screen_test.dart — clears the query from the search bar | tap predicate finder не нашёл widget | M14/M16: сверить текущий clear control/контекст поиска. |
| search_screen_test.dart — shows empty and retryable error states | Could not complete search. не найден | M08/M16: error/Retry/test expectations. |
| search_screen_test.dart — filter changes preserve query and reset pagination | pumpAndSettle timed out | M08/M14/M16: loading/query reset/test lifecycle. |
| widget_test.dart — shows auth entry point | REGISTER не найден, ожидается 2 элемента | Вне поверхности PRD; устаревшее ожидание auth UI требует отдельного разбора. |

Profile tests не инжектируют RealtimeClient; в логе timers связан с RealtimeClient._startHeartbeat (periodic 20 с). Это кандидат причины lifecycle failure, а не уже выполненное исправление. Feed pending-like, T02 fixture/truncation и Search two-page cursor сценарии прошли в свежем полном suite. Web и Flutter tests не проверяют G0 автоматически.

## 4. Реестр дефектов и проверок

У каждого дефекта в scope указан воспроизводимый сценарий и владелец M03–M16. Статические риски требуют regression harness перед исправлением; статус не повышается до runtime reproduction по одному чтению кода.

| ID / состояние | Сценарий и evidence | Владелец |
|---|---|---|
| D01 — воспроизведён, web stale snapshot | Удержать vote, завершить like, затем отдать старый vote: likes 10/true → 9/false. FeedPage race test и scratch HTTP inputs. | M03 контракт свежести; M05 merge; M04 только по решению M03. |
| D02 — не проверен, Flutter HTTP/realtime merge; статический риск | Аналогичный reordered vote/like в F1/F2/F3, затем realtime vote и старый list response. Whole-PollSummary replacement; vote realtime сохраняет viewerVoteOptionId, но не viewerHasLiked. | M03/M06. |
| D03 — не проверен, web repeated taps/global pending; подтверждён кодом | 10 rapid taps Like одного poll при задержанном ответе; одновременно Vote другого poll. Like callback не guarded; isVoting общий для всей Feed. Cancel/delete также не имеют per-poll guard. | M05. |
| D04 — не воспроизведён для Flutter pending-like | Текущий Feed widget test blocks repeated likes while the first request is pending прошёл. Отдельные voting/liking Sets уже существуют. Rapid vote, независимый poll, остальные экраны не проверены в таком сочетании. | M06 сохраняет поведение и расширяет coverage. |
| D05 — не проверен, поздний poll response в другой session/query | Начать mutation, logout → другой user → завершить ответ; повторить unmount/query change. QueryClient.clear и mounted не заменяют domain/session generation guard. Notifications epoch уже существует отдельно. | M07 (web), M08 (Flutter), state guards M05/M06. |
| D06 — воспроизведён, web media geometry | Pending image slot=0; success меняет cardHeight на +327.56/+750.38 CSS px; intentional error остаётся без 16:9 fallback. | M09. |
| D07 — частично проверен; M10 UI/accessibility defects устранены на Samsung 200% | На Samsung A32 (1080×2400, `font_scale=2.0`) repaired APK показывает весь composer button, переносит Share на следующую строку и оборачивает Search heading без clipping. TalkBack hierarchy именует author avatar `Open yask066 profile` и center action `Create poll`. Счётчики 9→10/99→100/999→1000, pending→success/error и точные cardHeight/anchor deltas ещё измерить. | M09 (web), M10 (Flutter). [Android evidence](motion-scroll-loading-evidence/m17-android-checks.md). |
| D08 — не проверен, Flutter identity/deletion | Удалить карточку выше viewport/сам anchor в F1/F3/F4/F5; PollCard и option widgets без стабильных keys. Сохранить следующий/предыдущий surviving ID и координату. | M06 identity, M10 layout, M12/M14 anchor. |
| D09 — не проверен, общий scroll context/back | Search load-more → comments/profile → back/remount; менять tab/sort/query; удалить несколько rows выше anchor, затем logout. Нет общего контекста route/list/query/filter/sort/user и fallback anchor. | M11/M13 (web), M12/M14 (Flutter). |
| D10 — исправлен в M14, перепроверен в M17 | Две Search страницы с пересекающимся poll ID давали 5 строк вместо 4 уникальных. Search pagination объединяет результаты по стабильному `poll-<id>`/`user-<id>`, сохраняет порядок первого появления и последнее значение элемента. Strict `M14 page_dedup keeps one row per poll ID`: RED 9 rows вместо 7 expected (с separators), после fix GREEN 1/1. | M14/M17; [M17 verification](motion-scroll-loading-evidence/m17-verification.md). |
| D11 — не проверен, Web Notifications realtime insertion; подтверждён кодом | Прокрутить inbox вниз, inject notification.created. WS вызывает applyRealtime без фактического atTop; default true. pending banner/новая row могут сдвигать контент. | M11/M13; guard/merge M07 при необходимости. |
| D12 — не проверен, notification top threshold/прочитанные rows | Flutter 1<offset<24 и новый event; unread filter → read/remove anchor. Текущий atTop использует ≤1 вместо ≤24; anchor/fallback не доказаны. | M12/M14. |
| D13 — не проверен, deadline/ambiguous timeout; подтверждён кодом | Задержать poll reads/mutations на >10 с; retry/foreground. Web ApiClient без deadline; Flutter deadlines есть лишь на части reads, PollsApiClient mutations/profile/comments без общего timeout. Subscriptions refresh TimeoutException не ловит. | M07/M08. |
| D14 — не проверен, матрица loading/cache/error; подтверждён кодом | Cached data → refetch error/load-more error → Retry. W2 нет skeleton/empty/Retry; W4 root error заменяет cached rows и не даёт Retry; F2 load-more error с существующим списком не показывается; F5 refresh прячет контент. Skeleton delay 150 мс единообразно не реализован. | M15 (web), M16 (Flutter), deadlines M07/M08. |
| D15 — воспроизведён, связанные Flutter test failures | Сценарии Profile/Search/PollCard из таблицы выше. Исправлять после отделения test harness/finders от domain/UI defects. | M08/M10/M14/M16, по конкретной строке. |

Reordered reverse, stale refetch, duplicate realtime, refresh timeout/retry, удаление anchor, keyboard close, session switch и 20 list→detail→back cycles остаются открытыми сценариями. Новый realtime transport, feed pagination, web subscriptions, реакции Search/PublicProfile и голосование Flutter comments не добавляются.

## 5. Среда и доступ к profiling

| Фактически проверено | Состояние |
|---|---|
| Windows | Windows 11 Home x64, build 10.0.26200.9457 по свежему flutter devices; CPU Intel Core i7-10870H @2.20GHz. GPU/частота монитора/энергопрофиль не установлены. |
| Node/npm | Node 24.7.0, npm 11.5.1. Web test runner Vitest 3.2.4/Vite 6.3.5 из существующих зависимостей проекта. |
| Flutter/Dart | Flutter 3.44.5 stable, Dart 3.12.2; framework f94f4fc76b4d74543ed9b085bbd75341ef65de22, engine 83675ed27633283e7fc296c8bca22e841224c096 по локальному flutter.version.json. |
| Flutter execution | Widget tests с flutter_tester на Windows. Из-за denied SDK lockfile использована копия локального SDK и приложения в work. Ничего не менялось в lib/test: SHA-256 совпал для 43/43 lib files и 29/29 test files. package_config преобразован для чтения существующих dependencies и текущей копии package; package_graph скопирован. Это не device profile build. |
| Android | adb не найден в PATH при свежем Get-Command; стандартный user Android SDK platform-tools отсутствует; flutter devices --machine не показывает Android. Физический Android/эмулятор в этой сессии недоступен. 60/120 Hz, profile mode и traces — не измерено. |
| iOS | iOS target не обнаружен; host Windows, доступного macOS/Xcode/iPhone workflow нет. 60 Hz/ProMotion и traces — не измерено. |
| Browser | Codex in-app browser доступен для DOM/geometry и screenshots; свежий media functional run выполнен. Chrome installation содержит каталоги 154.0.8037.59 и .93; это не доказательство версии текущего IAB. Performance trace этого browser session не снят. |
| Production web / AC-12 | Production build, desktop 1440×900 и responsive 390×844, по три 30-секундных прогона, CPU/GPU/DPR/Hz и frame classification — не измерено. Functional dev media run этого не заменяет. |

Reference-модели/OS versions из T02 не объявлены подключёнными устройствами и не повторяются как фактическое окружение. Отсутствие устройств не мешает M01 составить аудит, но оставляет M17/M18 G0 и соответствующий motion-допуск открытыми.

## 6. Команды и воспроизводимость

Обычные команды из проекта:

    node --test scripts/t02-motion-scroll-baseline-server.test.mjs
    npm run test -w @yaskapp/web -- --run src/features/feed/FeedPage.test.tsx src/components/PollCard.test.tsx src/features/polls/usePollMutations.test.tsx
    npm run test -w @yaskapp/web -- --run

Из apps/mobile:

    flutter test --no-pub --reporter expanded
    flutter devices --machine

Обычный npm command в этой сессии остановился до тестов с EPERM на apps/web/node_modules/.vite-temp. Выполненная эквивалентная команда использует существующие source/dependencies и временный config, повторяющий react plugin, jsdom, setupFiles и exclude проекта; только cacheDir вынесен в work:

    node D:/yaskapp/node_modules/vitest/vitest.mjs --run --config <work>/m01-vitest.config.mjs --configLoader native [три test paths для targeted run]

Flutter запускался из <work>/portable-repo/apps/mobile после копирования точного lib/test/assets/fixture и metadata:

    $env:LOCALAPPDATA='<work>/dart-appdata'
    $env:FLUTTER_ROOT='<work>/flutter-sdk'
    [Environment]::SetEnvironmentVariable('ProgramFiles(x86)','C:/Program Files (x86)','Process')
    & '<work>/flutter-sdk/bin/cache/dart-sdk/bin/dart.exe' '<work>/flutter-sdk/bin/cache/flutter_tools.snapshot' --no-version-check --suppress-analytics test --no-pub --reporter expanded

Тот же launcher с devices --machine получил список устройств. LOCALAPPDATA/FLUTTER_ROOT и Windows path менялись только в дочернем процессе, не в настройках пользователя. Тесты использовали готовые локальные зависимости; fixture/data исходного репозитория не редактировались.

Для media: локальный T02 server с normal, T02_PORT=3128, T02_HOST=127.0.0.1, T02_MEDIA_DELAY_MS=5000; Vite с портом 5179 и proxy на 3128 через временный config. Для HTTP scratch probes seed — фиксированный JSON fixture, delays — server defaults 0/2000/100/800/15000 мс. Scratch probe не расширяет M02 fixtures и не заменяет websocket integration.

Evidence/logs, harness config, probe script и SHA-256 verification summary приложены отдельно. Failed setup попытки также сохранены; их exit codes не включены в pass/fail подсчёт тестов.

## 7. Проверка полноты относительно PRD и передача задач

- Все реальные PRD-поверхности покрыты: F1–F7 и W1–W5. My/Liked входят в F4; отсутствующие web lists/actions явно исключены.
- FR-01/FR-02: cache, independent fields, pending, per-poll identity и subscriptions перечислены; D01–D05/D10 → M03/M05/M06/M07/M08.
- FR-03: confirmed error/ambiguous timeout/retry и lifecycle не объявлены проверенными по одному happy path; D13 → M07/M08.
- FR-04: media success/error freshly measured в web, Flutter slot inspected; counts/pending/text scale требуют замеров; D06–D08 → M09/M10.
- FR-05: scroll containers, back paths, pagination, session/query context, deletion fallback и comment target перечислены; D08–D12 → M11–M14.
- FR-06: initial/cache/refresh/load-more/pending/empty/error/retry перечислены по каждой поверхности; D14 → M15/M16.
- AC-12/AC-15: реальные fresh failures и недоступный device profiling сохранены; старые pass claims не повторены.
- M02 получает gaps fixtures/harness: reverse order, realtime injection, stale refetch, repeated IDs, 0 и 999/1000, 100 уникальных profiling IDs. Одностраничный Feed API сохраняется.
- M03 получает доказанный stale whole-snapshot rollback; backend расширение M04 нельзя решить до freshness contract.
- G0 не пройден и не запрошен; M19–M25 этим аудитом не разрешены.

Проведён самостоятельный review документа против M01 и PRD. Решения по scope: выполнена только M01, без перехода к M02; работа выполнена в D:/yaskapp по прямому указанию пользователя; subagents не запускались, поскольку план допускает делегирование только с отдельного разрешения пользователя. Исторический T02 и приложение сохранены без изменений. Непроведённые проверки указаны явно.

## 8. Финальная проверка артефактов

Патч применён через `git apply` после успешного `git apply --check`; запись Git потребовала разрешения вне песочницы. Исходный HEAD совпал с `m01-source-verification.json`: `455e8f443a982ec3c5cbe7063a4b4670a06d1dec`. Проверены наличие всех evidence-файлов, JSON, итоговые счётчики web/Flutter в логах и 15 отдельных Flutter failures; они соответствуют разделу 3. Матрица F1–F7/W1–W5 сверена с PRD, ключевые утверждения о merge, identity и subscriptions — с текущими исходниками.

Повторно выполнены при закрытии M01:

- `node --test scripts/t02-motion-scroll-baseline-server.test.mjs`: 1/1, exit 0.
- `node docs/motion-scroll-loading-evidence/m01-http-probes.mjs`: normal/delay/error/reorder/timeout, все пять сценариев прошли, exit 0; delay 2010.56 мс, timeout 15009.88 мс. Reorder снова вернул snapshots 10/true → 9/false; клиентский merge/realtime этим probe не проверяется.

- `npm run test -w @yaskapp/web -- --run`: 122/122, 24 файла, exit 0; лог `motion-scroll-loading-evidence/m01-closure-web-suite.log`. В выводе остаются 9 сообщений MSW о запросах без handler; успешный suite не означает чистый диагностический вывод.

Запуск npm внутри песочницы остановился до тестов с EPERM на `.vite-temp`; повторный запуск выполнен с предоставленным разрешением. Исторические evidence-логи сохранены дословно, включая пробелы и диагностические сообщения. Новая проверка Flutter не выполнялась: подтверждены соответствие исходного HEAD и наличие всех 15 failures в импортированном логе, а не заявлен повторный widget run.

Самостоятельный review при закрытии M01: все пять пунктов task 1 подтверждены артефактами; M02–M27 не отмечены выполненными. Проверены ссылки на evidence и JSON, изменены только документы и evidence; приложение, tests и исторический T02 не изменены. Whitespace в исходных `.log` сохранён как часть сырого evidence; он не является дефектом приложения.

## 9. M02: fixture и управляемые сценарии

Выполнена 2 октября 2026 года от `9c48b9d`, в ветке `codex/m02-motion-fixtures`. Разделы 1–8 сохраняют исторический результат M01. Изменены fixture, HTTP harness, test adapters и клиентские тесты; production Flutter/web state и backend не менялись.

### Данные и воспроизводимость

Общий JSON: `test/fixtures/t02-motion-scroll-loading-polls.json`, fixtureVersion=2, seed=`20261002`. Восемь карточек с counts `9, 10, 99, 100, 0, 999, 1000, 10`; последняя содержит равные результаты `5/5`. Длинный вопрос, landscape/portrait media и отсутствующее media сохранены. Search возвращает две страницы: первая содержит long-text/count-10, вторая повторяет count-10 перед count-99/count-100-image-error. Пять входных записей соответствуют четырём уникальным ID.

Profiling генераторы HTTP, web и Flutter используют один seed и одну схему: циклический выбор исходной карточки `(seed + index) % 8`, ID `motion-profile-20261002-001` … `100`, новые option IDs. Создаются 100 уникальных poll IDs и 200 option IDs; входные данные не мутируются. `/polls` остаётся одностраничным, без `nextCursor`; 100 карточек включаются только сценарием `profiling` либо тестовым адаптером. Это подготовка данных, не замер AC-12.

HTTP сценарии: `normal`, `delay` (2000 мс), `error` (первый feed GET 503, повторный 200), `timeout` (15000 мс → 504), `reorder` (like 100 мс, vote 800 мс), `reorder-reverse` (vote 100 мс, like 800 мс), `profiling`. Media delay задаётся отдельно `T02_MEDIA_DELAY_MS`; фиксированный slow-media сценарий — 2000 мс, короткая HTTP-проверка — 40 мс. Missing media стабильно возвращает 404 при повторе; исправное media — SVG 200.

Пример запуска из корня в PowerShell:

```powershell
$env:T02_HOST='127.0.0.1'
$env:T02_PORT='3000'
$env:T02_SCENARIO='profiling'
$env:T02_SEED='20261002'
$env:T02_MEDIA_DELAY_MS='2000'
node scripts/t02-motion-scroll-baseline-server.mjs
```

### Client gates и строгие проверки

Web mutation tests проходят через настоящий `usePollMutations`, API decode и QueryClient, MSW удерживает ответы отдельными gates. Проверяются feed, popular, user-polls и detail caches. Flutter использует реальные FeedScreen callbacks и отображаемый PollCard, Completable vote/like/refetch и инъекцию `PollVoteRealtimeEvent` в существующий subscribed stream. Realtime событие приходит дважды до позднего HTTP vote; проверяется отсутствие двойного increment и сохранение viewer-specific полей.

Общие snapshots и порядок находятся в `race` JSON. Желаемый итог обоих порядков: votes=10, option votes=[6,4], selected first option, likes=10, viewerHasLiked=true. Realtime-сценарий требует votes=11/[7,4], сохраняя selected option и like. Stale refetch запускается до действий и доставляется после их завершения.

| Строгий сценарий | Web | Flutter | Владелец исправления |
|---|---|---|---|
| vote-start → like-finish → vote-finish | Воспроизведён откат likes 10/true → 9/false | Тот же откат | M03/M05/M06 |
| like-start → vote-finish → like-finish | Воспроизведён откат votes 10 → 9 и selected option → null | Тот же откат | M03/M05/M06 |
| stale refetch после completed vote/like | Оба поля возвращаются к baseline | Тот же откат | M03/M05/M06 |
| duplicate realtime до позднего HTTP | Poll realtime transport отсутствует; не проверен | Realtime votes=11; поздний HTTP откатывает до 10 и теряет like | M03/M06 |
| повтор ID между cursor pages | Feed/search pagination не добавлялась | 5 строк вместо 4 уникальных (9 children вместо 7 с separators) | M14 |

Старая web characterization-проверка, утверждавшая именно ошибочный откат, заменена строгими mutation regressions. Web использует явно помеченный `test.fails`: неожиданное прохождение требует убрать expected-failure modifier в M05. Для вывода сырых failures задаётся `M02_RUN_KNOWN_FAILURES=1`. Flutter, где нет такого modifier, по умолчанию явно пропускает 5 известных red cases; opt-in через `--dart-define=M02_RUN_KNOWN_FAILURES=true`. В M06/M14 убрать соответствующий skip после исправления. Ни один assertion правильного состояния не ослаблен.

HTTP mock не считается realtime-тестом; web Poll realtime не создавался. Flutter injection проверяет клиентскую подписку и merge, а не реальный websocket/backend delivery. Остальные поверхности, session switch, lifecycle и scroll остаются входом последующих задач.

### Команды и свежие результаты

```powershell
# Корень
node --test scripts/t02-motion-scroll-baseline-server.test.mjs
npm run test -w @yaskapp/web -- --run
npm run typecheck -w @yaskapp/web
npm run lint -w @yaskapp/web
$env:M02_RUN_KNOWN_FAILURES='1'
npm run test -w @yaskapp/web -- --run src/features/polls/usePollMutations.test.tsx
Remove-Item Env:M02_RUN_KNOWN_FAILURES

# apps/mobile; используемый локальный SDK D:/flutter
$env:LOCALAPPDATA='D:/yaskapp/.dart-appdata'
D:/flutter/bin/flutter.bat test --no-pub --reporter expanded
D:/flutter/bin/flutter.bat test --no-pub --dart-define=M02_RUN_KNOWN_FAILURES=true --plain-name M06 test/feed_screen_test.dart
D:/flutter/bin/flutter.bat test --no-pub --dart-define=M02_RUN_KNOWN_FAILURES=true --plain-name M14 test/search_screen_test.dart
D:/flutter/bin/cache/dart-sdk/bin/dart.exe analyze test/feed_screen_test.dart test/search_screen_test.dart test/support/motion_scroll_fixture.dart
```

| Проверка | Фактический результат |
|---|---|
| Node HTTP/fixture | 10/10 passed, exit 0; включая normal, retry, оба reorder, media, delay/timeout и profiling |
| Web full suite | 25 файлов, 126 passed, exit 0; 123 обычных и 3 expected failures M05. Сохраняются прежние MSW unhandled-request diagnostics |
| Web raw regressions | 1 passed / 3 failed, exit 1; [сырой лог](motion-scroll-loading-evidence/m02-web-races.txt) |
| Web TypeScript | passed, exit 0 |
| ESLint только четырёх изменённых TS/TSX файлов | passed, exit 0 |
| Web full lint | exit 1: прежние warnings missing `repliesQuery` в CommentThread.tsx:71 и `sessionIdentity` в notification-store.tsx:181; эти production файлы не изменены |
| Flutter full suite | 142 passed / 15 failed / 5 skipped, exit 1; все 15 failures совпадают с реестром M01 в разделе 3; [полный лог](motion-scroll-loading-evidence/m02-mobile-suite.txt) |
| Flutter raw M06 | 4 failed, exit 1; каждый дошёл до строгого final-state assertion; [лог](motion-scroll-loading-evidence/m02-mobile-races.txt) |
| Flutter raw M14 | 1 failed, exit 1; desired unique-row count 7, actual 9; [лог](motion-scroll-loading-evidence/m02-mobile-dedup.txt) |
| Dart analyze | нет новых issues; exit 1 из-за прежнего unused local `navy` в feed_screen_test.dart (теперь строка 270; подтверждено в исходном HEAD) |
| git diff --check | passed для исходников/документов; пробелы в сырых логах сохраняются как evidence |

Vite и SDK требуют записи служебных файлов: запуски выполнялись вне sandbox с разрешением. Первая Flutter попытка в sandbox не дала вывода и остановлена; Windows batch launcher также некорректно передал regex с `|`, поэтому M06 и M14 запущены отдельными командами без regex. Эти setup failures не считаются correctness results.

Проведён самостоятельный review против M02 и PRD; делегирование не применялось по ограничению плана. Известные merge/page-dedup failures остаются строгими входами M05/M06/M14, прежние 15 Flutter failures и три статических предупреждения не скрыты. Device profiling, text scale 200% geometry и G0 в M02 не измерялись. На момент этого M02 отчёта M03–M27 не исполнялись.

## M17: повторная regression-проверка 7 октября 2026 года

Полные web checks свежие: 210/210 tests, typecheck, lint и production build прошли. Строгий Flutter M06 race set прошёл 6/6. Strict M14 dedup regression сначала воспроизвёл 9 строк вместо ожидаемых 7; причина — безусловный append cursor page. По stable result ID добавлено объединение страниц с сохранением порядка и последнего значения; повторный строгий тест прошёл 1/1. После M10 repair полный Flutter suite: 223 passed, 13 failures, 1 skipped; четыре новые layout/accessibility regressions прошли. Оставшиеся failures относятся к ранее зарегистрированным auth/profile/search test/UI/lifecycle категориям из таблицы M01. Подробности и все логи находятся в [M17 verification](motion-scroll-loading-evidence/m17-verification.md). Полный Flutter analyze завершился с 11 ранее существовавшими diagnostics; edited-file analyze оставил только два прежних unused warnings в Home/test.

На T02 profiling fixture проведено 20 list→detail→back циклов в dev server (0 px при 1280×720/DPR 1.1979) и повторно в production build (20/20 detail/back, anchor delta 0 px при 1440×900/DPR 1). Tab keyboard smoke проверен в обоих случаях; production AX tree включает именованные `Like (...)`/`Comments (...)` кнопки и poll headings. Это browser/CDP AX smoke, не TalkBack/VoiceOver.

Дополнительно в production web build сняты Chromium 3×30 с traces для 1440×900/DPR 1 и 390×844/DPR 3 плюс initial load; данные и сжатые frame-event traces находятся в [M17 verification](motion-scroll-loading-evidence/m17-verification.md). Ранний profiling workload со smooth scrolling признан некорректным и исключён; сохранены только traces с instant scroll шагом 32 CSS px/frame. Фактическая среда — HeadlessChrome 155.0.8059.39; BeginFrame cadence близка к 60 Hz и `MISSED` subtype встречался 0–1 раз на ~1 803 кадров. Это дополнительное evidence, не reference physical-monitor execution-time profile.

Последующая проверка 7 октября обнаружила физический Samsung A32 (Android 13/API 33). После M10 repair profile APK пересобрана/установлена; 200% проверки подтвердили, что Feed composer и metrics полностью видимы, Search heading переносится, TalkBack hierarchy именует avatar и center create action. Настройки восстановлены, TalkBack выключен; аудио отдельно не прослушивалось. На трёх 30-секундных Flutter Perfetto traces при 90 Hz рассчитаны UI `Frame` p95/max: 5.723/14.929, 4.032/16.575 и 5.416/25.550 мс; 18/5 674 UI slices выше 11.111 мс. Отдельный engine `SceneDisplayLag` зафиксировал 1 423/2 011/1 811 raster-late events; см. точные данные и ограничения в [Flutter profile](motion-scroll-loading-evidence/m17-flutter-android-profile.md) и [JSON](motion-scroll-loading-evidence/m17-flutter-frame-metrics.json). Это не подтверждает Android AC-12: UI Frame slices не дают end-to-end presentation latency, denominator всех представленных кадров отсутствует, trace processor сообщил о потерянных событиях. Отдельно закрыт физический Chrome display baseline: Chrome 155 на мониторе 1680×1050/60 Hz, три 30-секундных production runs; page source показал 0–0.0555% scheduler `MISSED` frames, p95/max compositor and GPU stages записаны в [M17 verification](motion-scroll-loading-evidence/m17-verification.md#physical-chrome--monitor-profile). Полный suite после repair: 223 passed, 13 failures, 1 skipped. iOS недоступен, Android AVD ранее требовал отсутствующий system image. M17 остаётся незавершённой по Android AC-12 и iOS; G0 не пройден. [Android follow-up](motion-scroll-loading-evidence/m17-android-checks.md).
