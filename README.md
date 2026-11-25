<p align="center">
  <img src="public/assets/porden-devpost-banner.webp" alt="Porden" />
</p>

<h1 align="center">Porden</h1>

<p align="center">
  Versioned, human-approved handoffs between organizations and their AI agents.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a>
  &middot;
  <a href="PLATFORM.md">Platform guide</a>
  &middot;
  <a href="#sdk">SDK</a>
  &middot;
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/Clauseware/porden/actions/workflows/apps-quality.yml"><img src="https://github.com/Clauseware/porden/actions/workflows/apps-quality.yml/badge.svg?branch=dev" alt="Apps quality" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Clauseware/porden" alt="Licence: Apache 2.0" /></a>
  <img src="https://img.shields.io/badge/bun-1.4.3-C5A1C9" alt="Bun 1.4.3" />
</p>

<hr />

## What is Porden?

Porden moves a task from one organization to another without losing track of who agreed to what. Each handoff carries structured terms (goal, constraints, acceptance criteria, budget, evidence). The terms are versioned, a human approves them where policy requires it, the receiver accepts an exact version, and every step produces a signed receipt.

The server decides whether work is authorized. It calculates that from persisted state, never from text an agent wrote.

This repository is the reference implementation: a central API, a TypeScript SDK, an approval dashboard, and two demo organizations that hand work to each other.

## Features

- **Versioned terms.** Each version is immutable. A change creates a new version, and the earlier one stays on record.
- **Human approval as data.** Approvals are structured records tied to a handoff, a version and a scope. An organization's `humanApprovalRequired` policy lives on the server, and client text cannot change it or claim an approval.
- **Acceptance is separate from approval.** The receiver accepts the exact approved version before it can execute or complete the work.
- **Revisions with review.** The receiver can propose changed terms, such as a higher budget. Authorization is blocked while the revision is pending, and rejecting it leaves the original terms intact.
- **Signed receipts.** Every mutation returns an ES256 receipt that binds the actor, organization, action, version and a digest of the terms. Public keys are served at `/.well-known/jwks.json`.
- **Idempotent writes.** Every mutation takes a `requestId`. Repeating the identical request returns the same receipt, and reusing the ID with different content returns a conflict.
- **No silent retries.** The SDK reports an uncertain write as unknown and offers a read-only call to reconcile it.
- **Linked workflows.** A handoff can continue from an earlier one, so a return trip keeps its own versions, approvals and receipts inside one shared history.
- **Organization isolation.** Handoffs, workflows and decisions that belong to another organization return 404.

## Quick start

You need:

