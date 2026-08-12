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

After restore, run the staging smoke checklist and verify the API readiness
endpoint before allowing test traffic.

## Operations

- Keep at least the latest seven daily dumps and four weekly dumps.
- Encrypt dumps at rest and restrict access to staging operators.
- Test one restore regularly; a dump that was never restored is unverified.
- Record the backup timestamp, migration version, and restore result.
- Do not use staging dumps as a substitute for production backups.
