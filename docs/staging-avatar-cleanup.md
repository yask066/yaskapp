# Staging Avatar Cleanup Scheduler

The cleanup job scans `avatars/`, skips keys referenced by `profiles.avatar_object_key`,
and deletes only unreferenced normalized objects older than the grace period.
The staging VPS runs it once per day with a 24-hour grace period.

Install on the staging host from `/opt/yaskapp`:

```bash
sudo install -m 0644 infra/systemd/yaskapp-avatar-cleanup.service \
  /etc/systemd/system/yaskapp-avatar-cleanup.service
sudo install -m 0644 infra/systemd/yaskapp-avatar-cleanup.timer \
  /etc/systemd/system/yaskapp-avatar-cleanup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now yaskapp-avatar-cleanup.timer
```

Verify the timer and run one manual job:

```bash
systemctl status yaskapp-avatar-cleanup.timer --no-pager
systemctl list-timers yaskapp-avatar-cleanup.timer --no-pager
sudo systemctl start yaskapp-avatar-cleanup.service
sudo journalctl -u yaskapp-avatar-cleanup.service -n 50 --no-pager
```

The service uses the already running staging Postgres and MinIO containers. It
does not expose storage credentials or publish a new network port.