- [Bun](https://bun.sh) 1.4.3, the version pinned in `packageManager`. Older versions cannot read `bun.lock`.
- Node 22 or newer.
- Docker, for PostgreSQL.
- Git. `bun install` uses it to fetch the pinned nsDeploy runtime (see [Delivery demo](#delivery-demo)).

Run these from the repository root:

```powershell
bun install --frozen-lockfile
docker compose -f infra/postgres/compose.yml up -d --wait
bun run setup:platform:demo
```

Then start each process in its own terminal:

```powershell
bun run dev:platform
bun run dev:dashboard
bun run dev:merchant
bun run dev:courier
```

| Service              | URL                          | Demo account                 |
| -------------------- | ---------------------------- | ---------------------------- |
| Platform API         | http://127.0.0.1:5300/api/v2 | Integration token or session |
| Dashboard            | http://localhost:4300        | `a.approver` or `b.approver` |
| Company A (`/tasks`) | http://localhost:4100/tasks  | `a.member`                   |
| Company B (`/tasks`) | http://localhost:4200/tasks  | `b.member`                   |

The setup script writes the demo credentials to `tmp/platform-demo/accounts.json` and the API configuration to `apps/api/.env.platform`. Git ignores both. Use a separate browser profile for each account, because cookies are shared across ports on `localhost`.

[PLATFORM.md](PLATFORM.md) walks through the full demo: Company A creates a USD 500 task, Company B proposes USD 550, a human at Company A decides, and Company B completes the work and sends a linked return.

## SDK

`@porden/sdk` is the typed client. It is a workspace package and is not published to npm.

```typescript
import { createHandoffClient } from '@porden/sdk';

// Server-side integration: keep this token out of browser bundles.
const porden = createHandoffClient({
  baseUrl: 'https://porden.example/api/v2',
  token: process.env.PORDEN_INTEGRATION_TOKEN,
});

const created = await porden.createHandoff({
  requestId: crypto.randomUUID(), // Persist before sending. Reuse it only for an identical retry.
  receiverOrganizationId,
  terms: {
    goal: 'Purchase replacement supplies',
    constraints: ['Do not exceed the authorized budget'],
    acceptanceCriteria: ['Provide a purchase receipt'],
    budget: { amountMinor: 50000, currency: 'USD' },
  },
});

// Ask the server what is authorized. Do not execute changed terms under an older authorization.
const scope = await porden.getAuthorization(created.handoff.id, 1);
```

Money is an integer in minor units. The request and response types come from the Zod schemas in [`packages/contracts`](packages/contracts). The method-to-endpoint table is in [PLATFORM.md](PLATFORM.md#api-and-sdk).

## Architecture

```text
 Company A app            Dashboard             Company B app
 merchant-web :4100    dashboard-web :4300    courier-web :4200
        |                     |                      |
        +----------- /api/v2 (proxied) --------------+
                              |
                    Platform API (Hono) :5300
                              |
                 PostgreSQL (porden_platform)
```

Each Next.js app proxies `/api/v2` to the platform API, so browser sessions use first-party cookies. Machine integrations call the API with a Bearer token and cannot make human approval decisions.

### Repository layout

| Path                                       | What it holds                                                    |
| ------------------------------------------ | ---------------------------------------------------------------- |
| [`apps/api`](apps/api)                     | Hono API: platform (`/api/v2`) and delivery demo (`/api/v1`)     |
| [`apps/dashboard-web`](apps/dashboard-web) | Handoff list and human approval UI                               |
| [`apps/merchant-web`](apps/merchant-web)   | Company A. Delivery demo at `/`, platform tasks at `/tasks`      |
| [`apps/courier-web`](apps/courier-web)     | Company B. Same paths as the merchant app                        |
| [`apps/porden`](apps/porden)               | Landing site (`bun run dev:porden`, port 4000)                   |
| [`packages/contracts`](packages/contracts) | Shared Zod schemas and the types inferred from them              |
| [`packages/sdk`](packages/sdk)             | Typed client: `createHandoffClient` and `createPordenClient`     |
| [`infra/postgres`](infra/postgres)         | Docker Compose file and init script for local PostgreSQL         |
| [`scripts`](scripts)                       | Demo setup, key generation and the nsDeploy fetch                |
| [`vendor`](vendor)                         | Pin for the nsDeploy runtime. The checkout itself is not in Git  |

### Built with

- [Bun](https://bun.sh) for the runtime, workspace and tests
- [Hono](https://hono.dev) for the API
- [PostgreSQL](https://www.postgresql.org) with [Drizzle ORM](https://orm.drizzle.team)
- [Next.js](https://nextjs.org) and React for the web apps
- [Zod](https://zod.dev) for the shared contracts
- [Oxlint and Oxfmt](https://oxc.rs) for linting and formatting

## Delivery demo

The merchant and courier apps also run the original delivery demo at `/`. A customer-approved damage case moves from the merchant to the courier through the [nsDeploy](https://github.com/cognizant-ai-lab/nsdeploy) browser runtime, and the courier returns a signed receipt.

nsDeploy is not in Git. `bun install` runs a `postinstall` step that clones the pinned revision into `vendor/nsdeploy`. Set `PORDEN_SKIP_NSDEPLOY=1` to skip the step, or run `bun run vendor:nsdeploy` to fetch it by hand. The pin is recorded in [vendor/README.md](vendor/README.md).

```powershell
bun install
docker compose -f infra/postgres/compose.yml up -d --wait
bun run keys:generate
Copy-Item apps/api/.env.merchant.example apps/api/.env.merchant
Copy-Item apps/api/.env.courier.example apps/api/.env.courier
bun run db:migrate:merchant
bun run db:migrate:courier
```

Set `SESSION_SECRET`, `DEMO_PASSWORD` and `PARTNER_SECRET` in both env files under `apps/api/`. `PARTNER_SECRET` must be the same in both.

```powershell
bun run dev:api:merchant
bun run dev:api:courier
bun run dev:merchant
bun run dev:courier
```

The merchant UI is at http://localhost:4100 and the courier UI is at http://localhost:4200. The two organization APIs listen on ports 5100 and 5200. [docs/WORKSPACE.md](docs/WORKSPACE.md) describes this flow and its API in detail.

## Development

Lint, format and type checks cover `apps/`:

```powershell
bun run format
bun run check:apps
```

`check:apps` runs Oxlint with zero warnings, the Oxfmt check and TypeScript. The `Apps quality` workflow runs the same command on every push and pull request.

### Tests

```powershell
bun run test:unit
$env:PORDEN_TEST_DATABASE_URL='postgres://porden_admin:local-admin-only@127.0.0.1:54329/porden_test'
bun run test:api
```

The API tests create their own schemas in the local Compose database and remove them afterwards.

The browser suites run against production builds, so build first:

```powershell
bun run build:dashboard
bun run build:merchant
bun run build:courier
bun run test:platform:browser
bun run test:porden:browser
```

Both suites use ports 4100 and 4200, so run them one after the other. They need an installed Playwright and Chromium. Set `HANDOFF_PLAYWRIGHT_MODULE` and `HANDOFF_CHROME` to point at an existing installation.

## Documentation

| Document                                                                   | Covers                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [PLATFORM.md](PLATFORM.md)                                                 | Platform setup, the demo, identity, the API and SDK reference    |
| [docs/WORKSPACE.md](docs/WORKSPACE.md)                                     | The delivery demo, its API decisions and the original prototype  |
| [docs/claims-integration-contract.md](docs/claims-integration-contract.md) | The claims integration contract                                  |
| [PROOF_RESULTS.md](PROOF_RESULTS.md)                                       | Observed test results and remaining conformance gaps             |
| [vendor/README.md](vendor/README.md)                                       | The nsDeploy pin and how to update it                            |

## Project status

Porden is at version 0.1.0 and runs as a local demo. A few limits to know about:

- The platform demo uses no LLM and makes no external purchase.
- Nothing here deploys the system. Public HTTPS hosting, deployed CORS and session behaviour, and deployed database permissions still need to be configured and verified for each deployment.
- There are no public endpoints for managing accounts or roles. An operator provisions organizations and principals.
- Porden controls authorization at its own API. It cannot stop a tool that bypasses the API, and it does not check whether supplied evidence is true.

## Contributing

`main` is release-only. Day-to-day work merges into `dev`.

1. Branch from `dev` and open a pull request into `dev`. It needs one approval and a passing `Apps quality` check.
2. Releases go from `dev` to `main`. Only that head branch is allowed, and only @TraFost approves and merges to `main`.
3. Do not push to `main` directly, and do not target `main` from a feature branch.

Run `bun run format` and `bun run check:apps` before you open a pull request. [AGENTS.md](AGENTS.md) lists the conventions the codebase follows.

## Licence

Porden is licensed under the [Apache License 2.0](LICENSE). Third-party notices are in [NOTICE](NOTICE).

## Acknowledgements

The delivery demo runs on the [nsDeploy](https://github.com/cognizant-ai-lab/nsdeploy) browser runtime from Cognizant AI Lab, used unmodified under the Apache License 2.0.
