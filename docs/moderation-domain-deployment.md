# Сервер: развёртывание и обслуживание

Команды ниже выполняются из корня репозитория на Linux-сервере.
Конфигурация: [staging Compose](../infra/docker/docker-compose.staging.yml),
[Caddyfile](../infra/docker/Caddyfile), [пример переменных](../services/api/.env.staging.example).

## Подготовка

Скопировать `services/api/.env.staging.example` в `services/api/.env.staging`
и заполнить реальные значения. Файл с секретами не хранится в Git.

| Настройка | Что задать |
| --- | --- |
| `STAGING_API_DOMAIN` | DNS-имя API без протокола |
| `WEB_HOST` | DNS-имя публичного web |
| `MODERATION_HOST` | Отдельное имя панели модерации |
| `STAGING_PUBLIC_IP` | IP для временного HTTP-доступа; панель на `/admin` |
| `CORS_ORIGINS` | Разрешённые origin с протоколом, включая web и панель |
| `POSTGRES_*`, `DATABASE_URL` | Одинаковые реквизиты БД; внутри Compose адрес `postgres:5432` |
| `JWT_SECRET`, `PAGINATION_CURSOR_SECRET` | Разные случайные секреты; для cursor не менее 32 случайных байт, одинаковое значение на всех API-репликах |
| `MINIO_ROOT_*`, `S3_*` | Реквизиты хранилища, `http://minio:9000` и нужный bucket |

DNS должен указывать на сервер, порты 80/443 — быть доступны Caddy.
Примеры доменов в конфигурации заменяются реальными значениями.
HTTP-маршрут по IP предназначен для временной разработки.

`minio-init` создаёт bucket, но не создаёт отдельного S3-пользователя.
Если API использует отдельный access key, заранее выдать ему доступ к bucket.
Не оставлять `replace-with` в паролях и ключах.

Для push нужен service-account JSON в
`infra/docker/secrets/firebase-service-account.json`. На сервере:

```sh
chown 1000:1000 infra/docker/secrets/firebase-service-account.json
chmod 400 infra/docker/secrets/firebase-service-account.json
```

Compose монтирует файл только для чтения в `notification-worker`.
Без push-реквизитов основной стек можно запустить перечислением сервисов:
`https account-deletion-worker poll-feed-snapshot-cleanup`; их зависимости
будут подняты автоматически, `notification-worker` — нет.

## Запуск и обновление

Перед обновлением сохранить backup и предыдущие образы приложения.
Первый запуск с подготовленными реквизитами:

```sh
docker compose -f infra/docker/docker-compose.staging.yml up -d --build
docker compose -f infra/docker/docker-compose.staging.yml ps
docker compose -f infra/docker/docker-compose.staging.yml logs --tail=100 migrate api account-deletion-worker notification-worker
```

Миграции должны завершиться успешно до старта API. В конфигурации две API-реплики,
общие PostgreSQL и Redis, MinIO, два web-клиента и фоновые workers.
Только Caddy публикует внешние порты; БД и хранилище остаются в приватной сети.

Проверить `https://<STAGING_API_DOMAIN>/health/ready`: ожидается `200`.
Затем выполнить [проверки выпуска](staging-smoke-test.md).
`/health/metrics` возвращает счётчики конкретного API-процесса: опрашивать каждую
реплику отдельно и ограничить внешний доступ на прокси.
Счётчики отправки уведомлений не измеряют задержку отображения у пользователя.

Для первого superadmin зарегистрировать обычный аккаунт и в окружении нужной БД
выполнить `npm run db:bootstrap-superadmin -- --login <email-or-username>`.
Панель модерации использует Bearer-токен в памяти; до публичного production-доступа
нужны HTTPS, VPN/SSO, MFA и предусмотренная замена MVP-сессии.

## Обычные операции

```sh
docker compose -f infra/docker/docker-compose.staging.yml logs -f api
docker compose -f infra/docker/docker-compose.staging.yml restart api
docker compose -f infra/docker/docker-compose.staging.yml down
```

`down` сохраняет именованные тома. `down -v` удаляет данные.
В логах не должно быть паролей, cookie, токенов или дампов окружения.

При неудачном обновлении вернуть сохранённые образы API, web и панели,
затем выполнить `up -d --no-build`. До отката проверить совместимость образов
с уже применёнными миграциями: откат контейнера не откатывает схему БД.

## Фоновые задачи

