# Yaskapp

Социальная сеть вокруг опросов: публикации, голосование, обсуждения и подписки.
В репозитории есть Flutter-приложение, публичный React web, панель модерации и общий API.

## С чего начать

| Задача | Где читать |
| --- | --- |
| Запустить проект | Инструкция ниже |
| Понять возможности и ограничения | [Продукт](docs/product-notes.md) |
| Найти код, API и схему данных | [Архитектура](docs/architecture.md) |
| Развернуть сервер, настроить push и резервные копии | [Эксплуатация](docs/moderation-domain-deployment.md) |
| Разобраться с удалением аккаунтов | [Удаление аккаунтов](docs/account-deletion-operations.md) |
| Проверить сборку перед выпуском | [Проверки](docs/staging-smoke-test.md) |
| Продолжить личную блокировку пользователей | [Требования и статус](docs/prd-user-blocking.md) |

## Локальный запуск

Нужны Node.js 20+, npm и Docker Compose. Для мобильного клиента — Flutter
с Dart, совместимым с [pubspec.yaml](apps/mobile/pubspec.yaml).

Команды выполняются из корня репозитория; каждый сервер работает в своём терминале.

1. Установить зависимости и подготовить окружение:

   ```sh
   npm ci
   cp services/api/.env.example services/api/.env
   docker compose -f infra/docker/docker-compose.yml up -d
   npm run shared:build
   ```

   В PowerShell вместо `cp` можно использовать
   `Copy-Item services/api/.env.example services/api/.env`.
   Существующий `.env` перезаписывать не нужно.

2. Открыть [консоль MinIO](http://localhost:9001), войти с локальными
   `yaskapp` / `yaskapp-secret` и создать bucket `yaskapp-media`.
   Имя должно совпадать с `S3_BUCKET` в `.env`.

3. Применить миграции и запустить API:

   ```sh
   npm run db:migrate
   npm run db:check
   npm run api:dev
   ```

   [Проверка готовности](http://localhost:3000/health/ready) должна вернуть `200`.
   Ответ `503` означает проблему с PostgreSQL, Redis или хранилищем.

4. В другом терминале запустить web:

   ```sh
   npm run dev -w @yaskapp/web
   ```

   Открыть адрес из вывода Vite, обычно [localhost:5173](http://localhost:5173).
   Запросы идут через dev proxy на API `localhost:3000`.

Мобильный запуск и адрес API для телефона — в [README Flutter](apps/mobile/README.md).
Настройки web — в [README web](apps/web/README.md), модерации —
в [README панели](apps/moderation-web/README.md).

Чтобы локально завершались удаления аккаунтов, запустить ещё один процесс:

```sh
npm run account-deletion:worker -w @yaskapp/api
```

## Работа с документацией

Обновляем существующий раздел вместе с изменением поведения. Отдельный документ
нужен только для самостоятельной темы, на которую есть ссылка отсюда.
Логи, трассировки и снимки проверок храним в `.tmp/` или прикладываем к релизу.

Старые планы и отчёты доступны в Git: `git log --all -- docs`,
содержимое файла — `git show <commit>:<path>`.
