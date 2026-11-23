# Porden agent instructions

Applies to the entire repository. More specific instructions may be added only when a subproject needs them.

## Working principles

- Inspect the relevant code, contracts, and conventions before editing.
- Prefer the smallest change that solves the actual problem.
- Fail fast on invalid inputs, invalid states, and missing required configuration. Return clear errors at system boundaries.
- Preserve existing behavior, public contracts, and migrations unless the task explicitly requires changing them.
- Avoid unrelated refactors, speculative features, compatibility layers, and unnecessary dependencies.
- Never silently swallow errors or invent successful outcomes.
- Do not stage, commit, deploy, or make destructive changes without explicit authorization.

## TypeScript

- Do not use `any` or type assertions (`as`) to bypass type checking; prefer inference, narrowing, and correcting the source type.
- Model mutually exclusive states and alternatives with discriminated union types.
- Keep interfaces focused on clear object contracts; derive types from validation schemas when a schema already defines the contract.

## Backend (Bun, Hono, PostgreSQL, Drizzle)

- Validate external input at the endpoint route boundary using the project's existing schema validation approach.
- Derive TypeScript types from validation schemas; pass validated values into services so downstream types and autocomplete work without casts or duplicated interfaces.
- Prefer Hono's typed validation context and `c.req.valid(...)` where supported by the existing setup.
- Keep Hono routes focused on HTTP concerns: validate input, apply request-level authentication, call a service, and shape the response. Do not put business rules or database queries in handlers.
- Put handoff and other domain decisions in service modules. Keep reusable Drizzle query functions in `db/queries`; services coordinate domain transitions and persistence.
- Import modules from their source files. Do not add barrel files that only re-export another module.
- Use the shared Pino logger and HTTP error handler for request logging and error responses. Do not add ad hoc loggers or duplicate global error mapping.
- Validate state transitions and authorization before side effects. Use database constraints and transactions to preserve invariants.
- Handle duplicate requests and uncertain network outcomes explicitly; preserve idempotency and reconciliation behavior.
- Scope database access to the appropriate organization. Never trust organization identifiers supplied by a client without authorization.
- Avoid redundant validation inside trusted code paths; still enforce security and persistence invariants at their relevant boundaries.
- Avoid broad catch blocks, silent fallback behavior, and unsafe `any` or casts that defeat type inference.

## Frontend (Next.js and TypeScript)

- Use the existing merchant and courier Next.js applications and shared contracts/browser SDK.
- Prefer Server Components for server-rendered content and Client Components only where browser interaction is needed.
- Use React state and effects when appropriate. Do not add `useCallback` or `useMemo` without a demonstrated correctness or performance reason.
- Avoid unnecessary global state, custom hooks, wrappers, and component abstraction.
- Keep state minimal and derive display values from existing state when possible.
- Make loading, approval, cancellation, refusal, success, and error states explicit and accessible.
- Follow Porden's Forest & Paper identity: Forest `#0F3D2E`, Sage `#4E7C66`, Paper `#F6F4EB`, Ink `#1F1F1F`.
- Prioritize usable, readable interfaces and the working end-to-end flow before polish.

## Testing and delivery

- Test successful transfers, both approvals, cancellation, refusal, tampering, retries, and unknown-outcome reconciliation in a real browser.
- Verify organization database permissions and cross-origin behavior in the deployed environment.
- Run focused tests first, then relevant integration tests, typechecks, SDK builds, and frontend builds.
- Report completed changes, tests and exact results, outstanding risks, and unverified behavior.
- Ask before expanding scope or introducing a new architectural pattern.

## Linting and formatting (required for `apps/`)

- Use Oxlint and Oxfmt. Root commands are deliberately scoped to `apps/`; do not reformat `packages/`, `vendor/`, proof files, or the legacy prototype as part of these checks.
- Run `bun run format` after editing application files, then `bun run check:apps` before delivery. This enforces Oxlint with zero warnings, Oxfmt check mode, and TypeScript checking.
- The `Apps quality` GitHub Actions workflow runs the same required command on pushes and pull requests. Keep this check passing; repository branch protection can require it once the workflow is pushed.
- Fix lint failures at their source. Do not disable rules, add broad ignores, or use unsafe casts just to pass a check.
- Generated Next.js files, dependencies, Drizzle-generated migrations/snapshots and historical SQL migrations are excluded. Do not rewrite an applied migration for formatting.
- Handle errors at request, transport, rendering and process boundaries. Use the shared error envelope and safe SDK/UI messages; retain the request ID and sanitized diagnostic codes. Never log credentials, payloads, SQL parameters or upstream response bodies.
- Do not suppress failures with successful defaults or automatic write retries. Keep uncertain writes unknown and reconcile them read-only.
