# Porden

Bun workspace implementation of [the Porden plan](notes/porden-planning/README.md): independent Hono APIs backed by PostgreSQL through Drizzle ORM, browser TypeScript SDK, shared Zod contracts, and two Next.js integration scaffolds. Visual UI remains owned by the frontend teammate.

The protected Node/SQLite reference remains in `server.mjs`, `config.mjs`, `public/`, and `tests/`. Run it with `bun run start:baseline`. Its evidence does not establish that the replacement stack works end to end.

## New workspace

| Existing responsibility | Replacement |
| --- | --- |
| `server.mjs` HTTP handlers | `apps/api/src/app.ts`: one Hono app deployed separately per organization |
| SQLite `cases` and `shipments` | Typed Drizzle schemas in `apps/api/src/db/`, role-specific migrations in `apps/api/drizzle/`, atomic case and receipt transaction |
| Merchant in-tab state | Persistent sender transfers, consent scopes, and safe event metadata |
| `public/merchant/merchant.js` orchestration | `packages/sdk`: official Engine, action bindings, review dialog, and action bridge |
| Ad hoc payload checks | `packages/contracts`: strict schemas, types, canonical JSON, action schema |
| Static websites | `apps/merchant-web` and `apps/courier-web`: teammate scaffolds with same-origin API/runtime proxies |

## Local setup

Requires Bun, Node 22+, Docker Desktop, and the existing pinned `vendor/nsdeploy` checkout. Run all commands from the repository root.

```powershell
bun install
docker compose -f infra/postgres/compose.yml up -d --wait
bun run keys:generate
Copy-Item apps/api/.env.merchant.example apps/api/.env.merchant
Copy-Item apps/api/.env.courier.example apps/api/.env.courier
```

Set independent `SESSION_SECRET` and `DEMO_PASSWORD` values in each organization file. Set the same randomly generated `PARTNER_SECRET` in both files. Keep private keys separate and stable; the generator preserves existing keys. Existing root `.env` OpenRouter settings remain private. Compose credentials are local demo credentials; the two organization roles cannot connect to each other's databases. The administrator is only for initialization and isolated tests.

```powershell
bun run db:migrate:merchant
bun run db:migrate:courier
# Four separate terminals:
bun run dev:api:merchant
bun run dev:api:courier
bun run dev:merchant
bun run dev:courier
```

Merchant website: http://localhost:4100; courier: http://localhost:4200. APIs bind to loopback ports 5100/5200 and are separately configured. Next.js proxies API, discovery, official runtime assets and receiver bridge to its own organization's backend. `API_INTERNAL_ORIGIN` optionally overrides each proxy destination. There are no private `NEXT_PUBLIC_*` settings.

Sign in on the courier scaffold before opening an action popup. The merchant teammate calls `client.signIn(password)` before draft creation. Demo authentication uses an explicit password and a one-hour authenticated session, with separate cookie names for local organizations. It is not production identity or a production rate-limiting solution.

## Frontend integration

```ts
import { createPordenClient } from '@porden/sdk';
const client = createPordenClient({
  senderApiBaseUrl: '/api', runtimeAssetBaseUrl: '/runtime',
  model: 'your-configured-tool-calling-model',
  onEvent: event => updateTimeline(event),
});
await client.signIn(merchantDemoPassword);
const draft = await client.createDraft({
  recipientOrigin: 'http://localhost:4200', caseType: 'delivery_damage',
  data: {orderReference: 'DEMO-1042', damageDescription: 'Parcel damaged in transit'},
});
const outcome = await client.transfer({transferId: draft.id,
  approvedFields: ['orderReference', 'damageDescription'],
  confirm: review => showCustomerConsent(review),
});
// For unknown results: await client.reconcile(draft.id). Never repeat the write.
```

`confirm` must show the exact recipient and selected fields. Optional address data is excluded from inference and the receiver when absent from `approvedFields`. The SDK checks exact delegation and action arguments before the official merchant review and independent courier confirmation. There is no custom agent transport or automatic write retry. Accepted status comes from server verification of the receiver-signed receipt. It means accepted, not resolved.

