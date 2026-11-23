# 06 | Backend backlog

**Owner:** Backend / agent interoperability engineer.  
**Prioritization:** P0 = must pass for judge-accessible release; P1 = strengthens reusable-product and impact claims; P2 = future product.

A past passing test is marked **baseline proven**, while new-stack work remains **TODO**. No items in this document claim to have been implemented under Bun/Hono/PostgreSQL.

## P0 ordered tasks

| ID | Task | Status | Acceptance criteria |
| --- | --- | --- | --- |
| B01 | Create Bun workspace and package boundaries | TODO | `bun install`, `bun run lint`, and sample workspace tests work on Windows; no generated implementation changes to upstream runtime |
| B02 | Define Zod transfer, consent, receipt and error contracts | TODO | Contract fixtures pass; teammate signs off on required types/events |
| B03 | Provision two PostgreSQL databases + migration runner | TODO | Clean setup builds both schemas; independent DB users; migrations repeatable |
| B04 | Migrate receiver case storage from SQLite to Postgres | TODO | Six original HTTP behavior tests adapted and passing; one case for duplicate request |
| B05 | Migrate sender transfer state to Postgres | TODO | Draft, scoped approval, submitted, accepted/rejected/unknown persisted across restarts |
| B06 | Implement atomic receipt + idempotency transaction | TODO | Duplicate same ID returns same case/receipt; changed payload returns conflict; dropped ACK recoverable |
| B07 | Move existing API routes to independent Hono/Bun service | TODO | Contract/API regression, origin/CSRF and auth checks pass; no cross-org DB leakage |
| B08 | Extract official-runtime browser orchestration to `@porden/sdk` | TODO | Real nsDeploy `remote_fetch`/`remote_call` remain in trace; no custom replacement transport |
| B09 | Bind approved data and verify receipts at server boundary | TODO | Extra/altered fields blocked; invalid issuer/key/case/transfer scope rejected |
| B10 | Deliver stable SDK fixtures + integration guide to frontend teammate | TODO | Teammate can build UI against typed mock and subsequently real API |
| B11 | Add reconciliation for unknown receiver writes | TODO | Read-only lookup by stable ID; no blind write retry after ambiguous response |
| B12 | Deploy two HTTPS origins and separately configured APIs | TODO | Cross-site discovery, popup and cookie/CORS behavior verified in clean browser |
| B13 | Run live-model reliability and security regression matrix | TODO | Predeclared run count and acceptance thresholds recorded; full pass/fail evidence retained |
| B14 | Publish demo-safe config, tests, docs and receipts | TODO | Fresh clone reproducible; secrets absent; demo usable without maintainer intervention |

## P1, only after P0 stability

| ID | Task | Acceptance criteria |
| --- | --- | --- |
| B15 | Add second **backend-only** case schema | Same core SDK and action lifecycle works for `service_referral`, using another validated schema |
| B16 | Open-source standalone receiver adapter example | Developer can attach receiver action to a minimal Hono case API without copying merchant demo |
| B17 | Capture product-impact instrumentation | Real timings, consent outcomes, duplicate counts and verified acceptance recorded safely |
| B18 | External developer integration trial | Record setup time, blockers, and resulting change requests |

## P2, excluded from hackathon critical path

- Generic CRM integrations, ticket lifecycle synchronization and status webhooks.
- Partner directory, automated recipient discovery, organization onboarding and billing.
- General industry authorization, regulated health/finance workflows, production identity and compliance framework.
- Public MCP facade, private stewards, queue-based background case processing, generic multi-tenancy.

## Ticket completion requirements

Every ticket includes a regression test, source of truth for its outcome, and a short change report. Preserve existing behavior unless a documented contract revision is approved. Do not refactor unrelated modules, commit, or deploy without explicit permission.

## Work order dependency

`B01 → B02 → B03 → B04/B05 → B06/B07 → B08/B09/B10 → B11 → B12/B13 → B14`

Frontend work begins after **B02/B10 fixtures**, in parallel with backend tasks; it must not wait for public deployment.
