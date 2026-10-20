# T07 chronological query plans

Captured 2026-10-20 on the local Docker PostgreSQL 16 test service. The disposable database contained 100,001 public polls, 10,000 roots on one poll, and 2,000 replies under one root. Each repository method ran with `limit=20`; the captured plans cover its first page and one deep continuation. This is a query-plan check, not the performance acceptance run assigned to T26.

The capture used the SQL issued by the repository methods with `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING OFF)`. The full plans are preserved in [before](t07-query-plans-before.txt) and [after](t07-query-plans-after.txt).

| Surface | Before | After | Execution time, first / deep |
|---|---|---|---:|
| Newest feed | `polls_public_created_at_idx` followed by tuple sort | `polls_public_created_at_id_idx`, no tuple sort | 0.177 / 0.115 ms → 0.187 / 0.094 ms |
| Subscriptions | `polls_public_created_at_idx` followed by tuple sort | `polls_public_created_at_id_idx`, no tuple sort | 0.109 / 0.116 ms → 0.078 / 0.083 ms |
| Roots | The high-watermark scan sorted all 10,000 available roots by formatted timestamp; candidate selection used `comments_poll_created_at_idx` | High-watermark and page candidates use `comments_poll_root_created_at_id_idx` | 10.431 / 8.746 ms → 1.016 / 0.365 ms |
| Replies | The high-watermark scan sorted all 2,000 replies by formatted timestamp; candidate selection used `comments_parent_created_at_idx` | High-watermark and page candidates use `comments_parent_reply_created_at_id_idx` | 2.068 / 2.028 ms → 0.327 / 0.264 ms |

After the change, each page-candidate scan returned 21 rows for a 20-item page, and the roots/replies high-watermark lookup used the tuple index to fetch one row instead of sorting the full comment level. The roots response still computes each displayed `repliesCount` in the page query; it does not count the complete root set or issue one application query per row. Repository tests assert bounded candidate selection and one page query per comments surface.

The measured times are single local runs with a warm database cache and are not p95 evidence. The migration uses ordinary `CREATE INDEX` because the current migrator wraps each migration in a transaction; this keeps the index changes in the tested migration path, while index creation blocks writes to the indexed table until the transaction completes.

## Sparse subscriptions scenario

A supplemental plan distributed 100,000 polls over 1,000 authors and followed 10 authors. The first page used the existing author-first `polls_author_created_at_idx`; a deep continuation instead scanned the public chronological index and sorted followed candidates, with 4,923 shared buffer hits in this synthetic dataset. The full plan is preserved in [t07-query-plans-sparse-after.txt](t07-query-plans-sparse-after.txt). This is a plan-shape observation, not a latency gate; T26 should measure sparse and dense follow graphs before deciding whether subscriptions needs a query-strategy change.

Expected ID traversal and compatibility are covered by `polls.integration.test.ts`: 125-item poll/root walks, 65 replies, high-watermark insertions, deleted boundaries, hidden authors, legacy defaults, cursor scope, and sub-millisecond timestamp boundaries.
