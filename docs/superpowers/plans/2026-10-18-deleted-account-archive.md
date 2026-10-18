# Deleted account moderation archive implementation plan

**Goal:** Preserve a superadmin-only moderation record in the application PostgreSQL for 30 days after deletion, with IP history and independently retained IP bans.

**Approved scope:** The user requested the closed archive described in chat: account identifiers, IP history, related violation evidence, administrator access for 30 days, automatic expiration, and separately persisted IP bans.

**Architecture:** Extend existing deletion transactions and retention worker. Snapshot identifiers/profile, recent IP history and moderation evidence before redaction. No passwords, session tokens, media objects or external services. Use dedicated archive/ban permissions granted only to superadmins. Record successful registration/login and deletion verification IPs, normalized as PostgreSQL inet, with a 30-day rolling history. Expired records are immediately excluded by queries even before worker cleanup. Ban enforcement checks incoming API requests, with health and deletion-only routes exempt. IP ban data does not cascade with the archive.

**Execution:** Native implementation in the current working copy, preserving the preceding deletion fix.

- [x] Add a failing real-database integration test for archive snapshots, permissions, boundary expiry, cleanup, independently persisted bans and revocation.
- [x] Add migration, archive repository, IP history/ban enforcement, and snapshot calls within both deletion transactions. Preserve idempotence and rollback behavior.
- [x] Add protected archive/ban API endpoints with validation, pagination, non-cacheable responses and access/mutation auditing.
- [x] Add the archive and IP ban views to the existing moderation panel with escaped output and explicit reasons for mutations.
- [x] Connect archive/history expiration to the existing worker; update relevant fixtures and deletion text/docs.
- [x] Run focused and full serial API tests, builds, web/mobile deletion tests as warranted, and review the diff before reporting completion.

**Verified:** Full serial API 313 passed / 3 optional independent-journal tests skipped; final focused archive/admin/local-deletion integration 10/10; moderation DOM/smoke plus routing 20/20; web deletion29/29; Flutter deletion20/20; API typecheck/build and Caddy adaptation/validation passed. Independent review found no important defects. Migration applied only to the isolated local test database; no shared-server deployment was performed.

**Verification focus:** user row deletion must not cascade archive data; repeated deletion must not extend 30 days; expired archives cannot be read or used to create bans; arbitrary IPs cannot be banned through another user's archive; regular users/moderators cannot access archive endpoints; revoked bans must allow access again; spoofed forwarding headers must not override a non-proxy peer; archives never contain credentials or restore sessions.
