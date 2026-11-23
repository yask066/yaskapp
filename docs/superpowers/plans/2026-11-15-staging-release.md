# Staging and Merge Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Изолированная тестовая версия и выпуск проверенных образов через Merge GitHub PR.

**Architecture:** CI собирает immutable GHCR images и release manifest. Staging deployment подтверждает manifest; release PR допускает Merge только после проверок. Production использует этот manifest, фиксированный deploy runner на VPS и существующий backup.

**Tech Stack:** GitHub Actions/REST API, Python 3 stdlib, Docker Compose, Caddy, Flutter/Gradle.

**Spec:** docs/superpowers/specs/2026-11-15-staging-release-design.md

## Global Constraints

- Рабочие project/volumes и backup не переименовывать; отдельные тестовые данные.
- Текущие main и staging удалённо: 7fdd05d; не переписывать существующие ветки.
- Production deploy выключен до проверки VPS и bootstrap; Merge остаётся единственным обычным подтверждением.
- Выпускаются те же digest, дерево merge commit совпадает с проверенным tree.
- Никакого автоматического восстановления рабочей БД.
- Работа в существующем checkout на codex/staging-release-workflow; чужие untracked документы сохраняются.
- Inline execution: согласование схемы уже разрешает реализацию; дополнительные процессные подтверждения не нужны.

## Review Focus

- Подмена SHA/образов в manifest: валидация SHA, digest, repository и дерева; Task 1.
- Новый staging commit после предыдущей проверки: evidence требуется для точного head SHA; Task 3.
- Частично применённые миграции: writers остаются остановлены; возврат только при одинаковом наборе миграций; Task 2.
- Обрыв SSH/повтор deploy: systemd job, persistent state и блокировки; Task 2.
- Существующий production носит имя staging: проверка project identity и отдельного тестового project; Tasks 2/5.

### Task 1: Release manifest and provenance

Files: infra/release/release.py, infra/release/test_release.py.
Interfaces: validate_manifest(manifest), verify_promotion(manifest, source_sha, merged_tree), write manifest CLI; schema version 1, source_sha, source_tree, images {api,web,moderation-web}, migrations {filename:sha256}.

- [ ] Write failing unittest cases rejecting mutable tags, foreign repositories, malformed SHA, missing images and mismatched promotion tree.
- [ ] Run `python -m unittest discover -s infra/release -p 'test_*.py'`; observe intended failures.
- [ ] Implement validation and CLI manifest creation from Docker build metadata and Git.
- [ ] Run suite; commit focused changes.

### Task 2: Server deployment runner and isolated Compose

Files: infra/release/deploy.py, infra/release/test_deploy.py, infra/release/config.example.json, infra/release/compose.images.yml, infra/release/compose.test.yml, infra/release/install.sh.
Interfaces: root-owned config pins project_root, project_name, compose_files, env_file, state_dir, services, smoke_urls and backup_config. Deploy accepts manifest and persists current/attempt state. Only application images overridden; infrastructure remains fixed by operator config.

- [ ] Write failing state-machine tests: backup failure stops before migration, partial migration failure leaves writers stopped, readiness failure restores only same-schema previous release, duplicate completed attempt no-ops, interrupted attempt refuses automatic continuation, stale revision rejected.
- [ ] Implement runner with per-environment lock and production backup operation.lock, fixed service allowlist, digest pull, stopped writers during migrate, readiness and digest verification, atomic state writes.
- [ ] Root-owned systemd job survives disconnected SSH; install documents owner-only configuration and activation.
- [ ] Add isolated test Compose overlay with separate project, volumes, env, local ingress and push disabled.
- [ ] Run Python suites and `docker compose config` without printing secrets; commit.

### Task 3: GitHub workflows and release PR

Files: .github/workflows/ci.yml, .github/workflows/staging.yml, .github/workflows/production.yml, .github/workflows/release-check.yml, infra/release/github.mjs, infra/release/github.test.mjs.
Interfaces: CI reusable workflow; staging artifact release-<SHA>, evidence has manifest plus successful deployment run; release-check status named release-ready; production activated by repository variable PRODUCTION_DEPLOY_ENABLED=true.

- [ ] Fix CI MinIO startup/bucket initialization after verifying current service behaviour; add infra tests and reusable entry point.
- [ ] Write failing tests for exact-source evidence, wrong base/head repository, failed staging, tree mismatch, stale main, and PR update data.
- [ ] Implement API helper using built-in fetch and node:test, automatic PR using GitHub App token, source head checks and immutable manifest artifacts.
- [ ] Add build/push/staging workflow gated by STAGING_DEPLOY_ENABLED and successful CI; deploy over strict SSH to installed runner.
- [ ] Add release-ready required check and production workflow gated by activation, exact merged PR source and evidence, then deploy same manifest.
- [ ] Run node tests and workflow validator; commit.

### Task 4: Separate Android test app

Files: apps/mobile/android/app/build.gradle.kts, apps/mobile/android/app/src/main/AndroidManifest.xml, apps/mobile/lib/main.dart, apps/mobile/lib/src/features/notifications/firebase_push_service.dart, relevant Flutter tests, .github/workflows/ci.yml.
Interfaces: YASKAPP_PUSH_ENABLED=false disables Firebase initialization/token operations; Gradle property yaskappTestBuild=true selects .test applicationId/name and disables google-services task; API flags fixed to test endpoints in staging APK job.

- [ ] Add behavioural test for disabled push returning no token/events without Firebase initialization; observe RED.
- [ ] Implement opt-out while preserving default production behaviour and separate Android identity.
- [ ] Add Flutter analyze/test and debug test APK artifact CI steps.
- [ ] Run relevant Flutter suite, analyzer and Android build; commit with evidence/limitations.

### Task 5: Infrastructure activation and documentation

Files: infra/release/README.md, README.md, docs/moderation-domain-deployment.md, apps/mobile/README.md.

- [ ] Inventory actual VPS through confirmed SSH user yask066, resource limits, project/volume/env paths, current digest and backup state. No secrets in output.
- [ ] Configure DNS, separate test data and server runner only after access confirmed; bootstrap current manifest; test isolated deployment and rollback.
- [ ] Configure GitHub environments, credentials and rules; use GitHub App for automation when supplied. Do not repurpose local broad credential as CI secret.
- [ ] Push reviewable feature branch/PR; activate only after remote verification. If SSH/DNS/App access unavailable, finish repository deliverables and report precise remaining steps; do not claim end-to-end readiness.
- [ ] Document daily feature → staging → manual check → Merge process, SHA changes, deploy failures and manual recovery.
- [ ] Run targeted full verification and independent whole-branch review, address important findings, record final actual state.

## Execution record

- 2026-11-15: GitHub repo public; current credential has admin permissions. No main protection; one github-pages environment. Remote staging already exists at main. Docker daemon unavailable locally. SSH root attempt timed out; user confirmed yask066 on 5.44.44.197:22, no VPN.
- Plan self-review: requirements mapped; server and GitHub setup remain dependent on real access. Execute inline, final reviewer only.
