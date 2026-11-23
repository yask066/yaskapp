# Разработка, тестирование и выпуск

## Обычный процесс

1. Создать рабочую ветку от актуальной `staging`, отправить PR в `staging`.
2. После Merge пройти CI и дождаться успешного workflow **Staging**.
3. Проверить `https://test.yaskapp.org` и Android test APK из артефактов CI
   по `docs/staging-smoke-test.md`. Сверить SHA с релизным PR.
4. Нажать **Merge pull request** в автоматически подготовленном PR
   `staging → main`. Использовать merge commit, не squash/rebase.
5. Дождаться успешного **Production**. Merge изменяет Git сразу, а сервер
   обновляется отдельным шагом. Ошибка Production означает неуспешный выпуск.

Новые изменения в staging обновляют релизный PR и требуют повторной ручной
приёмки. Во время окончательной проверки не добавлять commits в staging.
Auto-merge релизного PR не включать. Успешный CI не заменяет ручную проверку.
Тестовый APK имеет отдельный applicationId `.test` и имя `Yaskapp Test`;
push в нём выключен. Установленные основные приложения не обновляются через Merge.

## Что нужно подключить один раз

Workflow поставляются выключенными для развёртывания: переменные
`STAGING_DEPLOY_ENABLED` и `PRODUCTION_DEPLOY_ENABLED` должны быть равны
строке `true` только после настройки соответствующего окружения.
CI продолжает работать без этих переменных.

Нужны Linux VPS с Docker Compose >= 2.24.4, Python 3, systemd, доступ к DNS,
GitHub repository admin и GitHub App для автоматического PR/синхронизации веток.
GitHub App установить только на этот репозиторий, с Contents read/write и
Pull requests read/write. App не получает обход защиты main. Задать repository
variable `RELEASE_APP_ID` и secret `RELEASE_APP_PRIVATE_KEY`. Если ветка меняет
workflow-файлы, полномочия App должны также разрешать эти изменения; проверить
это до включения автоматической синхронизации.