Fixtures are exported from `@porden/sdk/fixtures`: accepted, cancelled, unknown, a cryptographically valid synthetic signed receipt with public JWKS, and a bad signature. The fixture private key was discarded. These fixtures are not live-service evidence. Events fire only when observed; `receiver_confirmation_required` is reserved until upstream exposes a reliable popup event. A model proposal does not produce an acceptance event.

## API and contract decisions

Routes use `/api/v1` on each public origin. Both expose `/healthz`, `/readyz`, public discovery/runtime assets and `/.well-known/jwks.json`. Login is `POST /api/v1/session` with `{password}`; authenticated GET returns a CSRF token. Writes require the exact public Origin, organization session and CSRF token.

Merchant supports `POST /transfers`, `GET /transfers/:id`, and POST suffixes `/approve`, `/submit`, `/outcome`, `/receipts`, `/reconcile` under `/api/v1`. `/outcome` accepts only `cancelled` or `unknown`; a client cannot mark itself accepted. Courier supports public `GET /api/v1/case-types`, first-party `POST /api/v1/cases`, and partner-authenticated read-only `/api/v1/cases/by-request/:requestId` and `/by-transfer/:id`. The lookup credential stays server-side. No public unauthenticated write endpoint is provided.

Intentional changes from the prototype and draft plan:

- Stable transfer UUIDs come from the sender. The official runtime request ID remains intact in receiver storage and receipts; no lossy or new-ID write retry. Unique `(caller_origin, request_id)` and `(caller_origin, transfer_id)` prevent both duplicate classes.
- Official action arguments are `{transferId, caseType, data, approval}`. The signed approval binds recipient, transfer, fields, canonical data hash, demo subject and ten-minute expiry. The courier verifies it using the configured merchant's JWKS; it does not follow a caller-supplied key URL.
- Sender `draft_data` and `approved_data` preserve consent scope; drafts also store customer ownership. Accepted receipts persist with the case atomically and replay byte-for-byte. Signed receipts bind the exact payload hash in addition to IDs and field names.
- `/submit`, `/outcome` and `/reconcile` make persisted lifecycle and recovery explicit. Receipt lookup by public receipt ID is omitted; server-side reconciliation uses scoped transfer or request IDs.
- `rejected` remains a typed outcome for future definite refusals. The official runtime's ambiguous write failures remain `unknown`. A 404 during reconciliation also stays unknown because an earlier write may still be in flight.

There is no migration of synthetic SQLite records. The original database and signing key are untouched. Drizzle's Bun SQL adapter handles queries and transactions; Drizzle's migrator applies independent merchant/courier migration folders. Role and checksum guards remain active. Databases already initialized by the original SQL runner are adopted without recreating their tables. Never point both APIs at the same database. Future migrations must be additive; do not alter an applied SQL file. Rollback before cutover means restarting the preserved baseline, not deleting or rewriting existing data.

Edit `merchant-schema.ts` or `courier-schema.ts`, then generate migrations with `bun run --cwd apps/api db:generate:merchant` or `db:generate:courier`. Review generated SQL before running the corresponding root `db:migrate:*` command. The initial foreign keys use unqualified references so isolated test schemas work through PostgreSQL's `search_path`; preserve that property for future migrations.

## Verification and current limits

```powershell
bun run typecheck
bun run test:unit
# Disposable DB initialized by Docker Compose; tests create and drop unique schemas:
$env:PORDEN_TEST_DATABASE_URL='postgres://porden_admin:local-admin-only@127.0.0.1:54329/porden_test'
bun run test:api
bun run build:merchant
bun run build:courier
# Protected reference regression:
python -m pytest tests/test_api.py -q -p no:cacheprovider
node --test tests/test_openrouter.mjs tests/test_proposal_format.mjs
```

Observed in this implementation session: TypeScript check, both Next.js builds, browser SDK bundling, 12 new unit tests and all eight original API/config checks passed. After the Drizzle conversion, all five PostgreSQL integration tests passed against Docker-hosted PostgreSQL: existing-schema adoption, concurrent idempotency/conflicts, atomic rollback, lost-ack reconciliation and changed/expired consent. These tests use isolated schemas, not independent deployment credentials; deployment database-role isolation is still a separate release check. PostgreSQL tests are skipped when `PORDEN_TEST_DATABASE_URL` is absent.

