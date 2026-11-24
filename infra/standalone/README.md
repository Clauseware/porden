# Standalone VPS operations

One deployment configuration: `compose.yml`. It runs Caddy, PostgreSQL 17, and the existing platform, merchant and courier Bun/Hono APIs. No hosted control panel, extra proxy, backup service or orchestration layer is required. This is backend preparation only; no server has been deployed.

## Topology and state

Only Caddy publishes host ports 80 and 443. All five services share one project-private Docker bridge. APIs have no published ports, run as UID 1000 with read-only root filesystems, and retain the verified startup migrations and `/health` / `/ready` checks. PostgreSQL has no published port and uses password-authenticated connections inside that same-host private bridge; this deployment does not configure database TLS or an external database.

| HTTPS hostname | Routing |
| --- | --- |
| `PLATFORM_DOMAIN` | Platform API, port 5300 |
| `MERCHANT_DOMAIN` | `/api/v2` goes to platform; other paths go to merchant, port 5100 |
| `COURIER_DOMAIN` | `/api/v2` goes to platform; other paths go to courier, port 5200 |

Business JWKS routes remain on the owning merchant/courier API. Platform receipts must be verified using the platform API origin, not a business origin's key. SDK contracts and business logic are unchanged. nsDeploy manifests and owned popup/action assets use the configured public HTTPS business origins. The existing frontend applications are not included in this backend stack; their eventual same-origin hosting must preserve these route and key boundaries.

PostgreSQL contains `porden_platform`, `porden_merchant`, and `porden_courier`, each owned by its corresponding non-superuser role. Public database connectivity is revoked and each role is denied access to the others' databases. The platform service continues enforcing organization membership, approvals, acceptance and scoped execution from persisted state.

Named volumes `postgres_data`, `caddy_data` and `caddy_config` persist database data, certificates/ACME state and Caddy configuration state. Keep the same Compose project name (`porden` by default) across updates. `docker compose down` preserves them; **do not use `down --volumes` on a real deployment**.

## Minimum VPS setup, after approval

Requirements: a Linux VPS with Docker Engine/Compose, persistent disk, outbound HTTPS access, and three DNS hostnames pointing to it. Allow inbound TCP 80/443 to Caddy; keep database/API ports closed. Host administration access is separate from container port publishing. Build images locally or on the VPS using the existing Dockerfile.

From the repository root:

```sh
cd infra/standalone
cp .env.example .env
chmod 600 .env
mkdir -p secrets backups
chmod 700 secrets backups
```

Fill `.env` with the three hostnames, certificate contact email, independent hexadecimal database passwords, independent session secrets, mock passwords, shared reconciliation secret, and provisioned organization IDs/integration credentials. Use strong random values; hexadecimal database passwords avoid URL-encoding ambiguities. Provider inference credentials are optional and are passed only to merchant. Set `DASHBOARD_PUBLIC_ORIGIN` only if a separately hosted dashboard needs browser access.

Reuse the existing three persistent P-256 PKCS8 signing keys. If preparing a fresh environment, generate each key once (OpenSSL example):

```sh
umask 077
for service in platform merchant courier; do
  # Noclobber prevents accidental replacement of an existing key.
  (set -C; openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 > "secrets/$service.pem")
done
```

Ensure signing keys are readable by container UID 1000 and keep their IDs and private material stable across redeployments. On a root-managed Linux VPS, `chown 1000:1000 secrets/*.pem` and `chmod 400 secrets/*.pem` accomplish this while the parent directory remains private. Never generate keys or change persisted database passwords automatically during startup.

After source/image and target approval:

```sh
docker compose config --quiet
docker compose build
docker compose up -d --wait
```

PostgreSQL bootstraps the three roles/databases only when its data volume is empty. The APIs run the existing migration commands before serving. Migration failures stop startup. Existing volumes are reused and existing migration journals are preserved.

For the first deployment, prepare private `secrets/provision.json` using the existing [Provisioning contract](../../apps/api/src/db/platform-provision.ts): two organizations and their human/integration principals. UUIDs and integration credentials must match `.env`; integration principals remain members, and only human approvers can grant human approval. Keep human approval required unless explicitly authorized otherwise. Make this file readable only by its owner/container UID 1000, then provision once:

```sh
docker compose run --rm --no-deps --entrypoint bun \
  -v "$PWD/secrets/provision.json:/run/secrets/provision.json:ro" \
  -e PORDEN_PROVISION_FILE=/run/secrets/provision.json \
  platform apps/api/src/db/platform-provision.ts
```

Provisioning is not automatically retried or run on restart. Keep traffic restricted until provisioning and public checks succeed. The mocks retain their fixed demo customer/order; this does not turn them into production business identity systems.

Caddy's [automatic HTTPS](https://caddyserver.com/docs/automatic-https) obtains and renews public certificates and redirects HTTP to HTTPS. Public DNS and inbound challenge connectivity must work before certificate issuance can be confirmed. The internal Docker DNS aliases send API-to-API HTTPS requests through this same Caddy with the same public hostnames and normal certificate verification. Do not add incompatible popup/opener or frame restrictions that break the official nsDeploy bridge.

## Updates and logs

Review the approved source release and take a consistent backup before updating. Use the same `.env`, signing keys and Compose project name:

```sh
docker compose build
docker compose up -d --wait --remove-orphans
docker compose ps
docker compose logs --tail=100 -f platform merchant courier caddy postgres
```

For a Caddyfile-only routing change, validate then reload without replacing its certificate volume:

```sh
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
```

