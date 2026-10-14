# Staging Database Backups

Staging PostgreSQL data lives in the `postgres-staging-data` Docker volume.
The volume is persistent, but it is not a backup. Keep database dumps outside
the repository and outside the staging host when possible.

## Create A Backup

Run from the repository root on the staging host after the Compose stack is
running:

```bash
mkdir -p backups/staging
backup_file="backups/staging/yaskapp-staging-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose -f infra/docker/docker-compose.staging.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "$backup_file"

pg_restore --list "$backup_file" > "$backup_file.list"
```

For the VPS, use the repository script so the dump is validated and old local
dumps are removed according to retention. This script also uploads the dump to
the external AWS bucket, so it requires the account-deletion cloud env files and
Compose overlay. Without those credentials, use the manual dump commands above;
that leaves the dump on the VPS and is not an off-host backup.

```bash
sudo install -m 0750 infra/docker/backup-postgres.sh /usr/local/sbin/yaskapp-backup-postgres
sudo BACKUP_DIR=/var/backups/yaskapp BACKUP_RETENTION_DAYS=30 \
  /usr/local/sbin/yaskapp-backup-postgres
```

`BACKUP_RETENTION_DAYS` is limited to 1–30 days. Copy validated dumps to
protected storage outside the VPS and configure that bucket to expire current
and noncurrent dump versions within 30 days. Keep the staging account-deletion
journal and its independent checkpoint in separate 35-day Object Lock stores;
they are not part of these database dumps.

Run it daily with root's cron (`sudo crontab -e`):

```cron
15 3 * * * /usr/local/sbin/yaskapp-backup-postgres >> /var/log/yaskapp-backup.log 2>&1
```

The dump must be copied to protected backup storage and removed from the host
according to the staging retention policy. Never commit `backups/` to Git.

## Restore A Backup

Restore only during a planned maintenance window. This replaces staging data.

```bash
backup_file="backups/staging/yaskapp-staging-REPLACE_ME.dump"

cat "$backup_file" | docker compose \
  -f infra/docker/docker-compose.staging.yml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists'

docker compose -f infra/docker/docker-compose.staging.yml run --rm migrate
docker compose -f infra/docker/docker-compose.staging.yml ps
```

After a database or media restore, keep traffic blocked and reapply the
account-deletion journal and its checkpoint before starting API or frontend
services.
Follow [Account Deletion Operations](account-deletion-operations.md#restore-gate)
for the exact order. Run the staging smoke checklist and verify the API
readiness endpoint before allowing test traffic.

## Operations

- Keep at least the latest seven daily dumps and four weekly dumps.
- Encrypt dumps at rest and restrict access to staging operators.
- Test one restore regularly; a dump that was never restored is unverified.
- Record the backup timestamp, migration version, and restore result.
- Do not use staging dumps as a substitute for production backups.
- Copy backups to storage outside the VPS; local retention does not protect
  against VPS loss.
