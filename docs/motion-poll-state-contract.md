# M03 — контракт свежести Poll и merge

**Решение принято:** 3 октября 2026 года. **Исследованный HEAD:** `8a794e5` (M02), ветка `codex/m03-poll-state-contract`.

M03 завершает техническое решение по [плану](superpowers/plans/2026-10-02-motion-scroll-loading.md#m03-контракт-свежести-poll-и-merge) и FR-01–FR-03 / AC-03 [PRD](prd-motion-scroll-loading.md). M04 реализовала независимые монотонные ревизии `votes`, `likes`, `comments`, согласованное чтение DTO и корректную область viewer в API/shared (commit `1568778`). Повторная проверка на отдельной PostgreSQL test DB завершена 9 октября 2026 года; результаты и оставшийся unrelated baseline failure записаны в [M04 verification](motion-scroll-loading-evidence/m04-verification.md). M05/M06 используют описанные ниже правила. G0 остаётся `NOT PASSED`; motion rollout не разрешён.

## 1. Исходная диагностика M03 (до реализации M04)

Таблица сохраняет найденное в M03 исходное состояние как историю принятого решения. Она не описывает текущую реализацию: требуемые изменения внесены M04 и проверены на отдельной test DB; см. [M04 verification](motion-scroll-loading-evidence/m04-verification.md).

| Источник | Наблюдение | Вывод |
|---|---|---|
| [SQL schema](../services/api/src/db/migrations/001_initial_social_schema.sql), `set_updated_at`, `polls_set_updated_at` | Каждый UPDATE Poll выставляет `now()` через BEFORE trigger. | Vote/cancel, like/unlike и изменение comments count обновляют timestamp в своей транзакции. Однако timestamp не является revision. |
| [Poll repository](../services/api/src/modules/polls/polls.repository.ts), `createVoteRecord`, `cancelVoteRecord`, `likePollRecord`, `unlikePollRecord`, `createPollCommentRecord`, `deletePollCommentRecord` | BEGIN → блокировка Poll → изменение связанных строк/counters → hydration → COMMIT; ошибка ведёт к ROLLBACK. Like/unlike/cancel без фактического изменения не UPDATE-ят Poll. | Counters и timestamp участвуют в одной транзакции. No-op не означает новую версию. `setVoteRecord` существует, но service его не использует; change vote запрещён текущим продуктом. |
| `hydratePolls` того же repository | Poll row, option rows, liked IDs и vote IDs читаются четырьмя отдельными SQL queries; list/detail не открывают read transaction. Часть list functions возвращает promise hydration без `await` перед `finally { release() }`. | Нет гарантии одного snapshot при concurrent writes; M04 обязана удерживать соединение до окончания чтения и обеспечить согласованность. Одного поля revision недостаточно. |
| [Shared Poll](../packages/shared/src/index.ts), `mapPoll`, list/detail/profile/subscriptions/mutation paths | Shared/backend Poll и обычная hydration содержат `updatedAt`. | Наличие поля подтверждено; гарантии строгого порядка нет. |
| [Search query/mapper](../services/api/src/modules/search/search.repository.ts), [types](../services/api/src/modules/search/search.types.ts) | Query читает Poll/counters/options одним statement, mapper включает `updatedAt`, но всегда возвращает `viewerHasLiked=false`, `viewerVoteOptionId=null`. | Это заглушки, а не персональный snapshot; их нельзя применять к известному viewer-state. M04 должна читать реальные viewer fields для authenticated search в том же SQL snapshot. |
| [Web model/decoder](../apps/web/src/api/models.ts), [Flutter model](../apps/mobile/lib/src/features/polls/poll_summary.dart) | Poll не сохраняет `updatedAt`; оба decoder используют default false/null для отсутствующих viewer fields. | M05/M06 должны сохранять ревизии и различать отсутствие поля и подтверждённые false/null. |
| [Routes](../services/api/src/modules/polls/polls.routes.ts), [hub](../services/api/src/realtime/realtime.hub.ts), `sanitizePoll` | Vote broadcast вызывается после возврата committed repository result; hub удаляет только `viewerVoteOptionId`, сохраняя `viewerHasLiked` инициатора. | M04 удаляет оба персональных поля и меняет тип на `Omit<Poll, 'viewerVoteOptionId' \| 'viewerHasLiked'>`. Consumer всё равно игнорирует viewer fields любого broadcast, включая legacy. |
| [Admin deletion](../services/api/src/modules/admin/admin.repository.ts), admin/moderation routes | Poll soft delete; comment delete уменьшает Poll comments count; routes публикуют существующие deletion events после завершения операции. | Все writers comments count, включая admin path, входят в M04. Удаление Poll — терминальное состояние; событий restore/reuse UUID нет. |

`now()` — время начала транзакции, поэтому транзакция A может начать раньше B, дождаться её row lock и записать меньший timestamp после B. Timestamp также может совпасть, а `Date.toISOString()` теряет субмиллисекундную точность. Семантика времени: [PostgreSQL Current Date/Time](https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT). При Read Committed отдельные SELECT могут видеть разные commits: [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED). Это вывод из исходников и документированной семантики, **не свежий DB integration run**.

## 2. Выбранный wire contract для M04

Добавляется одно поле Poll без изменения существующих envelopes и routes:

```ts
type PollStateRevisions = {
  votes: string;
  likes: string;
  comments: string;
};
// Обязательно в ответах нового backend; optional только в клиентском decoder
// для обнаружения legacy. Отсутствие не превращается в "0".
type VersionedPoll = Poll & { stateRevisions: PollStateRevisions };
```

Каждая строка — каноническое десятичное целое `0|[1-9][0-9]*`, диапазон `0..9223372036854775807`. Wire number, leading zeros, отрицательное/дробное/слишком большое значение — invalid response, без изменения группы. В TS сравнение через `BigInt`, в Dart через `BigInt.parse`, либо длина строки + лексикографический порядок; нельзя через JS Number или дату. При переполнении транзакция отказывает целиком, без wrap/reset.

DB columns: `votes_revision`, `likes_revision`, `comments_revision` — `BIGINT NOT NULL DEFAULT 0`, CHECK >= 0. Они добавлены migration `027_poll_state_revisions.sql`. Существующие Poll получают нули независимо от counters: revision — порядок изменений после migration, а не количество реакций.

| Группа | Payload, принимаемый атомарно | Изменение revision |
|---|---|---|
| votes | `votesCount` и все `options[].votesCount`, сопоставленные по option ID | +1 при реальном vote/cancel; при возможном будущем change +1 даже если total прежний. No-op/отказ: без изменения. |
| likes | `likesCount` | +1 при фактическом insert/delete poll like; повторный POST/DELETE без изменения: прежняя revision. |
| comments | `commentsCount` | +1 при реальном create/delete comments/replies, включая admin; удаление нескольких строк одним действием меняет count на N, revision на 1. |
| viewer vote | присутствующее `viewerVoteOptionId`, включая явный null | Использует `stateRevisions.votes`, но отдельный клиентский watermark для текущего viewer/epoch. |
| viewer like | присутствующее `viewerHasLiked`, включая явный false | Использует `stateRevisions.likes`, но отдельный клиентский watermark для текущего viewer/epoch. |

Группы не меняют чужие revisions. Внутри mutation Poll row lock удерживается до COMMIT; update counter и своей revision выполняется в одном statement, option/like/comment rows — в той же транзакции. Если action меняет связанные строки, но total не меняется, revision всё равно увеличивается. Generic timestamp trigger нельзя использовать как revision trigger: он не различает no-op и группы. Прямые SQL writers должны соблюдать этот же контракт.

`votesCount = sum(options[].votesCount)`, counts — неотрицательные целые, option IDs уникальны, выбранный ID существует. Нельзя исправлять несогласованный total локальным суммированием: группа отвергается и запрашивается сверка. Полный options payload обязателен для votes; процент и полосы вычисляются после merge, ноль votes даёт нулевые доли. M03 не определяет состояние отдельных комментариев или их likes.

Poll-owned presentation (`question`, option ID/text/position, `endsAt`, image slot, cancellation policy и т. п.) неизменна после создания в текущих пользовательских endpoints. Initial HTTP задаёт эти поля; reaction merge меняет только группы выше. Несовпадение неизменной структуры требует сверки, а не переноса counts по индексам. Авторские displayName/avatar имеют отдельный profile lifecycle; Poll revisions не обещают свежесть профиля. Закрытие вычисляется по `endsAt`, не ждёт увеличения votes revision; правила сервера сохраняются.

### Все точки выдачи

`stateRevisions` обязательна в create/detail/public list/subscriptions/author list/public profile list, search `items[].poll`, ответах vote/cancel/like/unlike/create-comment и Poll в существующих `poll.vote.created`/`poll.vote.updated`. Конкретные envelopes (`{poll}`, `{items}`, search `{type,score,poll}`) не меняются. Никаких новых каналов like/comment.

Authenticated HTTP обязан возвращать **реальные** viewer fields для request principal. Search в M04 включает `EXISTS likes` и scalar vote lookup с `input.viewerId` в том же statement; default false/null mapper удаляется. Anonymous HTTP может содержать false/null для совместимости, но его ingress имеет `viewerId=null` и не подтверждает authenticated viewer state. Broadcast не содержит ни одного viewer field; `vote.optionId` описывает действие, а не голос текущего пользователя.

Read paths hydration используют `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, все SELECT выполняются до COMMIT и release; ранний return/ошибка завершает транзакцию. Альтернатива — один SQL statement со всеми группами и viewer fields; нельзя оставить четыре Read Committed queries. Mutation hydration использует своё соединение под Poll row lock и видит собственные изменения; все writers reaction groups обязаны брать этот lock. Response/event отправляется только после COMMIT. Проверка permission и чтение DTO также принадлежат одному snapshot. Search уже читает агрегаты одним statement, viewer и revisions добавляются туда же.

## 3. Правила принятия (одинаковые для web и Flutter)

В store для каждого poll ID хранятся отдельно payload + watermark `votes`, `likes`, `comments`, `viewerVote`, `viewerLike`; неизвестный watermark — `null`, не ноль. Display defaults не являются подтверждёнными значениями. Snapshot может обновить одну группу и быть старым для другой. Viewer watermark не продвигается при broadcast.

До сравнения проверяются session epoch, poll ID, tombstone, форма/инварианты группы и origin. Таблица применяется отдельно к каждой разрешённой группе:

| Входящая revision относительно принятой | HTTP read / mutation (агрегаты) | Realtime (агрегаты) | Auth HTTP viewer fields |
|---|---|---|---|
| Новый store, известная revision | Принять coherent группу | Принять группу только в store; не создавать членство в списке | Принять только при совпадении principal/epoch и наличии поля |
| Больше | Заменить **свою** группу целиком | То же; никаких increments по событию | Сравнить с отдельным viewer watermark и заменить своё поле |
| Меньше | Игнорировать группу | Игнорировать группу | Игнорировать поле относительно его viewer watermark |
| Равна, payload одинаков | Idempotent no-op | Idempotent no-op | Idempotent no-op |
| Равна, payload различается | Сохранить принятое, отметить conflict, сверить | То же | То же для одного viewer; чужой viewer отсекается раньше |
| Revision отсутствует | Правила legacy ниже | Сохранить известное; запросить HTTP | Отсутствующее поле не является false/null; watermark не менять |
| Revision malformed / нарушен invariant | Отвергнуть группу, invalid response + сверка | Отвергнуть группу + сверка | Не принимать персональное поле соответствующей invalid группы |
| Другая epoch/principal, неправильный ID или tombstone | Полный no-op для state и pending | Полный no-op | Полный no-op |

Broadcast viewer fields игнорируются **безусловно**, даже если legacy payload содержит true/null или новые revisions. Authenticated viewer fields с известной revision сравниваются отдельно даже тогда, когда aggregate revision этого HTTP уже ниже принятой из realtime. Пример: realtime votes r=2 принят, viewer watermark=0; поздний собственный vote HTTP r=1 подтверждает selected option, но не откатывает total r=2. Это необходимо для M02 `realtime_before_http`.

Equal conflict и invalid group не запрещают принять другие независимые валидные группы того же snapshot. Для отсутствующего/invalid `stateRevisions` целиком все три группы неизвестны/invalid. Для malformed одного ключа остальные сравниваются независимо. Повторяющиеся events/snapshots никогда не прибавляют counters.

### Legacy и rollout

Старый клиент игнорирует дополнительное поле и продолжает читать прежние HTTP envelopes. Hub удаляет `viewerHasLiked`; старые defaults false поддерживают его отсутствие, но существующий старый Flutter merge всё ещё может сбрасывать like: совместимость wire не означает исправление старого клиента.

Новый клиент на unversioned сервере может отобразить первый HTTP snapshot как **непроверенный bootstrap**, если в этой группе ещё нет ни известной revision, ни mutation/realtime после начала запроса. Последующие unversioned ответы не заменяют уже известные или изменённые группы. Legacy search viewer заглушки никогда не подтверждают viewer-state. Legacy broadcast служит invalidation hint, без замены известного state.

Неизвестная revision запускает один coalesced authoritative HTTP refetch для poll ID в текущей epoch. Если ответ вновь unversioned, сохраняется последнее отображаемое состояние и появляется доступная через существующий error flow ошибка синхронизации; не повторять запрос бесконечно, не ретраить mutation автоматически и не объявлять состояние свежим. Pending завершается своим token. Полноценная работа concurrent reactions нового клиента требует M04; rollout backend → clients. Reconciliation fallback не выбран в качестве замены revisions. Old backend/new client не проходит AC-03/G0.

## 4. Session, deletion и pending

`sessionEpoch` — локальный монотонный номер, не wire поле. Logout/login (включая тот же user), reset store и смена principal увеличивают epoch, очищают Poll state, tombstones и pending. Request захватывает epoch/principal при старте; websocket handler — epoch/principal при подписке. Поздний результат/ошибка/finally старой epoch не меняет новый store или pending. Query/filter generation проверяется отдельно перед применением **membership** списка/страницы: новые group values одного Poll не дают права заменить выдачу другого query.

Pending — ключ `(epoch,pollId,action)`, где action=`vote` для vote/cancel, `like` для like/unlike. Эти два действия могут идти параллельно. `beginOperation` атомарно возвращает null, если соответствующий ключ занят; 10 taps дают один запрос, Poll B остаётся доступен. `operationId` отличает старый timeout completion от новой попытки в той же epoch. Operation completion применяет только snapshot, затем очищает только совпадающий token; наконец/error без собственного token не освобождает чужой pending. Confirmed refusal ничего не меняет в confirmed groups; ambiguous timeout освобождает свой pending и требует сверки до повторения действия (M07/M08). M03 не добавляет optimistic layer; существующий слой отделяет overlay от confirmed state и откатывает только overlay собственного token.

Удаление Poll подтверждается успешным собственным DELETE или существующим `poll.admin_deleted` из текущей подписки. Это terminal tombstone `(epoch,pollId)`: удалить Poll из всех загруженных представлений, очистить его pending, игнорировать любые поздние snapshots и новые attempts для ID. UUID не переиспользуется; API restore отсутствует, поэтому отдельная wire deletion revision не нужна. В новой epoch tombstone очищается, серверные list/detail исключают deleted rows. Store сохраняет tombstone до конца epoch, включая eviction Poll. Empty list, отсутствие ID в странице, 403/404 и network failure **не доказывают permanent deletion**: исключить недоступный элемент из соответствующей выдачи и сверить, но не создавать глобальный tombstone. Comment deletion не удаляет Poll: invalidation существующего detail/comments + сверка comments revision; ответ DELETE comment сейчас не несёт Poll, локальный decrement не становится confirmed state.

## 5. Точные интерфейсы M05/M06

Это сигнатуры для реализации, а не уже добавленные exports. Ревизии, comparison и правила таблицы идентичны в обоих клиентах.

```ts
type PollOrigin = 'http' | 'mutation' | 'realtime';
type PollIngress = {
  origin: PollOrigin;
  sessionEpoch: number;
  viewerId: string | null;
  expectedPollId: string | null; // detail/mutation target; null for list batch
  // Captured at dispatch; used for legacy bootstrap eligibility.
  requestId: string;
  startedGeneration: number;
};
type PollOperationToken = {
  sessionEpoch: number;
  viewerId: string;
  pollId: string;
  action: 'vote' | 'like';
  operationId: string;
};
type PollMergeResult = {
  state: PollState | undefined; // rejected ingress must not create a new entry
  changedGroups: Array<'votes' | 'likes' | 'comments' | 'viewerVote' | 'viewerLike'>;
  needsReconcile: boolean;
};
function mergePollSnapshot(current: PollState | undefined,
  incoming: DecodedPollSnapshot, context: PollIngress,
  session: { sessionEpoch: number; viewerId: string | null }): PollMergeResult;
```

`PollState` содержит confirmed Poll, пять nullable watermarks, `deleted`, generation и признак unverified bootstrap. `DecodedPollSnapshot` сохраняет presence viewer fields и nullable/invalid revisions; нельзя терять это в decoder defaults. Invalid wire данные можно отвергнуть decoder целиком, если реализация не поддерживает partial validation, но они никогда не изменяют store. Pure merge не управляет сетью, cache shape или pending. Если rejected ingress пришёл для ещё неизвестного ID, результат state=undefined (Dart: null), changedGroups=[], без создания entry. `expectedPollId` проверяется до merge, в list batch каждый элемент проходит decoder отдельно. Request generation увеличивается при изменении confirmed state, mutation start и invalidation; bootstrap eligible только при неизменной generation от dispatch до ingress и отсутствии known watermark. Новая известная revision не отвергается только из-за более позднего dispatch другого HTTP.

Session-scoped controller обоих клиентов:

```text
ingest(snapshot, PollIngress) -> PollMergeResult
beginOperation(pollId, action) -> PollOperationToken?  // null = ignore tap
completeOperation(token, snapshot?) -> void          // owned token + epoch check
failOperation(token, ambiguous: bool) -> void
markDeleted(pollId, PollIngress) -> void
clear() -> void                                      // advance epoch + clear everything
```

Flutter `PollStateStore`: `PollSummary? pollById(String id)`, `bool isVoting(String id)`, `bool isLiking(String id)`, `void clear()`, плюс методы controller выше; `PollIngress`/`PollOperationToken` — immutable Dart classes с указанными полями. Store injected один раз на session, не владеет новым websocket. Web pure functions в `poll-state.ts`; session controller обеспечивает те же tokens и watermarks, `usePollMutations()` сохраняет `vote/cancelVote/toggleLike/deletePoll` и добавляет `isVoting(pollId)`/`isLiking(pollId)`.

List/detail ingress и mutations проходят один reducer **до** cache replacement; store fan-out обновляет только уже загруженные Poll. Web adapters сохраняют `Poll[]`, detail `Poll`, search `{items:[{type,score,poll|user}],nextCursor}` и имеющиеся page containers; не приводят nested result к Poll[]. Flutter использует ту же canonical Poll на Feed/subscriptions/profile/public-profile/search/comments там, где она отображается. List order/membership не определяются reducer; page dedup по ID принадлежит M13/M14, transport/lifecycle/retry — M07/M08.

## 6. Проверка решения на M02

[Исполняемый decision probe](motion-scroll-loading-evidence/m03-contract-probe.mjs) читает **неизменённый** JSON M02 (`fixtureVersion=2`, seed=20261002), наносит revisions только в памяти и проверяет таблицу на model. Это проверка алгоритмического решения; не production reducer, не доказательство backend атомарности и не прохождение M05/M06.

| Snapshot M02 | votes | likes | comments | Viewer scope |
|---|---|---|---|---|
| baseline / stale refetch | 0 | 0 | 0 | HTTP текущего viewer |
| независимый vote snapshot | 1 | 0 | 0 | HTTP текущего viewer |
| независимый like snapshot | 0 | 1 | 0 | HTTP текущего viewer |
| combined vote + like | 1 | 1 | 0 | HTTP текущего viewer |
| realtime votes=11/[7,4] | 2 | 0 | 0 | broadcast, viewer запрещён |

Независимые forked snapshots M02 — adversarial input, не утверждение, что backend под row lock создаёт именно такие пары. Реальный второй committed mutation snapshot может содержать обе группы r=1; результат merge тот же. Probe проверяет оба forked orders, coherent combined snapshot, late stale refetch, duplicate events, realtime перед HTTP с отдельным viewer watermark, comments isolation, equal conflict, unknown/malformed revision, bigint precision, epoch/principal/deletion и tokens pending.

Команды из корня:

```powershell
node docs/motion-scroll-loading-evidence/m03-contract-probe.mjs
node --test scripts/t02-motion-scroll-baseline-server.test.mjs
git diff --check
```

Фактические результаты записаны в [M03 evidence](motion-scroll-loading-evidence/m03-verification.txt). Исходные red M05/M06 regressions M02 остаются открытыми: клиентские merge здесь не исправлялись. DB integration, новый backend, клиентский suite и device/performance profiling в M03 не объявляются проверенными.

## 7. Exact contract assertions для следующих задач

| ID / владелец | Setup и точный assertion |
|---|---|
| C01 / M04 | Реальный vote: option +1, total +1, votes revision +1; likes/comments revisions неизменны; cancel отменяет counts и снова увеличивает votes revision. Closed/invalid/already-voted refusal не меняет revisions. |
| C02 / M04 | Like +1/+revision, unlike -1/+revision; повторный POST или DELETE: те же count и revision. Cancel без существующего vote: прежняя revision. |
| C03 / M04 | Comment/reply create +1/count +1/revision; author cascade delete N comments даёт count-N, revision+1; admin delete соблюдает тот же контракт фактического удаления. Comment like не меняет Poll comments revision. |
| C04 / M04 | Инъекция ошибки после counter/revision UPDATE до COMMIT: rollback связанных строк, counters и revisions; ни одного Poll broadcast до успешного COMMIT. На выделенной тестовой БД. |
| C05 / M04 | Gate между hydration SELECT + concurrent vote/like: один DTO coherent, total=sum(options), viewer и revision из того же snapshot. Существующие list/detail/profile/subscriptions/search/mutations все имеют валидные строки revisions. |
| C06 / M04 | Два viewers с разными vote/like: authenticated detail/list/search возвращают собственные поля; serialized broadcast не имеет обоих viewer keys. Старые web/Flutter decoders читают расширенный HTTP DTO. |
| C07 / M05–M06 | M02 оба response orders: votes=10, options=[6,4], viewerVote=option-a, likes=10, viewerLike=true; после stale baseline refetch итог полностью сохранён во всех loaded representations. |
| C08 / M06; pure web M05 без transport | Realtime votes=11/[7,4] дважды, затем HTTP vote r=1: totals остаются 11/[7,4], viewerVote=option-a, likes=10/true. Payload содержит чужие viewer null/false: они игнорируются. |
| C09 / M05–M06 | Равная revision/тот же payload: deep equal state, без increment; равная revision/иной payload: прежнее поле + needsReconcile. Более старая одна группа не запрещает принять более новую другую. |
| C10 / M05–M06 | Missing revision не становится 0; unknown/invalid не откатывает known state; absent viewer field не превращается в false/null. 9007199254740993 > 9007199254740992, без Number rounding; invalid invariant не применяется. |
| C11 / M05–M08 | A logout → B login → поздние success/error/finally A: state B и pending B неизменны. Повторный login A с новой epoch также отвергает старый A. Old websocket handler отсекается по captured epoch. |
| C12 / M05–M06 | Delete → старые HTTP/refetch/realtime и retry: Poll не воскресает ни в одном cache; tombstone переживает eviction до clear. Empty page/403/404 не создаёт terminal tombstone. |
| C13 / M05–M08 | 10 taps like/vote → по одному запросу на action; A.vote + A.like параллельны, B доступен; поздний token первой попытки не очищает pending второй в той же epoch. |
| C14 / M05–M06 | Search nested shape сохраняет user results/score/cursor; detail/feed/profile/subscriptions отражают одну canonical Poll. Old query generation не заменяет новую list membership. |

## 8. Закрытие M03 и граница доказательств

Все пять пунктов M03 покрыты: timestamp/DTO audit, таблица принятия, выбранное расширение, сигнатуры и exact assertions, semantic проверка M02. Сделан самостоятельный review против PRD и Review Focus 1–2 плана. По ограничению плана subagents не запускались. Работа document-only в текущем checkout на отдельной ветке; ledger ведётся напрямую в PowerShell вместо bash helpers. Цена этих адаптаций — отсутствие дополнительной worktree изоляции и независимого reviewer; документы и исходные regression cases доступны для последующего review.

**Дальше:** выполнить M04 с этой моделью и DB evidence; затем M05/M06. Закрытие M03 не закрывает M04 и не утверждает, что гонки приложения устранены.
