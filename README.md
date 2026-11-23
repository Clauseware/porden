![Porden](public/assets/porden-devpost-banner.webp)

# porden

[![Apps quality](https://github.com/Clauseware/porden/actions/workflows/apps-quality.yml/badge.svg)](https://github.com/Clauseware/porden/actions/workflows/apps-quality.yml)

Reference implementation for [Porden](https://porden.dev): versioned task handoffs between organizations, with explicit approvals and signed receipts.

The product code lives under `apps/` — Hono APIs, Next.js UIs, PostgreSQL via Drizzle. Shared types and the browser client are in `packages/` and are consumed by those apps.

## Apps

| Directory | Role |
| --- | --- |
| [`apps/api`](apps/api) | Platform service (`/api/v2`) and per-org delivery APIs (`/api/v1`) |
| [`apps/dashboard-web`](apps/dashboard-web) | Handoff inbox and human approval UI |
| [`apps/merchant-web`](apps/merchant-web) | Merchant origin (delivery demo at `/`, platform consumer at `/tasks`) |
| [`apps/courier-web`](apps/courier-web) | Courier origin (same split as merchant) |

Two local setups:

1. **Platform** — `apps/api` platform entrypoint, `apps/dashboard-web`, and `/tasks` on the merchant/courier apps (ports 5300 / 4300 / 4100 / 4200).
2. **Delivery** — separate `apps/api` org configs plus merchant/courier home pages; uses the nsDeploy runtime (`vendor/nsdeploy`).

Platform operator guide (paths, accounts, API): [PLATFORM.md](PLATFORM.md).

## Prerequisites

- Bun 1.4+
- Node 22+
- Docker (Postgres via `infra/postgres/compose.yml`)
- [nsDeploy](https://github.com/cognizant-ai-lab/nsdeploy) under `vendor/nsdeploy` (delivery demo only)

## Platform demo

```powershell
bun install --frozen-lockfile
docker compose -f infra/postgres/compose.yml up -d --wait
bun run setup:platform:demo
```

```powershell
bun run dev:platform
bun run dev:dashboard
bun run dev:merchant
bun run dev:courier
```

| Service | URL |
| --- | --- |
| Platform API | http://127.0.0.1:5300/api/v2 |
| Dashboard | http://localhost:4300 |
| Company A (`/tasks`) | http://localhost:4100/tasks |
| Company B (`/tasks`) | http://localhost:4200/tasks |

Credentials: `tmp/platform-demo/accounts.json` (gitignored). Use one browser profile per demo account.

## Delivery demo

```powershell
bun install
docker compose -f infra/postgres/compose.yml up -d --wait
bun run keys:generate
Copy-Item apps/api/.env.merchant.example apps/api/.env.merchant
Copy-Item apps/api/.env.courier.example apps/api/.env.courier
bun run db:migrate:merchant
bun run db:migrate:courier
```

Set `SESSION_SECRET`, `DEMO_PASSWORD`, and the same `PARTNER_SECRET` in both files under `apps/api/`, then:

```powershell
bun run dev:api:merchant
bun run dev:api:courier
bun run dev:merchant
bun run dev:courier
```

Merchant UI: http://localhost:4100 — Courier: http://localhost:4200 (APIs on 5100 / 5200).

## SDK

Used from app code (for example `apps/dashboard-web`) via `@porden/sdk`:

```typescript
import { createHandoffClient } from '@porden/sdk';

const client = createHandoffClient({
  baseUrl: process.env.PORDEN_API_URL!,
  token: process.env.PORDEN_INTEGRATION_TOKEN!,
});

await client.createHandoff({
  requestId: crypto.randomUUID(),
  receiverOrganizationId: '00000000-0000-0000-0000-000000000000',
  terms: {
    goal: 'Purchase replacement supplies',
    constraints: ['Stay within authorized budget'],
    acceptanceCriteria: ['Provide a purchase receipt'],
  },
});
```

Mutations require a stable `requestId` for idempotency. Contract definitions: `packages/contracts` (imported by `apps/api` and the SDK).

## Tests and CI

All lint/format/typecheck targets `apps/`:

```powershell
bun run check:apps
bun run test:unit
$env:PORDEN_TEST_DATABASE_URL='postgres://porden_admin:local-admin-only@127.0.0.1:54329/porden_test'
bun run test:api
```

Browser suites (build the Next apps first): `bun run test:platform:browser`, `bun run test:porden:browser`.