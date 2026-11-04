# Панель модерации

Статическое приложение для дел, апелляций, аудита, политик, удалённых аккаунтов
и запретов IP. Разделы видны по полномочиям; API повторно проверяет каждое действие.

Локально отдавать эту папку статическим web-сервером. Если API на другом origin,
задать `window.__MODERATION_API_BASE__` перед загрузкой `src/main.js`
и разрешить origin панели в `CORS_ORIGINS` API.

В staging Caddy обслуживает `MODERATION_HOST`, а временный HTTP-маршрут —
`http://<STAGING_PUBLIC_IP>/admin/`. Конфигурация и создание первого superadmin —
в [инструкции сервера](../../docs/moderation-domain-deployment.md).

Текущая сессия использует Bearer-токен только в памяти, очищаемый при выходе
и истечении сессии. Для production нужны HTTPS, VPN/SSO, MFA и замена MVP-сессии
на защищённую cookie с CSRF-защитой.

Проверки из корня репозитория:

```sh
node --check apps/moderation-web/src/main.js
node --test apps/moderation-web/test/smoke.test.mjs
```
