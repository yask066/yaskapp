#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
stub_bin="$test_root/bin"
mkdir -p "$stub_bin" "$test_root/local" "$test_root/replica"
export PATH="$stub_bin:$PATH"
export TEST_ROOT="$test_root"
export DOCKER_LOG="$test_root/docker.log"

cat > "$stub_bin/docker" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  *pg_dump*) printf 'readable-postgres-dump\n' ;;
esac
STUB
cat > "$stub_bin/pg_restore" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${1:-}" == --list ]]; then
  content="$(cat "${2:-/dev/stdin}")"
  [[ "$content" == readable-postgres-dump* ]] || exit 1
  printf 'TABLE public account_deletion_entries\n'
else
  exit 2
fi
STUB
cat > "$stub_bin/gpg" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
output=''
input=''
decrypt=0
while (($#)); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --passphrase-file) [[ -r "$2" ]] || exit 2; shift 2 ;;
    --decrypt) decrypt=1; shift ;;
    --batch|--yes|--symmetric|--decrypt) [[ "$1" == --decrypt ]] && decrypt=1; shift ;;
    --pinentry-mode|--cipher-algo|--passphrase-file) [[ "$1" == --passphrase-file ]] && [[ -r "$2" ]] || [[ "$1" != --passphrase-file ]] || exit 2; shift 2 ;;
    *) input="$1"; shift ;;
  esac
done
[[ -n "$output" && -n "$input" ]] || exit 2
if ((decrypt)); then
  sed '1{/^encrypted$/d;}' "$input" > "$output"
else
  { printf 'encrypted\n'; cat "$input"; } > "$output"
fi
STUB
cat > "$stub_bin/mountpoint" <<'STUB'
#!/usr/bin/env bash
set -Eeuo pipefail
target="${!#}"
[[ "${STUB_MOUNTED_PATH:-}" == "$target" ]]
STUB
chmod +x "$stub_bin/docker" "$stub_bin/pg_restore" "$stub_bin/gpg" "$stub_bin/mountpoint"

assert() {
  if ! "$@"; then
    echo "assertion failed: $*" >&2
    exit 1
  fi
}
fail() {
  echo "assertion failed: $*" >&2
  exit 1
}

export PROJECT_ROOT="$repo_root"
export COMPOSE_FILE="$repo_root/infra/docker/docker-compose.staging.yml"
export BACKUP_DIR="$test_root/local"
export BACKUP_REPLICA_DIR="$test_root/replica"
export BACKUP_ENCRYPTION_KEY_FILE="$test_root/backup.key"
printf 'test-only-backup-key\n' > "$BACKUP_ENCRYPTION_KEY_FILE"
chmod 600 "$BACKUP_ENCRYPTION_KEY_FILE"
export BACKUP_RETENTION_DAYS=30
export STUB_MOUNTED_PATH="$test_root/replica"
stale_mtime="@$(($(date -u +%s) - 30 * 86400 - 120))"
for directory in "$BACKUP_DIR" "$BACKUP_REPLICA_DIR"; do
  stale_app="$directory/yaskapp-staging-over-retention.dump.gpg"
  printf 'old encrypted backup\n' > "$stale_app"
  touch -d "$stale_mtime" "$stale_app"
done

bash "$repo_root/infra/docker/backup-postgres.sh"
for directory in "$BACKUP_DIR" "$BACKUP_REPLICA_DIR"; do
  [[ ! -e "$directory/yaskapp-staging-over-retention.dump.gpg" ]] || fail 'main backup exceeded the 30-day retention limit'
done
main_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'yaskapp-staging-*.dump.gpg' -print -quit)"
[[ -n "$main_backup" ]] || fail 'main PostgreSQL dump was not created'
main_copy="$BACKUP_REPLICA_DIR/$(basename "$main_backup")"
[[ -f "$main_copy" ]] || fail 'main dump was not copied to BACKUP_REPLICA_DIR'
assert cmp -s "$main_backup" "$main_copy"
if find "$BACKUP_DIR" "$BACKUP_REPLICA_DIR" -type f -name 'yaskapp-staging-*.dump' | grep -q .; then
  fail 'unencrypted main database dump was left on disk'
fi

for directory in "$BACKUP_DIR" "$BACKUP_REPLICA_DIR"; do
  stale_journal="$directory/yaskapp-account-deletion-journal-over-retention.dump.gpg"
  printf 'old encrypted journal backup\n' > "$stale_journal"
  touch -d "$stale_mtime" "$stale_journal"
done
bash "$repo_root/infra/docker/backup-account-deletion-journal.sh"
for directory in "$BACKUP_DIR" "$BACKUP_REPLICA_DIR"; do
  [[ ! -e "$directory/yaskapp-account-deletion-journal-over-retention.dump.gpg" ]] || fail 'journal backup exceeded the 30-day retention limit'
