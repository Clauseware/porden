<p align="center">
  <img src="public/assets/porden-devpost-banner.webp" alt="Porden" />
</p>

<h1 align="center">Porden</h1>

<p align="center">
  Open-source infrastructure for verifiable task handoffs across agents and organizations.
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

Porden is a handoff service for work that crosses an organizational boundary. One organization sends a task with structured terms, the other accepts an exact version of those terms, and the Porden API records every step and decides whether the work is authorized.

It is built for a common gap in agent-to-agent work. When agents from two organizations agree on something, the agreement often lives only in each side's own logs, with no shared record of what was agreed, who approved it, or whether the terms changed afterwards.

You integrate Porden into an existing application or agent workflow through the TypeScript SDK or the REST API (`/api/v2`). Porden has no knowledge of your domain. Terms are a generic structure (goal, constraints, acceptance criteria, budget, evidence), and your application decides what they mean.

This repository contains the platform API, the SDK, an approval dashboard, and two reference applications (a merchant and a courier) that use Porden to settle damaged-parcel claims.

## Why Porden?

An agent's output is text. It can misread a policy, invent an amount, or act on terms that have since been replaced. Porden keeps that text from becoming an action on its own: **agents propose, servers enforce.**

The reference applications apply this to a damaged-parcel claim:

1. **Filing.** The merchant's agent proposes a claim from the customer's message. The merchant server fills in the order facts and the price from its own records, then creates version 1.
2. **Deciding.** The courier's agent proposes one decision: accept, clarify, counter-offer, reject or complete. The courier server checks the proposal against its policy and refuses anything the policy does not allow.
3. **Changing terms.** A counter-offer becomes version 2. A human approver at the merchant must approve it, and the courier must then accept it. An open clarification or a pending revision blocks execution.
4. **Executing.** The courier's case write is tied to the accepted version and to a hash of the data the customer agreed to share. Consent given for version 1 is refused once version 2 is current.
5. **Verifying.** The courier's signed receipt states the agreed resolution. The merchant rejects a receipt whose resolution differs from the accepted terms.

| Porden core provides                                        | The reference applications provide                        |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| Versions, revisions, clarifications and the approval policy | The claim schema (`@porden/contracts/delivery-claims`)    |
| Acceptance and the authorization decision                   | Merchant order facts, pricing and customer consent        |
| Execution scopes, with reserve and settle                   | The courier's claims policy and counter-offer terms       |
| Signed receipts, idempotency and reconciliation             | The agents, their prompts and their nsDeploy site actions |

The claim workflow uses only the generic handoff contracts. Another domain adds its own schema, policy and actions in the same way.

## Features

- **Versioned terms.** Versions are immutable. A change creates a new version, and earlier ones stay on record.
- **Human approval as data.** Approvals are structured records tied to a handoff and version. The `humanApprovalRequired` policy is stored on the server, and client text cannot change it or claim an approval.
- **Separate acceptance.** The receiver must accept the exact approved version before it can execute or complete the work.
- **Reviewed revisions.** The receiver can propose changed terms. Authorization is blocked while a revision is pending, and a rejection leaves the approved terms intact.
- **Clarifications.** The receiver can request missing information. An open clarification blocks authorization until the sender answers.
- **Scoped execution.** Terms can list execution scopes: an action name and a SHA-256 hash of its parameters. The receiver reserves a scope before a protected write and settles it with the outcome. Porden refuses a reservation when the parameters do not match the accepted terms, when another reservation is open, or when that scope has already completed. This protects a write only if the receiver's own system reserves first, because Porden does not perform the write.
- **Signed receipts.** Every mutation returns an ES256 receipt binding the actor, organization, action, version and terms digest. Keys are published at `/.well-known/jwks.json`, and `verifyReceipt` checks a receipt against them.
- **Idempotent writes.** Every mutation carries a `requestId`. An identical repeat returns the same receipt, and the same ID with different content returns a conflict.
- **No silent retries.** The SDK reports an uncertain write as unknown and offers a read-only call to reconcile it.
- **Linked workflows.** A handoff can continue from an earlier one, so a return trip keeps its own versions, approvals and receipts in one shared history.
- **Organization isolation.** Handoffs, workflows and decisions that belong to another organization return 404.

## Quick start

You need:

