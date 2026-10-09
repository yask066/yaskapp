# Yaskapp public web client

The Vite application is served locally by the development server and as static
files in staging.

## Local development

Start the API and web development servers from the repository root:

```bash
npm run api:dev
npm run dev -w @yaskapp/web
```

`VITE_API_PROXY_TARGET` changes the API target used by Vite's local `/api`
proxy. It defaults to `http://localhost:3000`.

`VITE_API_BASE_URL` changes the API base URL used by the built client. Leave
it unset for same-origin requests through the staging web host.

Motion rollout is controlled at build time by `VITE_REACTIONS_MOTION` and
`VITE_ENTRY_MOTION`. Both default to off; only the exact value `true` enables a
flag. Set them in the web build environment, then build and deploy the static
client:

```bash
VITE_REACTIONS_MOTION=true VITE_ENTRY_MOTION=false npm run build -w @yaskapp/web
```

Roll out reactions first, then entry motion after its smoke checks. To roll
back, set the affected value to `false` (or leave it unset), rebuild, and
deploy that build. These values are embedded in the generated files; there is
no remote kill switch.

Browser authentication uses an HttpOnly `yaskapp_session` cookie. The browser
client sends requests with credentials and never reads or stores the JWT in
JavaScript storage. The API also retains bearer-token responses for native
clients during the migration.

## Staging

The public client is available at `WEB_HOST` (default:
`web-staging.example.com`). Add its HTTPS origin to `CORS_ORIGINS` in
`services/api/.env.staging` before deployment.
