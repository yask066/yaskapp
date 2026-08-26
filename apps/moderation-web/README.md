# Yaskapp Moderation Web

Standalone static moderation workspace for Phase 2.

The MVP keeps the access token in memory only. Production deployment should
replace the login/token flow with an httpOnly secure cookie, MFA, CSRF
protection, a dedicated moderation origin, and an IP/VPN policy.

The panel calls:

- `POST /auth/login`;
- `GET /moderation/capabilities`;
- `GET /moderation/cases`;
- `GET /moderation/cases/:caseId`;
- case assignment, notes, transitions, and content-removal endpoints.

For local static serving, serve this directory from a web server and set
`window.__MODERATION_API_BASE__` before loading `src/main.js` when the API is
on a different origin.

The staging compose file builds this app as `moderation-web` and Caddy routes
`MODERATION_HOST` (default `moderation.localhost`) to it. Set a real internal
hostname before exposing the panel. Put it behind VPN/SSO or an equivalent
network access layer before production exposure, and use HTTPS.

The staging Caddyfile uses separate `STAGING_API_DOMAIN` and
`MODERATION_HOST` hostnames. The moderation hostname serves the panel and
proxies only the panel's API paths to the private API container, so the panel
does not depend on a developer-machine IP or a public catch-all HTTP route.

For preliminary development without a registered domain, the same staging
stack also exposes the panel at `http://<STAGING_PUBLIC_IP>/admin` and proxies
API requests from that IP to the private API container. Set
`STAGING_PUBLIC_IP` in `services/api/.env.staging`. This IP/HTTP route is for
development only; use a domain with HTTPS plus the production access controls
before exposing the moderation panel publicly.

The panel now contains capability-gated Cases, Appeals, Audit, and Policy
sections. The browser keeps the access token in memory only, clears it on
logout/session expiry, and treats `401`, `403`, `404`, `409`, and `429` as
explicit session or operation errors. The API repeats every permission check.

Before production, replace the MVP login/token flow with an httpOnly Secure
cookie session, MFA through the identity provider, CSRF protection, strict
origin/CORS rules, HTTPS, and an internal VPN/SSO boundary. Do not expose
`MODERATION_HOST` directly to the public internet.

CI runs `node --check src/main.js` and the web smoke tests together with the
full API typecheck and integration suite. The API suite includes moderation
report-to-case, content removal, sanctions, appeals, idempotency, rollback,
concurrency, session enforcement, and permission matrix coverage.