| Задача | Как запускается |
| --- | --- |
| Удаление аккаунтов | `account-deletion-worker` постоянно; [подробности](account-deletion-operations.md) |
| Push | `notification-worker` каждые 30 секунд |
| Снимки популярной ленты | `poll-feed-snapshot-cleanup` каждые 5 минут |
| Неиспользуемые аватары | [systemd timer](../infra/systemd/yaskapp-avatar-cleanup.timer), раз в сутки, grace period 24 часа |
| Прочая очистка | npm-команды `poll-images:cleanup` и `notifications:cleanup` в API workspace; отдельное расписание задаёт оператор |

Установка таймера аватаров для checkout в `/opt/yaskapp`:

```sh
sudo install -m 0644 infra/systemd/yaskapp-avatar-cleanup.service /etc/systemd/system/yaskapp-avatar-cleanup.service
sudo install -m 0644 infra/systemd/yaskapp-avatar-cleanup.timer /etc/systemd/system/yaskapp-avatar-cleanup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now yaskapp-avatar-cleanup.timer
systemctl list-timers yaskapp-avatar-cleanup.timer --no-pager
```

## Резервные копии

Для ежедневной согласованной копии PostgreSQL и MinIO с еженедельной проверкой
восстановления см. [настройку backup БД и медиа](../infra/backup/README.md).
Эта схема использует локальный зашифрованный restic-репозиторий на VPS.

Тома Docker не заменяют backup. Текущий [backup-postgres.sh](../infra/docker/backup-postgres.sh)
создаёт dump, проверяет его через `pg_restore`, шифрует GPG и сверяет checksum
копии на отдельном смонтированном хранилище. AWS и отдельный журнал удаления
обычному режиму не нужны.

Нужны `pg_restore`, `gpg`, доступ к Docker, файл ключа с ограниченными правами
и смонтированное хранилище:

```sh
sudo env PROJECT_ROOT=/opt/yaskapp BACKUP_DIR=/var/backups/yaskapp BACKUP_REPLICA_DIR=/mnt/yaskapp-backups BACKUP_ENCRYPTION_KEY_FILE=/etc/yaskapp/backup.key BACKUP_RETENTION_DAYS=30 bash infra/docker/backup-postgres.sh
```

Пути — примеры: хранилище и ключ готовятся до запуска.
Срок хранения допустим от 1 до 30 дней, очистка применяется к обеим копиям.
Планировщик должен передавать те же переменные. Ключ хранится отдельно от копий.

### Восстановление

Проводится в окне обслуживания. Сначала закрыть трафик, остановить API и workers,
сохранить текущую копию. Восстанавливать в новую пустую БД: так объекты более новых
миграций не мешают старому dump. При любой ошибке остановиться до переключения.

```sh
docker compose -f infra/docker/docker-compose.staging.yml stop https api account-deletion-worker notification-worker poll-feed-snapshot-cleanup
umask 077
gpg --batch --pinentry-mode loopback --passphrase-file /etc/yaskapp/backup.key --output /var/backups/yaskapp/restore.dump --decrypt /path/to/backup.dump.gpg
pg_restore --list /var/backups/yaskapp/restore.dump
restore_db=yaskapp_restore
docker compose -f infra/docker/docker-compose.staging.yml exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" --template=template0 "$1"' sh "$restore_db"
cat /var/backups/yaskapp/restore.dump | docker compose -f infra/docker/docker-compose.staging.yml exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$1"' sh "$restore_db"
```

Имя `yaskapp_restore` должно быть свободным; существующую БД команда не заменяет.
После успешного restore в `services/api/.env.staging` поменять `POSTGRES_DB`
и имя базы в `DATABASE_URL` на это имя, сохранив пользователя и пароль.
Пересоздать PostgreSQL-контейнер, чтобы backup тоже использовал новую БД,
и применить миграции:

```sh
docker compose -f infra/docker/docker-compose.staging.yml up -d --no-deps postgres
docker compose -f infra/docker/docker-compose.staging.yml run --rm migrate
```

До открытия трафика проверить согласованность медиа и сопоставить удаления после
даты backup с сохранённой исходной БД. Независимого автоматического восстановления
удалений нет. Запустить сервисы с закрытым внешним доступом, проверить readiness
и smoke, затем открыть трафик. Временный незашифрованный dump удалить.
Регулярная проба восстановления проверяет пригодность backup.