- [Bun](https://bun.sh) 1.4.3, the version pinned in `packageManager`. Older versions cannot read `bun.lock`.
- Node 22 or newer.
- Docker, for PostgreSQL.
- Git. `bun install` uses it to fetch the pinned nsDeploy runtime (see [vendor/README.md](vendor/README.md)).

Run these from the repository root. They are the same in PowerShell, bash and zsh.

```sh
bun install --frozen-lockfile
docker compose -f infra/postgres/compose.yml up -d --wait
bun run setup:platform:demo
```

Then start each process in its own terminal:

```sh
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

The setup script writes the demo credentials to `tmp/platform-demo/accounts.json` and the API configuration to `apps/api/.env.platform`. Git ignores both. The script refuses to run again while that configuration exists. Use a separate browser profile for each account, because cookies are shared across ports on `localhost`.

This starts the platform demo, which uses no model. [PLATFORM.md](PLATFORM.md) walks through it.

## SDK

`@porden/sdk` is the typed client for the REST API. It is a workspace package and is not published to npm, so for now you use it from inside this repository.

```typescript
import { createHandoffClient, HandoffWriteUnknown } from '@porden/sdk';

// Server-side integration: keep this token out of browser bundles.
const porden = createHandoffClient({
  baseUrl: 'https://porden.example/api/v2',
  token: process.env.PORDEN_INTEGRATION_TOKEN,
});

const requestId = crypto.randomUUID(); // Persist before sending.

try {
  const { handoff, receipt } = await porden.createHandoff({
    requestId,
    receiverOrganizationId,
    terms: {
      goal: 'Purchase replacement supplies',
      constraints: ['Do not exceed the authorized budget'],
      acceptanceCriteria: ['Provide a purchase receipt'],
      budget: { amountMinor: 50000, currency: 'USD' },
    },
  });

  // Check the receipt's signature against the keys the platform publishes.
  const claims = await porden.verifyReceipt(receipt.signedReceipt);
  console.log(claims.action, claims.version, claims.termsSha256);

  // Before acting on a handoff, ask the server whether this exact version is authorized.
  const authorization = await porden.getAuthorization(handoff.id, handoff.currentVersion);
  if (!authorization.eligible) {
    console.log(authorization.reasonCode); // For example AWAITING_APPROVAL or ACCEPTANCE_REQUIRED.
  }
} catch (error) {
  if (!(error instanceof HandoffWriteUnknown)) throw error;
  // The write may or may not have committed. Read its outcome; do not send it again with a new ID.
  const { handoff } = await porden.reconcileOperation(error.operationId);
  console.log(handoff.status);
}
```

Notes on the example:

- `verifyReceipt` fetches `/.well-known/jwks.json` from the origin of `baseUrl`, so it trusts the keys that origin currently publishes.
- If `reconcileOperation` returns 404, the outcome is still unknown, because the write may be in flight. Check again later.
- Money is an integer in minor units.

The request and response types are inferred from the Zod schemas in [`packages/contracts`](packages/contracts). [PLATFORM.md](PLATFORM.md#api-and-sdk) maps the lifecycle methods to their endpoints.

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

In the reference workflow, the merchant and courier also run their own organization APIs (ports 5100 and 5200), each with its own database. Those APIs call the platform with a server-side integration token.

### Repository layout

| Path                                       | What it holds                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| [`apps/api`](apps/api)                     | Hono APIs: the platform (`/api/v2`) and the organization APIs (`/api/v1`) |
| [`apps/dashboard-web`](apps/dashboard-web) | Handoff list and human approval UI                                       |
| [`apps/merchant-web`](apps/merchant-web)   | Merchant reference app: `/`, `/claims`, `/verify` and `/tasks`           |
| [`apps/courier-web`](apps/courier-web)     | Courier reference app: `/`, `/claims` and `/tasks`                       |
| [`apps/porden`](apps/porden)               | Landing site (`bun run dev:porden`, port 4000)                           |
| [`packages/contracts`](packages/contracts) | Shared Zod schemas and the types inferred from them                      |
| [`packages/sdk`](packages/sdk)             | Typed clients: `createHandoffClient` and the delivery client             |
| [`infra/postgres`](infra/postgres)         | Docker Compose file and init script for local PostgreSQL                 |
| [`infra/standalone`](infra/standalone)     | Single-host Compose deployment with Caddy                                |
| [`scripts`](scripts)                       | Demo setup, key generation and the nsDeploy fetch                        |
| [`vendor`](vendor)                         | Pin for the nsDeploy runtime. The checkout itself is not in Git          |

### Built with

- [Bun](https://bun.sh) for the runtime, workspace and tests
- [Hono](https://hono.dev) for the API
- [PostgreSQL](https://www.postgresql.org) with [Drizzle ORM](https://orm.drizzle.team)
- [Next.js](https://nextjs.org) and React for the web apps
- [Zod](https://zod.dev) for the shared contracts
- [Oxlint and Oxfmt](https://oxc.rs) for linting and formatting

## Delivery demo

The merchant and courier apps run the damaged-parcel workflow described in [Why Porden?](#why-porden). Each side's agent runs in the browser on the [nsDeploy](https://github.com/cognizant-ai-lab/nsdeploy) runtime and calls its own organization's model route.

- **Merchant** (`/claims`): the customer files a claim through the merchant agent, answers clarifications, and sends the case once the courier has accepted. `/verify` checks a pasted receipt without signing in.
- **Courier** (`/claims`): staff work an inbox of received claims, run the courier agent on each, and review its proposed decision before it is submitted.
- **Dashboard**: the merchant's human approver decides counter-offers.

The case itself still moves through nsDeploy's action bridge: the merchant agent delegates to the courier's published network, and the courier confirms the write on its own origin. The original transfer flow remains at `/` on both apps.

Setup is longer than the platform demo. You need the platform running, both organization APIs, and model provider keys:

- [docs/WORKSPACE.md](docs/WORKSPACE.md#claim-workflow-setup) has the full setup: the organization APIs, the model provider settings, and the values that connect each organization to the platform.
- [docs/claims-integration-contract.md](docs/claims-integration-contract.md) documents the claim endpoints, agent tasks and receipt verifier.

## Development

Lint, format and type checks cover `apps/`:

```sh
bun run format
bun run check:apps
```

`check:apps` runs Oxlint with zero warnings, the Oxfmt check and TypeScript. The `Apps quality` workflow runs the same command on every push and pull request.

Unit tests need nothing else. API tests need the local Compose database:

```sh
bun run test:unit

# bash, zsh
export PORDEN_TEST_DATABASE_URL='postgres://porden_admin:local-admin-only@127.0.0.1:54329/porden_test'
# PowerShell
$env:PORDEN_TEST_DATABASE_URL='postgres://porden_admin:local-admin-only@127.0.0.1:54329/porden_test'

bun run test:api
```

The API tests create their own schemas and remove them afterwards. Browser and real-model suites are described in [CONTRIBUTING.md](CONTRIBUTING.md#browser-and-real-model-tests).

## Documentation

| Document                                                                   | Covers                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [PLATFORM.md](PLATFORM.md)                                                 | Platform setup, the demo, identity, the API and SDK reference    |
| [docs/WORKSPACE.md](docs/WORKSPACE.md)                                     | Organization API setup, the transfer flow and the prototype      |
| [docs/claims-integration-contract.md](docs/claims-integration-contract.md) | The claim workflow: endpoints, agent tasks and receipt verifier  |
| [infra/standalone/README.md](infra/standalone/README.md)                   | Running the single-host deployment                               |
| [PROOF_RESULTS.md](PROOF_RESULTS.md)                                       | Observed test results for each workflow and the prototype        |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                         | Branch rules and the full test matrix                            |
| [vendor/README.md](vendor/README.md)                                       | The nsDeploy pin and how to update it                            |

## Contributing

Branch from `dev` and open a pull request into `dev`. Run `bun run format` and `bun run check:apps` first. [CONTRIBUTING.md](CONTRIBUTING.md) has the branch and release rules and the full test matrix, and [AGENTS.md](AGENTS.md) lists the conventions the codebase follows.

## Licence

Porden is licensed under the [Apache License 2.0](LICENSE). Third-party notices are in [NOTICE](NOTICE).

## Acknowledgements

The reference workflow runs on the [nsDeploy](https://github.com/cognizant-ai-lab/nsdeploy) browser runtime from Cognizant AI Lab, used unmodified under the Apache License 2.0.