App нужна потому, что PR, созданный обычным GITHUB_TOKEN, может потребовать
дополнительного Approve workflows to run. Не копировать широкие локальные
GitHub credentials в CI. Источник: [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

Создать GitHub environments `staging` и `production`. Для каждого задать:

| Secret | Значение |
| --- | --- |
| DEPLOY_HOST | Адрес SSH сервера, порт 22 |
| DEPLOY_USER | Отдельный пользователь для этого окружения |
| DEPLOY_KEY | Приватный SSH-ключ этого пользователя |
| DEPLOY_KNOWN_HOSTS | Проверенная запись known_hosts сервера |

Не получать host key автоматически без сверки с сервером. Ключи не хранить
в репозитории и не вставлять в чат. Production environment разрешить только
для main; staging — для staging. Дополнительного reviewer перед deploy нет:
ручное действие выпуска — Merge. На VPS нужен read-only вход в GHCR, если
образы приватные. Образы не удалять, пока они нужны для текущего/предыдущего выпуска.

## Сохранение существующего production

Название `yaskapp-staging` в старом Compose/backup может обозначать действующее
основное приложение. Сначала проверить `docker ps`, labels проекта, реальные
тома, пути env и конфигурацию backup. Не менять имена томов и project.
Убедиться в недавней успешной резервной копии и проверке восстановления.

Скопировать код deploy runner на VPS и установить отдельно для каждого
окружения (учётные записи создаёт администратор, без членства в docker/root):

```sh
sudo bash infra/release/install.sh staging yaskapp-deploy-test
sudo bash infra/release/install.sh production yaskapp-deploy-prod
```

Установка не запускает deploy и не включает environments. `install.sh`
разрешает только проверенную команду submit для нужного окружения через sudo.
Upload идёт в отдельный incoming; manifest копируется в root-owned requests.
systemd продолжает deploy при обрыве SSH. Повторный завершённый запрос — no-op;
незавершённый запрос требует проверки оператора.

Создать root-owned `/etc/yaskapp/release/production.json` по
`config.example.json`, первоначально с `enabled: false`. Указать фактические
Compose files и список работающих app services. Путь `backup_module` указывает
на установленный штатный backup coordinator. Его `operation.lock` используется
во время всего deploy; backup/restore не могут пересечься с миграциями.
Config/env/Compose/runner и их каталоги не должны изменяться deploy-пользователем.

Перед включением production записать в
`/var/lib/yaskapp-release/production/current.json` проверенный baseline manifest
с реальными предыдущими образами, source/tree и checksum миграций. Образы
сохранить в GHCR по digest; не придумывать SHA работающего приложения.
Если старую сборку нельзя связать с commit, сначала провести отдельный
bootstrap/reconciliation; автоматический rollback до этого не обещается.
Sequence baseline должен быть меньше первого staging run_number.

## Тестовое окружение на том же VPS

Создать отдельный checkout `/opt/yaskapp-test`. В его
`services/api/.env.staging` задать отдельные пароли PostgreSQL/MinIO,
JWT/cursor secrets, bucket и CORS для test/moderation-test. Не копировать
production данные, push credentials или токены устройств.

Использовать сочетание файлов (пути относительны первому Compose-файлу):

```sh
docker network create yaskapp-test-ingress
docker compose -p yaskapp-test \
  -f infra/docker/docker-compose.staging.yml \
  -f infra/release/compose.test.yml config --quiet
docker compose -p yaskapp-test \
  -f infra/docker/docker-compose.staging.yml \
  -f infra/release/compose.test.yml up -d postgres redis minio minio-init
docker compose -p yaskapp-test \
  -f infra/docker/docker-compose.staging.yml \
  -f infra/release/compose.test.yml up -d --no-deps https
```

Сеть создавать только если её ещё нет. Тестовый gateway не публикует порты
на хосте. Внешний production Caddy подключить дополнительно к
`yaskapp-test-ingress` через отдельный проверенный Compose override; сохранить
его текущую default-сеть. Добавить host-маршрут:

```caddy
test.yaskapp.org, api-test.yaskapp.org, moderation-test.yaskapp.org {
    reverse_proxy yaskapp-test-gateway:80
}
```

Создать DNS-записи этих имён к VPS. Проверить Caddy config перед reload.
Настроить `/etc/yaskapp/release/staging.json`: environment `staging`, project
`yaskapp-test`, файлы base + test override из тестового checkout, его env;
список services без notification-worker, smoke URLs тестовых доменов.
backup_module/config тестовой копии не нужны. При первом deploy база пустая;
runner применяет миграции перед стартом API. Production volume никуда не подключается.

## Проверки и включение

1. Объединить bootstrap tooling при выключенных deploy variables. Этот
   установочный шаг ещё не является обычным релизом приложения.
2. Установить runner, DNS/ingress, secrets и App. Включить server staging
   config и `STAGING_DEPLOY_ENABLED=true`, отправить изменение в staging.
3. Убедиться, что CI, images, test deploy, smoke и автоматический PR прошли.
   Проверить новую регистрацию, файлы и отдельность данных от production.
4. Провести контролируемый отказ readiness и возврат предыдущих образов на
   тестовом стенде. После этого зарегистрировать production baseline.
5. Защитить main: PR required, запрет force push/delete, обязательные
   `api`, `web`, `release-tooling`, `mobile`, `release-ready`, strict up-to-date;
   запрет обычного admin bypass. Проверить реальные имена checks в GitHub перед
   сохранением правил. Не требовать reviewer от второго человека.
6. Включить production server config и `PRODUCTION_DEPLOY_ENABLED=true`.
   Ручной Merge теперь является обычным действием выпуска.

## Ошибки и восстановление

Текущие/предыдущие manifests: `/var/lib/yaskapp-release/<environment>/current.json`
и `previous.json`; фаза и запрошенная версия — `attempt.json`. Логи:
`journalctl -u yaskapp-release-<environment>-<SHA>`. GitHub сохраняет release
manifest 90 дней; сервер сохраняет requests и состояние независимо от GitHub.
Копировать release config/manifests в отдельную резервную копию настройки:
существующий backup не гарантирует включение новых файлов `/etc/yaskapp/release`.

- Ошибка pull/backup: рабочая версия не меняется, исправить причину и повторить.
- Ошибка миграции: writers остановлены, статус `maintenance`; некоторые ранние
  миграции могли примениться. Проверить schema_migrations и фактическую схему.
- Ошибка readiness: автоматический возврат предыдущих images возможен только
  при неизменном наборе migration checksums. Иначе writers остаются остановлены.
- Обрыв SSH: сначала проверить systemd и attempt/current. Не удалять marker
  и не повторять миграцию, пока удалённая операция ещё работает.
- Если возврат тоже не проходит readiness, остаётся `maintenance`.

При ручном восстановлении сначала остановить новые writers, проверить схему,
выбрать совместимые images, применить `images.json` override с ними, проверить
все replicas/workers и публичные адреса. Только после этого обновить current
и поставить attempt status `rolled-back` для разрешения нового запуска.
Никогда не очищать attempt только для обхода блокировки. Восстановление БД
из backup — отдельная операция, которая может потерять новые пользовательские записи.

Исправленный повтор выпуска запускается через Re-run failed jobs того же
workflow с тем же manifest. Если main уже ушёл вперёд, старый workflow откажет:
нужен новый проверенный релиз. Вся pipeline заново может пересобрать digest,
поэтому immutable request нельзя заменить другим содержимым под прежним SHA.

## Локальная проверка tooling

```sh
python -m unittest discover -s infra/release -p 'test_*.py'
node --test infra/release/*.test.mjs
```

Docker Compose CLI нужен для теста изоляции. Статические и unit проверки
не заменяют реальный staging deploy, миграции и проверку восстановления.
