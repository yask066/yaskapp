# Account Deletion Release Acceptance

Run this procedure on a disposable test environment and staging only. Never use
production accounts or point the test runner at a production database. Keep
credentials, authorization headers, deletion/status tokens, and user content out
of the evidence record.

## Release gates

Do not enable the account deletion entry point until every item below has an
owner and recorded evidence:

- Product has approved the proposed 24-hour active-storage, 30-day backup,
  35-day service-record, and 30-day identifiable moderation retention periods,
  the moderation exceptions, and the poll/comment rules in
  `docs/prd-account-deletion.md`.
- The approved policy text is published and matches the client warning.
- AD-14 has passed on staging: the worker survives restart; the dedicated
  journal PostgreSQL is on a separate physical host; owner-controlled backups
  and 35-day journal retention are verified; local health/log monitoring is
  active; and a pre-deletion application backup restore does not resurrect the
  account. Record its runbook and restore exercise here:
  `____________________________`.
- API, web, and mobile builds use the same migration level. New acceptance is
  enabled only after the independent journal is healthy. Disabling the entry
  point must leave accepted operations running to completion.

## Staging fixture

Create disposable accounts with unique credentials for each run:

| Actor | Data to prepare |
| --- | --- |
| Deleting member | Two registered devices, profile/avatar, an open owned poll with current and replaced images, a closed owned poll, votes, likes, notifications, and a multi-level comment chain |
| Surviving member | Open and closed polls, comments and replies, follows, votes/likes, and a report against the deleting member |
| Reporter | A report and appeal concerning the deleting member, plus an unrelated report that must remain unchanged |
| Moderator | An assigned moderation case and an unrelated case |
| Superadmins | Two active superadmins, so the test can prove that removing one does not remove the last one |

Run two separate API processes (staging replicas) against the same staging
application PostgreSQL, journal PostgreSQL, Redis, and test media storage. The
automated E2E test currently creates two Fastify instances in one process; the
staging run must still verify separate replicas.
Record the build, migration version, worker version, and storage lifecycle
configuration.

## Scenario and evidence

For every row, record `PASS` or `FAIL`, the run identifier, and a link to
redacted logs or query results. A checked box without evidence is not a pass.

| Criterion | Evidence to collect | Result / run ID |
| --- | --- | --- |
| AC-01 | Flutter and web entry points, accessible warning, retention text, irreversibility and owned-poll discussion warning | |
| AC-02 | Cancel and wrong-password runs; prove data/session unchanged; attempt to alter user ID/token scope | |
| AC-03 | Old bearer and cookie on both API nodes; existing sockets close; new socket handshake rejected | |
| AC-04 | Profile, search, feed, lists, direct media URLs and soft-deleted content are hidden immediately after acceptance | |
| AC-05 | After completion, query for user/profile/content/device/notification/relationship rows and operation-scoped retained records | |
| AC-06 | Verify current, replaced, orphaned and versioned MinIO media objects are gone; a partial object-delete failure must not report completion | |
| AC-07 | Compare votes, likes, poll revisions, follower/following totals, replies and unread counts before and after; no negative values | |
| AC-08 | Closed-poll vote is removed; surviving members' replies remain connected and visible | |
| AC-09 | Owned polls and full discussions are removed; notification payloads do not expose the deleted profile/content | |
| AC-10 | Replay acceptance, submit it concurrently, and lose the first response; verify one durable operation and recover status using the receipt after user deletion | |
| AC-11 | Fail DB before acceptance and prove account stays active; fail storage/Redis and restart worker after acceptance, then verify closure and eventual progress | |
| AC-12 | Race acceptance against upload finalize, vote, push delivery and role change; no post-acceptance writes or counter drift | |
| AC-13 | Web reload/back navigation/tab switch and mobile logout/restart/account switch; no deleted account data reappears | |
| AC-14 | Blocked member can delete; race role change against deletion of a superadmin and retain the last superadmin | |
| AC-15 | Check reports, appeals, audit and moderation case rows against the approved retention matrix; unrelated records remain intact | |
| AC-16 | Exercise 24-hour deadline with a fake clock in tests; on staging verify expiry, retries, overdue alert, backup restore and journal reapply | |
| AC-17 | Re-register the same email/username after completion; confirm a new ID and empty profile, content, devices, relationships and notifications | |

Also retain the API, web, and mobile command outputs from
`docs/superpowers/plans/2026-10-12-account-deletion.md`. Include test names and
counts; identify skipped tests and existing failures explicitly.

## Failure and recovery runs

Run each case with disposable data and restore the fixture between cases:

1. Drop the verification response, acceptance response, and status response in
   turn. Retry using the original request/receipt and confirm one operation.
2. Interrupt application PostgreSQL, media storage, journal PostgreSQL, and
   Redis separately. Confirm acceptance fails closed when any required service
   is unavailable;
   after acceptance, access remains closed and the queue resumes.
3. Make a batch media delete partially fail. Restart the worker between retries
   and verify it does not mark the operation complete until all versions and
   objects are absent.
4. Pause the worker, accept deletion, and restart both API nodes and worker.
   Confirm the operation continues without a client session.
5. Race upload finalization, vote, push delivery, and moderator role changes
   with acceptance. Verify late writes are rejected or included in cleanup.
6. Restore application and media backups captured before acceptance. Before
   opening traffic, verify the journal identity and replay the complete
   PostgreSQL journal; confirm the account and its content remain hidden and
   queued for cleanup.
7. Set the fake clock across the 24-hour deadline and confirm retry metrics and
   the overdue alert. Do not wait 24 hours per test.

## Rollout record

Keep the feature disabled until the release gates and all AC rows pass. Enable
it for a small staging cohort first and inspect accepted/completed/retrying
counts, completion latency, deadline breaches, stage errors, residual objects,
and counter mismatches. Expand only after the cohort is clean. If rollout stops,
disable verification and new acceptance while the worker continues processing
already accepted operations.

```text
Release/build:
Migration version:
Staging environment:
Test date and timezone:
Test owner:
AC-01–AC-17 evidence location:
AD-14 restore exercise:
Product/policy approval reference:
Worker and journal health:
Rollout cohort and result:
Smoke attempt (2026-10-14): the gated account-deletion E2E command was invoked
from `services/api`; it was skipped because its dedicated test database and
required Redis, media, cloud journal/checkpoint, and feature-enable environment
variables were unavailable. No staging fixture or release acceptance was run.
Local verification (2026-10-15, Europe/Minsk): the staging journal role and
identity unit checks passed (3/3); the PostgreSQL E2E command was skipped because
`ACCOUNT_DELETION_TEST_DATABASE_URL`, `ACCOUNT_DELETION_JOURNAL_DATABASE_URL`,
Redis, test media credentials, the HMAC key, journal ID, and
`ACCOUNT_DELETION_ENABLED=true` were not configured. The staging restore drill
and two-replica release acceptance remain NOT RUN.
Final result: NOT RUN
```
