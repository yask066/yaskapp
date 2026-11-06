# Critical check fixes implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the errors reproduced by the local critical checks with minimal code changes.

**Architecture:** Count push attempts when PostgreSQL claims a job; retain the existing retry calculation and delivery flow. Correct the esbuild test against actual workspace resolution. Give lifecycle tests explicit focus and online state.

**Tech Stack:** TypeScript, PostgreSQL, node:test, Vitest.

**Spec:** User request and `.tmp/critical-checks-20261106/report.md`.

## Constraints and review focus

- Keep application code simple; no new abstraction or dependency.
- Count failed sends, missing-device attempts and recovered leases consistently.
- A crash during the final sending lease must not strand the job indefinitely.
- Test real PostgreSQL retry state in a dedicated database, without consuming other suites' jobs.
- Verify esbuild host/binary compatibility using the current override and workspace paths.
- Reproduce the web failure with an unfocused document; explicitly control test prerequisites.

## Tasks

- [x] Add PostgreSQL worker regression tests; observe failure before changing the worker.
- [x] Increment attempts atomically when claiming; expire exhausted leases; rerun regressions.
- [x] Reproduce esbuild failure; update its existing assertions to the workspace lock entries and override.
- [x] Reproduce lifecycle failure with hidden document; initialize focus/online explicitly in the lifecycle test.
- [x] Run API and web suites, type checks, infra smoke and the previously failing additional smoke.
- [x] Review diff and report results and any skipped checks.

## Verification

Six PostgreSQL regressions pass, including a review finding reproduced RED→GREEN: expiry cleanup must skip a locked final lease so unrelated jobs can proceed. Full `npm run api:test`: 363 passed, 7 skipped (separate account-deletion/journal environments unavailable). Web: 353 passed; infra: 28 passed; additional smoke: 15 passed. API/web type checks, web lint and build passed. Detailed logs and initial failures are in `.tmp/critical-checks-20261106/`.