The user started Docker Compose and installed dependencies outside the managed sandbox. This session then connected to PostgreSQL directly and verified the Drizzle integration tests. `bun.lock` is present and a frozen offline dependency install passed; the old npm lockfile is only a prototype artifact. The Drizzle Kit CLI hit a sandbox OS-user lookup error, so initial migrations and snapshots were generated through Drizzle Kit's programmatic API. New-stack browser/live-model transfer, repeated-run reliability and public HTTPS remain unverified. Do not retire the baseline or claim conformance until those gates pass. No commit or deployment was performed.

## Original prototype guide

# Handoff: merchant to courier through nsDeploy

A local demonstration of a customer-approved damage case moving between independent merchant and courier origins through the official Cognizant nsDeploy browser runtime. The courier owns case creation, SQLite persistence and ES256 receipt issuance.

The application serves the unmodified runtime from `vendor/nsdeploy/nsdeploy/runtime`. It publishes resolved JSON networks (valid HOCON), manifests, links and discovery metadata directly. It does not run the Python nsDeploy generator or require its server packages. The active merchant flow uses the official agent loop and action bridge.

## Run on Windows

Requires Node 22 or newer. Obtain the official source if it is not already present:

```powershell
git clone https://github.com/cognizant-ai-lab/nsdeploy.git vendor/nsdeploy
```

The inspected and tested upstream revision is `486ecf26aa8775963f9b765f894734bef1ac9817`. Keep that checkout when reproducing these results; another upstream revision needs revalidation. No upstream files are modified.

```powershell
npm start
```

Open **http://localhost:4100**. Courier is **http://localhost:4200**. To change ports, set `HANDOFF_MERCHANT_PORT` and `HANDOFF_COURIER_PORT` before starting. Discovery, peer policy and the action adapter follow those ports.

1. Open **AI settings**. When `OPENROUTER_API_KEY` is configured, **Use configured OpenRouter key** is selected automatically and no browser key is needed. Enter a tool-calling model ID, or configure `OPENROUTER_MODEL`. To use browser BYOK instead, uncheck that option and enter a CORS-enabled OpenAI-compatible provider base URL, model ID and key. Only the selected complaint fields go to the inference provider, including while running the peer network.
2. Review the fictional order and damage description. Leave **Include delivery address** unchecked to omit it from both inference and the courier action.
3. Check permission to contact Demo Courier and click **Review transfer on Demo Courier**.
4. The merchant agent delegates the exact approved JSON to the independently published courier network. The courier agent proposes `create_damage_case`.
5. Review the fields in the official merchant dialog and select **Confirm actions**. Select **Open action site** to open the official courier-origin popup.
6. Select **Confirm actions** on the courier popup. The courier writes the case and returns its signed receipt. The merchant verifies its signature, issuer, request ID, case/receipt IDs and approved field names.
7. Follow **Verify this record** to read the persisted courier record.

Cancelling merchant review creates no case. Refusing courier confirmation creates no case; the official runtime conservatively reports its action status as `unknown` with “User declined; action not started.” Network failure or timeout also means `unknown`, because a write may already have committed. There is no automatic retry. A completed or uncertain submission remains disabled in that tab. Before starting a new submission after uncertainty, inspect the local courier database; a fresh proposal has a fresh runtime request ID.

## OpenRouter configuration

Create or extend the project-root `.env` using [.env.example](.env.example). Preserve any existing key:

```dotenv
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=nvidia/nemotron-3.5-super-vl:free
```

`npm start` loads this file with Node's built-in environment loader. Existing process environment values take precedence. Lowercase `openrouter_api_key` and `openrouter_model` are also accepted. The model setting is optional; without it, select the model in AI settings. Restart the server after changing configuration.

`config.mjs` reads the settings. `/api/config` exposes only key availability and the model ID. The merchant's same-origin `/api/llm/chat/completions` endpoint streams requests to the fixed OpenRouter completion URL using the server key. It rejects other browser origins and does not forward browser credentials or expose the key. The official runtime uses a non-secret marker for this route. Manual browser BYOK continues to send the visitor's key directly to their selected provider. The environment-key route uses the local operator's OpenRouter account and is intended for this loopback-only demo.

