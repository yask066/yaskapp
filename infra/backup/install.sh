#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == 0 ]] || { echo 'Run as root on the Linux Docker host.' >&2; exit 1; }
source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target=/usr/local/libexec/yaskapp-backup
configuration=/etc/yaskapp/backup
units=(yaskapp-backup.service yaskapp-backup.timer yaskapp-backup-verify.service yaskapp-backup-verify.timer)
for path in "$target" "$configuration" /var/lib/yaskapp-backup /var/backups/yaskapp/restic; do
  [[ ! -L "$path" ]] || { echo "Refusing to install through symlink $path" >&2; exit 1; }
done
for unit in "${units[@]}"; do
  destination="/etc/systemd/system/$unit"
  if [[ -L "$destination" ]] || { [[ -e "$destination" ]] && [[ ! -f "$target/VERSION" ]] && ! cmp -s "$source_root/infra/systemd/$unit" "$destination"; }; then
    echo "Refusing to replace existing unit $unit" >&2; exit 1
  fi
done
for required in docker python3 systemctl; do
  command -v "$required" >/dev/null || { echo "Missing required program: $required" >&2; exit 1; }
done
if ! command -v restic >/dev/null; then
  command -v apt-get >/dev/null || { echo 'Install restic >= 0.14 using your package manager.' >&2; exit 1; }
  apt-get update
  apt-get install -y restic
fi
python3 - <<'PY'
import re, subprocess
version = subprocess.check_output(['restic','version'], text=True)
match = re.search(r'restic (\d+)\.(\d+)\.(\d+)', version)
if not match or tuple(map(int, match.groups())) < (0,14,0):
    raise SystemExit('restic >= 0.14 is required')
PY
if [[ -d "$target" && ! -f "$target/VERSION" ]] && [[ -n "$(ls -A "$target")" ]]; then
  echo 'Refusing to overwrite an unrelated installation directory.' >&2; exit 1
fi
install -d -m 0700 "$configuration" /var/lib/yaskapp-backup /var/backups/yaskapp/restic
install -d -m 0755 "$target"
install -m 0755 "$source_root/infra/backup/staging_backup.py" "$target/staging_backup.py"
install -m 0644 "$source_root/infra/backup/inspect-data.cjs" "$target/inspect-data.cjs"
printf '%s\n' 'yaskapp-backup-v1' > "$target/VERSION"
if [[ ! -e "$configuration/restic-password" ]]; then
  python3 - "$configuration/restic-password" <<'PY'
import os, secrets, sys
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd,'w') as f: f.write(secrets.token_urlsafe(48)+'\n')
PY
fi
if [[ ! -e "$configuration/config.json" ]]; then
  python3 - "$configuration/config.json" <<'PY'
import json, os, sys
data = {'project_root':'/opt/yaskapp','compose_project':'yaskapp-staging',
        'repository':'/var/backups/yaskapp/restic','password_file':'/etc/yaskapp/backup/restic-password',
        'work_dir':'/var/lib/yaskapp-backup','reserve_bytes':2147483648}
fd = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd,'w') as f: json.dump(data,f,indent=2)
PY
fi
python3 "$target/staging_backup.py" init
preflight="$(python3 "$target/staging_backup.py" preflight)"
printf '%s\n' "$preflight"
echo 'Running a disposable PostgreSQL/MinIO backup and restore test with the server images.'
python3 -m unittest discover -s "$source_root/infra/backup" -p 'test_*.py'
install -d -m 0700 /var/lib/yaskapp-backup/test-runs
python3 - "$source_root/infra/backup/integration_test.py" "$preflight" <<'PY'
import json, os, subprocess, sys
images = json.loads(sys.argv[2])
test_env = {**os.environ, 'YASKAPP_BACKUP_TEST_ACK':'isolated',
            'YASKAPP_BACKUP_TEST_ROOT':'/var/lib/yaskapp-backup/test-runs',
            'YASKAPP_TEST_API_IMAGE':images['api_image'], 'YASKAPP_TEST_MINIO_IMAGE':images['minio_image'],
            'YASKAPP_TEST_POSTGRES_IMAGE':images['postgres_image']}
subprocess.run([sys.executable, sys.argv[1]], env=test_env, check=True)
PY
for unit in "${units[@]}"; do
  install -m 0644 "$source_root/infra/systemd/$unit" "/etc/systemd/system/$unit"
done
systemd-analyze verify /etc/systemd/system/yaskapp-backup.service /etc/systemd/system/yaskapp-backup.timer \
  /etc/systemd/system/yaskapp-backup-verify.service /etc/systemd/system/yaskapp-backup-verify.timer
systemctl daemon-reload
echo 'Starting the first consistent backup. Snapshot work is limited to five minutes, followed by service recovery.'
systemctl start yaskapp-backup.service
systemctl start yaskapp-backup-verify.service
systemctl enable --now yaskapp-backup.timer yaskapp-backup-verify.timer
python3 "$target/staging_backup.py" status
systemctl list-timers --all --no-pager yaskapp-backup.timer yaskapp-backup-verify.timer
echo 'PASS: first backup and isolated restore completed; timers enabled.'
echo 'Keep /etc/yaskapp/backup/restic-password separately from this VPS. Do not paste it into chat.'
echo 'LOCAL STORAGE ONLY: these backups do not protect against loss of the VPS disk.'
