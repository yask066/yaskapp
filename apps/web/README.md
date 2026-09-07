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

Browser access tokens are stored only in `sessionStorage` until cookie-based
authentication is introduced.

## Staging

The public client is available at `WEB_HOST` (default:
`web-staging.example.com`). Add its HTTPS origin to `CORS_ORIGINS` in
`services/api/.env.staging` before deployment.
