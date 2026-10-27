# T26 load harness

**Текущий статус:** пункт T26 закрыт по решению пользователя без staging-прогона. Производительность и очистка на целевой среде не проверялись; результаты ниже описывают критерии для будущего запуска.

`scripts/pagination-load.mjs` seeds a namespaced dataset through the T02 fixture helper, measures the pagination API, captures query plans, and verifies seed-scoped cleanup. It refuses to seed a database that already contains polls. Run it only against the dedicated staging/test API and database selected for T26.

## Local settings

Set these in a local environment file or process environment. Do not commit the reader-token file or copy its contents into evidence.

| Setting | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for the dedicated test database. |
| `PAGINATION_TEST_DB_NAME` | Exact database name from `DATABASE_URL`; the harness compares them before every mode. |
| `PAGINATION_EXPECTED_DB_HOST` | Exact host and optional port from `DATABASE_URL`; the harness compares them before every mode. |
| `PAGINATION_TARGET_LABEL` | Evidence label, for example `staging-test`. |
| `PAGINATION_API_BASE_URL` | Base URL of the API serving the same database. |
| `PAGINATION_EXPECTED_API_HOST` | Expected API host, including a non-default port; the harness checks it against the URL. |
| `PAGINATION_LOAD_TOKEN_FILE` | Absolute path to a local text file with 20 lines, one JWT per line. Each JWT must identify a distinct active test account in this database. |
| `PAGINATION_CURSOR_SECRET` | The same cursor-signing secret configured on the target API; the harness uses the API codec to sign deep cursors and never writes the secret to evidence. |
| `PAGINATION_LOAD_WARMUP_BURSTS` | Optional warmup waves; default is 1. |
| `PAGINATION_LOAD_SAMPLE_BURSTS` | Optional measured waves; default is 5. Each wave sends 20 requests concurrently, giving 100 samples per scenario by default. |
| `PAGINATION_LOAD_MAX_DURATION_SECONDS` | Optional run ceiling; default is 1,200 seconds. |

The harness records only the configured target label plus warmup and sample counts, page sizes, the 1,000-item deep offset, and elapsed time. Database/API hostnames, URLs, credentials, tokens, cursors, and response IDs stay out of evidence.

## Run

Run from the repository root after the API dependencies and source files are present, migrations are applied, and the API is serving the selected database. The env file must also contain the target API's cursor secret and any other settings required when loading the API environment module. Substitute a new seed for every fresh dataset.

```powershell
node --env-file="C:\path\to\local-t26.env" --import tsx scripts/pagination-load.mjs seed t26-20261027 --confirm
node --env-file="C:\path\to\local-t26.env" --import tsx scripts/pagination-load.mjs load t26-20261027
node --env-file="C:\path\to\local-t26.env" --import tsx scripts/pagination-load.mjs cleanup t26-20261027 --confirm
```

Seed creates 100,000 active public polls, 10,000 roots, and 2,000 replies, using 1,000 fixture authors. The 20 reader accounts follow 20 authors for the sparse subscriptions pass so the result still has rows after the 1,000-item deep offset; load then adds the remaining follow edges for the dense pass. The token file must contain the same users for seed, load, and cleanup. Cleanup removes only IDs and relationships derived from the selected seed, plus popular snapshots created for these reader accounts during the recorded run window; it checks that seeded rows and snapshots are gone.

The load pass measures first and deep pages for newest feed, sparse/dense subscriptions, roots, and replies. For chronological endpoints, it selects the 1,000th ordered row from the seeded database and signs that boundary with the API cursor codec; the resulting cursor points to records after item 1,000 and is never included in output. Popular continuation uses a cursor at snapshot position 999. Before measuring, it creates one snapshot per reader and verifies that each contains all 100,000 poll IDs, so the deep page cannot accidentally test a truncated snapshot. Popular continuation runs before popular first-page bursts because snapshot creation enforces a three-snapshot-per-reader quota. Every measurement wave issues 20 requests concurrently. The default run uses one warmup wave and five measured waves (100 samples per scenario), with a 20-minute ceiling.

## Evidence and budgets

Each seed has a folder at `docs/pagination-evidence/t26-<seed>/`. It contains a seed/cleanup manifest and one `runs/<timestamp>/` folder per load attempt with the fixed measurement plan, raw JSONL samples, before/after query plans, summary, and a failure record if the run stops early.

The summary uses nearest-rank p95. Chronological first/deep pages and popular continuation must be at or below 500 ms; popular first-page snapshot creation must be at or below 1,500 ms. Average deep/first growth is the arithmetic mean of per-scenario average-latency ratios and must be at or below 2×. Any failed request fails the budget result. The current closure waives these checks; it does not represent a passing load test. A future run can use this harness to produce performance and cleanup evidence.
