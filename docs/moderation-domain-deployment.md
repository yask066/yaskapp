# Moderation domain deployment

The staging deployment expects two DNS records pointing to the VPS public IP:

```text
api-staging.example.com         A <VPS_PUBLIC_IP>
moderation-staging.example.com  A <VPS_PUBLIC_IP>
```

Until a domain is registered and delegated, the staging Caddy configuration
also provides a development-only IP route:

```text
http://5.44.44.197/admin
```

The IP route serves the moderation web app under `/admin` and proxies the API
paths through the same host. It does not provide HTTPS and must not be used
for production moderation access.

Replace both example hostnames with the real domain before deployment. Caddy
automatically requests and renews certificates for both hosts through ports 80
and 443. PostgreSQL, Redis, MinIO, the API container, and the moderation web
container remain on the private Docker network.

On the VPS:

```bash
cd /opt/yaskapp
cp services/api/.env.staging.example services/api/.env.staging
# Edit secrets and set STAGING_API_DOMAIN, MODERATION_HOST, and CORS_ORIGINS.
nano services/api/.env.staging

docker compose -f infra/docker/docker-compose.staging.yml config
docker compose -f infra/docker/docker-compose.staging.yml up -d --build
docker compose -f infra/docker/docker-compose.staging.yml ps
docker compose -f infra/docker/docker-compose.staging.yml logs -f https moderation-web api
```

Verify from outside the VPS:

```bash
curl -I https://moderation-staging.example.com
curl https://api-staging.example.com/health/ready
```

Only TCP ports 80, 443, and restricted SSH should be exposed by the VPS
firewall. Do not publish ports 5432, 6379, 9000, or 9001. The moderation
hostname still requires staff authentication; before public exposure it must
also be placed behind VPN/SSO and MFA.