done
journal_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'yaskapp-account-deletion-journal-*.dump.gpg' -print -quit)"
[[ -n "$journal_backup" ]] || fail 'journal PostgreSQL dump was not created'
journal_copy="$BACKUP_REPLICA_DIR/$(basename "$journal_backup")"
[[ -f "$journal_copy" ]] || fail 'journal dump was not copied to BACKUP_REPLICA_DIR'
assert cmp -s "$journal_backup" "$journal_copy"
if find "$BACKUP_DIR" "$BACKUP_REPLICA_DIR" -type f -name 'yaskapp-account-deletion-journal-*.dump' | grep -q .; then
  fail 'unencrypted journal dump was left on disk'
fi
if grep -F "$repo_root/infra/docker/docker-compose.account-deletion-journal.yml" "$DOCKER_LOG" | grep -Fq -- '--no-privileges'; then
  fail 'journal backup omitted database ACLs needed for recovery'
fi

export BACKUP_RETENTION_DAYS=31
if bash "$repo_root/infra/docker/backup-postgres.sh" > /dev/null 2>&1; then
  fail 'main backup accepted retention above 30 days'
fi
if bash "$repo_root/infra/docker/backup-account-deletion-journal.sh" > /dev/null 2>&1; then
  fail 'journal backup accepted retention above 30 days'
fi
export BACKUP_RETENTION_DAYS=30
unset STUB_MOUNTED_PATH
if bash "$repo_root/infra/docker/backup-postgres.sh" > /dev/null 2>&1; then
  fail 'main backup accepted an unmounted replica directory'
fi
if bash "$repo_root/infra/docker/backup-account-deletion-journal.sh" > /dev/null 2>&1; then
  fail 'journal backup accepted an unmounted replica directory'
fi

journal_compose="$repo_root/infra/docker/docker-compose.account-deletion-journal.yml"
grep -Eq 'journal-postgres-data:' "$journal_compose" || fail 'journal compose lacks persistent volume'
grep -Eq 'healthcheck:' "$journal_compose" || fail 'journal compose lacks health check'
grep -Eq 'JOURNAL_PRIVATE_BIND_IP:-127\.0\.0\.1.*5432:5432' "$journal_compose" || fail 'journal host binding is not private-IP configurable'
if grep -Eq '0\.0\.0\.0:5432:5432|\*:5432:5432' "$journal_compose"; then fail 'journal compose exposes a public host port'; fi
if grep -Eq 'backup-uploader|upload-staging-backup|STAGING_BACKUP_(ENDPOINT|BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY)' \
  "$repo_root/infra/docker/backup-postgres.sh" \
  "$repo_root/infra/docker/backup-account-deletion-journal.sh" \
  "$repo_root/infra/docker/docker-compose.account-deletion.staging.yml"; then
  fail 'AWS backup uploader remains in the self-hosted backup path'
fi
grep -Eq 'account-deletion-journal-reconciler:' "$repo_root/infra/docker/docker-compose.account-deletion.staging.yml" || fail 'staging overlay lacks the periodic journal reconciler'
grep -Fq 'export-account-deletion-journal.js' "$repo_root/infra/docker/docker-compose.account-deletion.staging.yml" || fail 'journal reconciler command is missing'
grep -Fq -- '--pinentry-mode loopback' "$repo_root/infra/docker/backup-postgres.sh" || fail 'main backup does not configure noninteractive GPG pinentry'
grep -Fq -- '--pinentry-mode loopback' "$repo_root/infra/docker/backup-account-deletion-journal.sh" || fail 'journal backup does not configure noninteractive GPG pinentry'
if ! sed -n '/^  migrate:/,/^  api:/p' "$repo_root/infra/docker/docker-compose.staging.yml" | grep -Fq 'ACCOUNT_DELETION_ENABLED: "false"'; then
  fail 'migration service inherits the account-deletion feature flag'
fi
if ! sed -n '/^  notification-worker:/,/^  moderation-web:/p' "$repo_root/infra/docker/docker-compose.staging.yml" | grep -Fq 'ACCOUNT_DELETION_ENABLED: "false"'; then
  fail 'notification worker inherits the account-deletion feature flag'
fi
for service in api account-deletion-worker account-deletion-journal-reconciler; do
  if ! sed -n "/^  $service:/,/^  [a-zA-Z-].*:/p" "$repo_root/infra/docker/docker-compose.account-deletion.staging.yml" | grep -Fq 'ACCOUNT_DELETION_ENABLED: "true"'; then
    fail "$service does not enable account deletion with journal credentials"
  fi
done
if grep -Eq 'backup-uploader|upload-staging-backup' "$DOCKER_LOG"; then
  fail 'backup scripts invoked the cloud uploader'
fi

echo 'backup-postgres: all checks passed'