An image rollback does not undo database migrations. Restore into an isolated replacement first if an incompatible schema rollback is required. Application/session/signing credentials must not be changed as an incidental update.

## Consistent backup

These commands are for a POSIX shell on the VPS, from `infra/standalone`. They stop writers and certificate renewal briefly so the three dumps and Caddy archive form a consistent set. `set -e` leaves services stopped if a backup command fails; resolve the error before restarting.

```sh
set -eu
umask 077
backup="backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
docker compose stop platform merchant courier caddy
for db in porden_platform porden_merchant porden_courier; do
  docker compose exec -T postgres pg_dump -U postgres -Fc "$db" > "$backup/$db.dump"
done
docker compose run --rm --no-deps --entrypoint tar caddy czf - -C /data . > "$backup/caddy-data.tgz"
docker compose up -d --wait
```

Copy this backup set off the VPS securely. Also preserve `.env`, signing keys, the private provisioning record and the approved source/Caddyfile in protected backups, separately from public artifacts. The dumps preserve table ownership and platform principal records; the bootstrap SQL and matching `.env` recreate the fixed database roles/passwords on a fresh cluster. Dump archives and Caddy data contain sensitive material. No backup scheduler/service is added.

## Restore to an empty replacement

Use an approved empty replacement VPS/volumes first, with the same source, `.env`, signing keys and project name restored. Do not start the APIs before restoring. Existing-installation restores require an explicit maintenance decision: `pg_restore --clean` overwrites database objects, and a complete recovery should use empty databases rather than leave later, unarchived objects behind.

```sh
set -eu
backup=backups/REPLACE_WITH_BACKUP_TIMESTAMP
docker compose up -d --wait postgres
for db in porden_platform porden_merchant porden_courier; do
  docker compose exec -T postgres pg_restore -U postgres --exit-on-error --clean --if-exists -d "$db" < "$backup/$db.dump"
done
docker compose run --rm --no-deps --entrypoint tar caddy xzf - -C /data < "$backup/caddy-data.tgz"
docker compose up -d --wait
```

Check `/health`, `/ready`, platform history and receipt verification, and a controlled protected-write/reconciliation flow before allowing traffic. Retain the original backup until recovery is verified. Caddy certificates must still be valid for the deployed DNS names; restored certificate state does not prove public DNS/challenge access.

## Local verification and remaining gates

```sh
# Repository root; Python cryptography is already used by the existing verification suite.
docker build -f apps/api/Dockerfile -t porden-api:release-candidate .
bun run test:release
bun run check:apps
```

The release check uses this exact Compose file, a generated project name, loopback-only temporary published ports, and Caddy's internal test issuer. It trusts only the generated test CA, never disables certificate/hostname verification, and does not use a separate proxy or Compose override. `PORDEN_EXTRA_CA_BASE64` is an optional public CA trust input used for this test; production uses Caddy's public ACME issuer without it. All fixtures/backups remain under ignored `tmp/`; only that generated project's containers/volumes are removed afterward.

Checks cover private port exposure, readiness, HTTP-to-HTTPS redirects, same-origin routing, database role/organization isolation, protected writes, signed receipts, uncertain-write reconciliation and nsDeploy HTTPS assets. They recreate containers while preserving data/certificates, compare data/ownership/sequence snapshots, restore all three databases plus Caddy storage from archives, and repeat protected writes afterward. Failed migrations and database-outage readiness are also verified.

The existing `infra/postgres/compose.yml` is a development-only database fixture, not a second deployment stack. No application code or public SDK contracts were refactored for this change. Public documentation, SDK quickstarts and submission work remain deferred.

The completed local run is recorded in `tmp/porden-release-8e4a24ba58eb/result.json`, with the tested image ID. All seven HTTPS integration checks passed before and after recovery. Host-port isolation, HTTP redirects, migration replay, database/certificate persistence, three database restores, Caddy archive restoration and outage/startup failure checks passed. The 62 unit/API tests and app lint/format/type checks also passed. This used a private local CA; no public ACME issuance was attempted.

Exact deployment file changes:

- `infra/standalone/compose.yml`: the single deployment stack, now with built-in PostgreSQL and Caddy and no external network dependencies.
- `infra/standalone/Caddyfile`: new HTTPS and origin-preserving reverse proxy configuration.
- `infra/standalone/.env.example`: simplified domain/credential template with private signing-key defaults.
- `infra/standalone/entrypoint.sh`, `healthcheck.mjs`, `bootstrap-postgres.sql`: moved/reused startup, readiness and role initialization; startup can explicitly trust a supplied local test CA.
- `infra/standalone/tests/check.mjs`: reused HTTPS/API checks against actual Caddy, including password and ownership isolation.
- `infra/standalone/README.md`: internal operator commands and verification report, replacing control-panel instructions.
- `apps/api/Dockerfile`: updated startup and health-check file paths; the verified API image structure and runtime remain unchanged.
- `tests/test_backend_release.py`: exercises this one Compose file, including published routing, persistent volumes and database/Caddy archive recovery.
- `.gitignore` and `.dockerignore`: exclude private deployment keys, provisioning files and backup archives.

The obsolete control-panel directory, separate test Compose overlay and handwritten test TLS proxy have been removed. No control-panel-specific references remain in active repository files.

Local success is not public HTTPS verification. Remaining gates: approved Docker-capable VPS and DNS, real credentials/provisioning, successful public ACME issuance, and the complete browser flow against actual public domains. Nothing has been committed, pushed or remotely deployed.
