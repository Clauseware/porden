![Porden](public/assets/porden-devpost-banner.webp)

# porden

[![Apps quality](https://github.com/Clauseware/porden/actions/workflows/apps-quality.yml/badge.svg)](https://github.com/Clauseware/porden/actions/workflows/apps-quality.yml)

This repository is the reference code for [Porden](https://porden.dev).

Porden moves tasks between organizations. Each handoff has a version, an approval step, and a signed receipt.

The product code is in `apps/`. The apps use Hono, Next.js, and PostgreSQL. Shared types and the browser client are in `packages/`. The apps import those packages.

## Apps

| Directory | Role |
| --- | --- |
| [`apps/api`](apps/api) | Platform API (`/api/v2`) and delivery APIs (`/api/v1`) |
| [`apps/dashboard-web`](apps/dashboard-web) | Handoff list and human approval UI |
| [`apps/merchant-web`](apps/merchant-web) | Merchant site. Delivery demo at `/`. Platform tasks at `/tasks` |
| [`apps/courier-web`](apps/courier-web) | Courier site. Same paths as the merchant site |

You can run two local demos.

**Platform demo.** Start the platform API in `apps/api`. Start `apps/dashboard-web`. Open `/tasks` on the merchant and courier apps. Use ports 5300, 4300, 4100, and 4200.

**Delivery demo.** Start separate org APIs in `apps/api`. Start the merchant and courier home pages. This demo needs the nsDeploy runtime in `vendor/nsdeploy`.

For setup steps and API details, see [PLATFORM.md](PLATFORM.md).

## Prerequisites

You need Bun 1.4 or newer. You need Node 22 or newer. You need Docker for PostgreSQL. The compose file is in `infra/postgres/compose.yml`.

For the delivery demo only, clone [nsDeploy](https://github.com/cognizant-ai-lab/nsdeploy) into `vendor/nsdeploy`.

## Platform demo

Run these commands from the repository root.

```powershell
bun install --frozen-lockfile
docker compose -f infra/postgres/compose.yml up -d --wait
bun run setup:platform:demo
```

Start each process in a separate terminal.

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

The setup script writes demo accounts to `tmp/platform-demo/accounts.json`. That file is not in Git. Use one browser profile for each demo account.

## Delivery demo

Run these commands from the repository root.

```powershell
bun install
docker compose -f infra/postgres/compose.yml up -d --wait
bun run keys:generate
Copy-Item apps/api/.env.merchant.example apps/api/.env.merchant
Copy-Item apps/api/.env.courier.example apps/api/.env.courier
bun run db:migrate:merchant
bun run db:migrate:courier
```

Set `SESSION_SECRET`, `DEMO_PASSWORD`, and `PARTNER_SECRET` in both env files under `apps/api/`. Use the same `PARTNER_SECRET` in both files.

Start each process in a separate terminal.

```powershell
bun run dev:api:merchant
bun run dev:api:courier
bun run dev:merchant
bun run dev:courier
```

Open the merchant UI at http://localhost:4100. Open the courier UI at http://localhost:4200. The org APIs listen on ports 5100 and 5200.

## SDK

Import `createHandoffClient` from `@porden/sdk`. The dashboard app uses this client.

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

Each mutation needs a `requestId`. Send the same `requestId` again to repeat an identical request. The API types are in `packages/contracts`.

## Tests and CI

Lint, format check, and TypeScript run only on `apps/`.

```powershell
bun run check:apps
bun run test:unit
$env:PORDEN_TEST_DATABASE_URL='postgres://porden_admin:local-admin-only@127.0.0.1:54329/porden_test'
bun run test:api
```

Build the Next.js apps before you run a browser test. Use `bun run test:platform:browser` or `bun run test:porden:browser`.