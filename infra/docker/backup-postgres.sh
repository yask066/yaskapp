#!/usr/bin/env bash
set -Eeuo pipefail

readonly project_root="${PROJECT_ROOT:-/opt/yaskapp}"
readonly compose_file="${COMPOSE_FILE:-$project_root/infra/docker/docker-compose.staging.yml}"
readonly account_deletion_compose_file="${ACCOUNT_DELETION_COMPOSE_FILE:-$project_root/infra/docker/docker-compose.account-deletion.staging.yml}"
readonly backup_dir="${BACKUP_DIR:-/var/backups/yaskapp}"
readonly retention_days="${BACKUP_RETENTION_DAYS:-30}"
readonly -a compose_args=(-f "$compose_file" -f "$account_deletion_compose_file")

if ! [[ "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 || retention_days > 30 )); then
  echo "BACKUP_RETENTION_DAYS must be an integer between 1 and 30." >&2
  exit 2
fi

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir/yaskapp-staging-$timestamp.dump"
temporary_file="$backup_file.tmp"

cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT

docker compose "${compose_args[@]}" exec -T postgres \
  sh -c 'pg_dump --format=custom --no-owner --no-privileges \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$temporary_file"

docker compose "${compose_args[@]}" exec -T postgres \
  pg_restore --list < "$temporary_file" > /dev/null

mv "$temporary_file" "$backup_file"
chmod 600 "$backup_file"

docker compose --profile maintenance "${compose_args[@]}" run --rm --build --no-deps \
  --volume "$backup_dir:/backups:ro" backup-uploader \
  "$(basename "$backup_file")"

find "$backup_dir" -type f -name 'yaskapp-staging-*.dump' \
  -mtime "+$retention_days" -delete

echo "Created PostgreSQL backup: $backup_file"