The selected free model is [NVIDIA Nemotron 3.5 Super VL](https://openrouter.ai/nvidia/nemotron-3.5-super-vl:free). OpenRouter's endpoints metadata listed zero prompt/completion pricing and support for `tools` and `tool_choice` on 2026-11-23. Availability and free-tier limits can change.

Run the opt-in live end-to-end test with your configured key:

```powershell
npm run test:live
```

It uses synthetic data, a temporary courier database, real inference and the official runtime. It requires an explicit `:free` model, confirms both origins' dialogs, checks one persisted case and a verified receipt, and saves the outcome and trace to `tmp/live-proof/result.json`. It does not intercept inference, retry failures, or switch models. The latest user-run test passed: three real model calls, one persisted case, a verified signed receipt and reported inference cost $0. Earlier network and response-format failures are documented in the results report.

## Execution path

```text
Merchant selected fields
  -> official Engine.runTurn()
  -> merchant_front / courier link
  -> official consent hook, peer manifest/network fetch, Session.invoke()
  -> courier_front runs in the customer's browser using the caller's inference route
  -> courier action catalog discovered through the official bridge
  -> validated create_damage_case CRUSE proposal returned to merchant
  -> official Engine.submitActions() and merchant review
  -> official ActionBridgeClient / courier-origin popup confirmation
  -> courier registerActions().execute()
  -> authenticated, Origin- and CSRF-checked POST /api/cases
  -> SQLite and signed receipt
  -> official runtime action receipt and merchant ES256 verification
```

The merchant checks the model's delegation request and proposed write against the exact approved fields and recipient. A model cannot expand the transfer. Official runtime request IDs contain `:`; the courier maps the complete stable ID to `handoff_` plus its SHA-256 hex digest, preserving the existing API's transfer-ID format. The merchant independently derives the same ID during receipt verification.

Public artifacts on both origins are `/agent-manifest.json`, `/<network>.network.json`, `/links.json`, `/agent-mcp.json`, `/.well-known/nsdeploy.json`, and `/.well-known/nsdeploy-agent.json`. They allow cross-origin reads. Only runtime modules on an explicit allowlist are served from the checkout. Business endpoints retain their existing origin/session/CSRF checks. Public MCP metadata declares the facade unavailable.

## Automated checks

The HTTP suite requires Python, pytest and cryptography. The browser suite requires JavaScript Playwright and Chromium:

```powershell
python -m pip install pytest cryptography
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm test
npm run test:config
npm run test:browser
# Both suites through the existing pytest entry point:
python -m pytest tests -q -p no:cacheprovider
```

For an existing installation, `HANDOFF_PLAYWRIGHT_MODULE` can name its absolute `file:///.../playwright/index.mjs` URL and `HANDOFF_CHROME` its Chromium executable. The browser tests start two fresh origins and use isolated temporary databases and signing keys. They intercept only inference with explicitly marked scripted model responses; the official runtime, network loading, action discovery, MessagePorts, popup, HTTP writes, database and signing code execute normally. No provider key or paid inference is required for tests.

Browser-test evidence is written to `tmp/runtime-proof/trace.json` and `tmp/runtime-proof/merchant-receipt.png`. In the UI, the runtime trace is also available at `window.__nsweb.trace.export()` after starting a transfer. Trace data contains approved complaint fields, so use synthetic data.

See [PROOF_RESULTS.md](PROOF_RESULTS.md) for validation results, investigation references and remaining conformance gaps.

## Development limits

This uses fictional orders and a fixed development customer. `handoff-demo.sqlite` and `courier-signing-key.pem` persist locally. Keep the key private; removing it invalidates existing receipts. No production identity or deployment security is claimed.

The original `/bridge.html` and courier-home legacy handoff route remain for compatibility. The current merchant flow never invokes them or falls back to them. `/action-bridge.html` loads the official nsDeploy bridge.

The live free-model handoff has passed once. Repeated-run reliability and public HTTPS hosting remain unverified; full hackathon conformance and production readiness are not claimed.
