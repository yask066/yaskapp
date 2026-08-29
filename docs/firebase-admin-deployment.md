# Firebase Admin credentials on staging

The Firebase service-account JSON is a deployment secret. It must not be
committed to Git or pasted into chat.

From a local PowerShell terminal, upload it to the VPS:

```powershell
scp .\firebase-service-account.json root@<VPS_IP>:/opt/yaskapp/infra/docker/secrets/firebase-service-account.json
```

On the VPS, restrict access to the file:

```bash
cd /opt/yaskapp
chown 1000:1000 infra/docker/secrets/firebase-service-account.json
chmod 400 infra/docker/secrets/firebase-service-account.json
```

The staging Compose file mounts this file read-only inside the notification worker container
at `/run/secrets/firebase-service-account.json` and sets
`GOOGLE_APPLICATION_CREDENTIALS` to that path. The Node process uses Firebase
Admin SDK Application Default Credentials.

Rebuild and restart the notification worker after uploading the file:

```bash
docker compose -f infra/docker/docker-compose.staging.yml up -d --build notification-worker
```

The staging Compose configuration includes a permanent `notification-worker`
service that checks the outbox every 30 seconds and restarts automatically.
Start it with:

```bash
docker compose -f infra/docker/docker-compose.staging.yml up -d notification-worker
```

Check its logs:

```bash
docker compose -f infra/docker/docker-compose.staging.yml logs -f notification-worker
```

To process pending push jobs once manually:

```bash
docker compose -f infra/docker/docker-compose.staging.yml run --rm notification-worker node services/api/dist/jobs/run-notification-push-worker.js
```

Do not print the file, its contents, or the credential JSON in logs. If the
key is ever exposed, revoke it in Google Cloud Console and generate a new one.
