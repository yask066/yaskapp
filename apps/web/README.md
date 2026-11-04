# Публичный web

Подготовка API и инфраструктуры — в [корневом README](../../README.md#локальный-запуск).
Команды из корня репозитория:

```sh
npm run dev -w @yaskapp/web
npm run build -w @yaskapp/web
```

`VITE_API_PROXY_TARGET` задаёт адрес API для dev proxy, по умолчанию
`http://localhost:3000`. `VITE_API_BASE_URL` задаёт явный адрес API в собранном клиенте;
для staging за Caddy оставить пустым, чтобы использовать текущий origin.

Авторизация — HttpOnly cookie `yaskapp_session`. Запросы отправляются с credentials;
JWT не сохраняется в JavaScript storage.

## Флаги сборки

`VITE_FEED_PAGINATION`, `VITE_REACTIONS_MOTION` и `VITE_ENTRY_MOTION` по умолчанию
выключены. Только строка `true` включает соответствующий режим.

Например, для локальной проверки реакций в PowerShell:

```powershell
$env:VITE_REACTIONS_MOTION = "true"
npm run build -w @yaskapp/web
Remove-Item Env:VITE_REACTIONS_MOTION
```

Bash: `VITE_REACTIONS_MOTION=true npm run build -w @yaskapp/web`.
Флаг встраивается в bundle; для отката пересобрать с `false` или без переменной.
Dockerfile не объявляет build args этих флагов: переменные окружения хоста сами
по себе не попадут в Docker build.

Условия включения и проверки — в [чек-листе выпуска](../../docs/staging-smoke-test.md).
