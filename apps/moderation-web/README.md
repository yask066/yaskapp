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

The panel now contains capability-gated Cases, Appeals, Audit, and Policy
sections. The browser keeps the access token in memory only, clears it on
logout/session expiry, and treats `401`, `403`, `404`, `409`, and `429` as
explicit session or operation errors. The API repeats every permission check.

Before production, replace the MVP login/token flow with an httpOnly Secure
cookie session, MFA through the identity provider, CSRF protection, strict
origin/CORS rules, HTTPS, and an internal VPN/SSO boundary. Do not expose
`MODERATION_HOST` directly to the public internet.
