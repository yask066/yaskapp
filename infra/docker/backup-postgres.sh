#!/usr/bin/env bash
set -Eeuo pipefail

readonly project_root="${PROJECT_ROOT:-/opt/yaskapp}"
readonly compose_file="${COMPOSE_FILE:-$project_root/infra/docker/docker-compose.staging.yml}"
readonly backup_dir="${BACKUP_DIR:-/var/backups/yaskapp}"
readonly replica_dir="${BACKUP_REPLICA_DIR:-}"
readonly encryption_key_file="${BACKUP_ENCRYPTION_KEY_FILE:-}"
readonly retention_days="${BACKUP_RETENTION_DAYS:-30}"

if ! [[ "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 || retention_days > 30 )); then
  echo "BACKUP_RETENTION_DAYS must be an integer between 1 and 30." >&2
  exit 2
fi
if [[ -z "$replica_dir" || ! -d "$replica_dir" ]] || ! mountpoint -q -- "$replica_dir"; then
  echo "BACKUP_REPLICA_DIR must be an existing mounted directory on separate storage." >&2
  exit 2
fi
if [[ -z "$encryption_key_file" || ! -r "$encryption_key_file" ]]; then
  echo "BACKUP_ENCRYPTION_KEY_FILE must point to a readable, owner-controlled key file." >&2
  exit 2
fi

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir/yaskapp-staging-$timestamp.dump.gpg"
replica_file="$replica_dir/$(basename "$backup_file")"
plain_temporary_file="$backup_dir/.yaskapp-staging-$timestamp.dump.tmp"
verification_file="$backup_dir/.yaskapp-staging-$timestamp.verify.tmp"
encrypted_temporary_file="$backup_file.tmp"
replica_temporary_file="$replica_file.tmp"

cleanup() {
  rm -f "$plain_temporary_file" "$verification_file" "$encrypted_temporary_file" "$replica_temporary_file"
}
trap cleanup EXIT

docker compose -f "$compose_file" exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$plain_temporary_file"

pg_restore --list "$plain_temporary_file" > /dev/null
gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 --passphrase-file "$encryption_key_file" \
  --output "$encrypted_temporary_file" "$plain_temporary_file"
gpg --batch --yes --pinentry-mode loopback --decrypt --passphrase-file "$encryption_key_file" \
  --output "$verification_file" "$encrypted_temporary_file"
pg_restore --list "$verification_file" > /dev/null
rm -f "$plain_temporary_file" "$verification_file"
mv "$encrypted_temporary_file" "$backup_file"
chmod 600 "$backup_file"

cp "$backup_file" "$replica_temporary_file"
chmod 600 "$replica_temporary_file"
local_checksum="$(sha256sum "$backup_file" | cut -d ' ' -f 1)"
replica_checksum="$(sha256sum "$replica_temporary_file" | cut -d ' ' -f 1)"
if [[ "$local_checksum" != "$replica_checksum" ]]; then
  echo "Backup replica checksum verification failed." >&2
  exit 1
fi
mv "$replica_temporary_file" "$replica_file"

find "$backup_dir" -type f \( -name 'yaskapp-staging-*.dump' -o -name 'yaskapp-staging-*.dump.gpg' \) \
  -mmin "+$((retention_days * 1440 - 1))" -delete
find "$replica_dir" -type f \( -name 'yaskapp-staging-*.dump' -o -name 'yaskapp-staging-*.dump.gpg' \) \
  -mmin "+$((retention_days * 1440 - 1))" -delete

echo "Created and verified PostgreSQL backup: $backup_file (sha256 $local_checksum)"
