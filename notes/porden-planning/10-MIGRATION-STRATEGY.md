# 10 | Migration from the existing prototype

## Current working reference

The 2026-11-23 agent report describes a Node `server.mjs` prototype, SQLite case persistence, native browser nsDeploy modules pinned at upstream revision `486ecf26aa8775963f9b765f894734bef1ac9817`, merchant and courier pages, action bridge, signed receipts, several automated suites, and one successful live inference run. The local prototype and its proof files should be treated as **protected reference behavior**.

## Migration rules

1. Preserve a readable baseline copy and the successful trace, without copying API secrets.
2. Move incrementally, one boundary at a time; avoid simultaneous redesign of database, agent runtime and UI.
3. Keep old tests available until equivalent new-stack regression is green.
4. Do not edit vendored nsDeploy. Confirm upstream browser import paths, asset MIME/CSP, action bridge and discovery metadata under the new hosting layer.
5. Do not delete old SQLite code until PostgreSQL tests and manual replay results agree.
6. Make no commit or deploy without explicit approval.

## Suggested implementation stages

### Stage A | Inventory and contract freeze

Inspect existing server routes, SQLite schema, first-party action bridge, receipts/JWKS, permissions and test fixtures. Map observed APIs to proposed contracts, with a discrepancy list. Record exact fields and statuses. Only then freeze external API surface with frontend teammate.

### Stage B | Database abstraction and Postgres

Build a narrow persistence layer for `createCase`, `findByRequestId`, `getReceipt`, `createTransfer`, `setConsent`, and `recordVerifiedOutcome`. Recreate fixtures in two PostgreSQL DBs. Write migration and transactional idempotency tests. Switch the existing runtime HTTP handlers to the new DB layer before introducing Hono, if this produces the smallest change surface.

### Stage C | Hono/Bun

Create Hono routes with equivalent request/response behavior. Run Bun and both independent API deployments. Port tests and enforce exact origin, CSRF and receiver write permissions. Confirm key handling and signed receipts are byte- and semantically compatible where required.

### Stage D | Browser SDK

Extract merchant browser orchestration and verification into `@porden/sdk`, preserving official runtime calls. Publish typed events, mocks and documentation. Re-run scripted browser tests, including refusal, tampering, unknown outcomes and changed fields.

### Stage E | Next.js integration

The frontend teammate integrates the SDK in two Next.js apps. Keep runtime and first-party action bridge pages within correct public origins. Verify browser restrictions through actual deployed URLs.

### Stage F | Public evidence

Repeated live runs, security checks, observed impact measurements and clear conformance limitations. Retire old local app after all relevant behavior is proven on the new stack.

## Critical cutover hazards

- Replacing the upstream action transport with a custom `/api/transfer` call may lose hackathon conformance evidence.
- Using one shared Postgres connection for both organizations undermines ownership boundaries.
- A receipt signed after a nontransactional case commit may leave a permanent case without a retrievable receipt.
- Retrying an unknown write with a new request ID can duplicate a case.
- Binding consent only to field *names* allows modified values to cross the boundary; bind approved values or a canonical digest.
- Building the SDK only for the frontend app can accidentally couple it to Next.js routes and prevent reuse.
- Server-running a browser-only nsDeploy client may fail due to DOM/worker/popup assumptions; preserve its proven browser execution.
