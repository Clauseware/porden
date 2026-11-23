# 11 | Agent implementation brief

## Mission

Migrate the **already-working Porden reference prototype** into a **Bun monorepo** with **Hono backend**, **PostgreSQL**, **independently deployable Next.js frontends**, and a **reusable browser TypeScript SDK**, while keeping the verified official nsDeploy agent path and all security checks.

### Non-negotiable constraints

- **Use PostgreSQL, not SQLite**, in the target implementation. Preserve old SQLite baseline until replacement is verified.
- Backend must be a separate Bun/Hono service. It must be callable by other frontends and independently deployable from Next.js.
- SDK must be independent from backend and Next.js, browser-first, and wrap the official upstream browser runtime. Do not create a custom agent-to-agent transport.
- Two independent business origins and two independently configured API/DB deployments; same Hono codebase can be deployed twice under different environment settings.
- Frontend will be developed by another teammate using Next.js. Provide stable typed contracts and fixture responses before backend migration is complete.
- Preserve explicit customer field consent, first-party receiver write approval, scope checks, idempotency, signed receipt verification and unknown-outcome semantics.
- No speculative dependencies, unnecessary rewrites, code commits, deployments or upstream runtime edits without user approval.
- Document observed facts, inferred risks and untested assumptions separately.

## Work to perform first

1. Inspect the current repo and report exact existing files, routes, schemas, runtime imports, test scripts and proven behavior.
2. Produce a concise migration map from current implementation to `apps/api`, `packages/sdk`, `packages/contracts`, `apps/merchant-web`, `apps/courier-web`.
3. Propose exact Zod request/response schemas, SDK methods and runtime event mapping. Highlight divergences from existing behavior.
4. Implement workspace scaffolding and PostgreSQL migrations in minimal reviewed stages.
5. Replace SQLite case persistence with Postgres transaction and stable `(caller_origin, request_id)` uniqueness, preserving immutable signed receipts.
6. Move existing server endpoints to Hono/Bun. Keep every old API behavior test passing after adaptation.
7. Extract browser orchestration into reusable SDK that still calls official nsDeploy `remote_fetch` and `remote_call` and uses upstream first-party action bridge.
8. Supply teammate with types, fixtures, local dev configuration and integration guide; leave visual design to teammate.
9. Add Postgres integration, contract, browser, live-model and public HTTPS conformance checks.

## Reporting format per milestone

- Changed files and why.
- Existing behavior preserved.
- New behavior implemented.
- Exact tests and command output; distinguish passed, failed, skipped, and unrun.
- Observed defects with evidence; keep hypotheses labeled.
- Remaining blockers and next smallest task.
- Confirm no commit/deploy occurred unless requested.

## Acceptance definition

Fresh local setup with Bun and PostgreSQL; Hono API in separate process; merchant and courier use different database credentials/origins; Next.js teammate can consume SDK and contracts; official runtime traces show linked cross-site call; consent works; one case persists; signed receipt verifies; duplicate and unknown cases are safe; public HTTPS end-to-end live-model tests pass. Any conformance claim must be backed by a specific observed test.
