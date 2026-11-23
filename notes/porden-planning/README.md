# Porden | Planning package

**Date:** 2026-11-23  
**Status:** Product and implementation plan; proposed contracts are not yet implemented.  
**Submission target:** Cognizant Open Agentic Web Challenge, January 11, 2027.

## Decision

Porden is a consent-based case-transfer layer for independent organizations and their AI agents. The hackathon proves one complete, customer-approved merchant-to-courier case transfer, with a receiving-organization receipt that can be independently verified. The protocol should admit other case types without rebuilding the transfer lifecycle.

## Technology and ownership

- **Bun:** package manager, workspace, tests, and Hono runtime.
- **Hono:** independently deployed backend API, operating separately for merchant and courier.
- **PostgreSQL:** persistent database on each organization boundary. SQLite is retired through migration.
- **Next.js + TypeScript:** frontend, owned by the frontend teammate.
- **TypeScript browser SDK:** reusable Porden client built around the **official nsDeploy browser runtime**. It is distinct from both API and frontend.
- **Monorepo:** shared contracts and tooling, while keeping independently deployed services and organizational data separate.

The successful prior prototype uses Node, SQLite, local browser origins, and the official runtime. Those results form our regression baseline; they are **not evidence that the new Bun/Hono/PostgreSQL/Next.js architecture has passed tests**.

## Files

| Document | Purpose |
| --- | --- |
| [01-PRODUCT-SCOPE.md](01-PRODUCT-SCOPE.md) | User problem, product boundary, MVP, exclusions |
| [02-HYPOTHESES-IMPACT.md](02-HYPOTHESES-IMPACT.md) | Demand assumptions, research, impact metrics |
| [03-ARCHITECTURE.md](03-ARCHITECTURE.md) | Bun/Hono/Next.js/SDK topology and trust boundaries |
| [04-POSTGRES-DATA-MODEL.md](04-POSTGRES-DATA-MODEL.md) | Persistence, transactions, idempotency and migration rules |
| [05-API-SDK-CONTRACT.md](05-API-SDK-CONTRACT.md) | Proposed typed client and API/event contract |
| [06-BACKEND-BACKLOG.md](06-BACKEND-BACKLOG.md) | Ordered engineering backlog and acceptance criteria |
| [07-ROADMAP.md](07-ROADMAP.md) | Weekly work plan and dependencies |
| [08-FRONTEND-HANDOFF.md](08-FRONTEND-HANDOFF.md) | Contract and integration responsibilities for teammate |
| [09-QUALITY-GATES.md](09-QUALITY-GATES.md) | Testing matrix, release criteria, deployment checks |
| [10-MIGRATION-STRATEGY.md](10-MIGRATION-STRATEGY.md) | Incremental migration from working prototype |
| [11-AGENT-TASK-BRIEF.md](11-AGENT-TASK-BRIEF.md) | Copyable instructions for implementation agent |
| [12-DECISIONS-OPEN-QUESTIONS.md](12-DECISIONS-OPEN-QUESTIONS.md) | ADRs, assumptions requiring decisions |

## Working sequence

1. Agree on contracts and constraints in documents 03–05.
2. Migrate database with old behavior preserved.
3. Extract browser SDK and move HTTP handlers to Hono/Bun.
4. Give teammate SDK and mock fixtures, while backend work continues.
5. Prove real cross-origin behavior on HTTPS, test repeated runs and record impact evidence.

## Evidence baseline and sources

Internal report supplied 2026-11-23: official-runtime scripted browser scenarios, six original HTTP tests, a successful real-model handoff through OpenRouter with three real calls, one persisted courier case, signed receipt verification, and an omitted unapproved address. **One successful real-model run** is evidence of feasibility, not measured reliability or production conformance.

Documentation checked:
- [Official Agentic Web MVP specification](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md)
- [Official nsDeploy actions](https://github.com/cognizant-ai-lab/nsdeploy/blob/main/docs/actions.md)
- [Hono on Bun](https://hono.dev/docs/getting-started/bun)
- [Bun SQL / PostgreSQL](https://bun.com/docs/runtime/sql)
- [Next.js with Bun](https://bun.com/guides/ecosystem/nextjs)

**Policy:** protect the existing functioning flow. Do not edit vendored upstream runtime, claim unrun checks, deploy, commit, or introduce new infrastructure without explicit approval.
