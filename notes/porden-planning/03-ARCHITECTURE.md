# 03 | Architecture: Bun + Hono + PostgreSQL + Next.js + SDK

## Decision

**Yes, backend and frontend should be separate deployable services.** The **SDK should also be an independently versioned package**. This gives Porden a reusable developer-facing product while keeping the demo frontend replaceable.

Start as a **Bun workspace monorepo**, rather than separate Git repositories. Deployments and secrets stay separate; types and tests stay easy to share. Separate repositories can be considered after a real independent consumer appears.

## Proposed structure

```text
porden/
  apps/
    api/                     # Hono application; deploy once per organization
      src/
        index.ts
        routes/
        services/
        db/
        adapters/
    merchant-web/            # Next.js app, owned by frontend teammate
    courier-web/             # Next.js app, owns first-party confirmation page
  packages/
    sdk/                     # @porden/sdk: browser-side orchestration
      src/
    contracts/               # @porden/contracts: Zod schemas + TS types
  infra/
    postgres/
    proxy/
  docs/                      # This planning package
  vendor/nsdeploy/           # Pinned upstream checkout, read-only
  bun.lock
  package.json               # Bun workspaces
```

Do not create additional packages until reuse is demonstrated. `apps/api` is **one codebase deployed as two separately configured services**, for example `ORGANIZATION_ROLE=merchant` and `ORGANIZATION_ROLE=courier`, with independent `DATABASE_URL`, signing material, allowed origins and permissions. If the code becomes role-specific, split bounded adapters within `apps/api` before considering another service repository.

## Organization boundary

```text
Merchant domain                         Courier domain
merchant.example                       courier.example
+-----------------------+              +------------------------+
| Next.js merchant-web  |              | Next.js courier-web    |
| + Porden browser SDK |              | + first-party approval |
| + upstream nsDeploy   |--------------| + published agent data |
+-----------+-----------+ linked agent +-------------+----------+
            |                                            |
      /api reverse proxy                          /api reverse proxy
            |                                            |
+-----------v-----------+              +-------------v----------+
| Hono API deployment A |              | Hono API deployment B  |
| sender transfer state |              | case + JWS receipt     |
+-----------+-----------+              +-------------+----------+
            |                                            |
       PostgreSQL A                                PostgreSQL B
```

Use distinct **public origins** for the organizations. `example` domains are placeholders. For local development, separate localhost ports are acceptable; for conformance, test public HTTPS. Each public domain may reverse-proxy `/api/*` to its separately running Hono service so the browser sees same-origin HTTP paths while the backend remains independently deployable. Configure reverse-proxy trust and exact origin allowlists explicitly.

Two isolated **PostgreSQL databases** on one local Postgres instance are fine for development. A deployed organization must use its own database credentials and independently controlled signing keys. Cross-company data never shares a common authorization scope.

## Responsibility boundaries

| Layer | Owns | Does not own |
| --- | --- | --- |
| Next.js web | User-facing pages, consent/approval presentation, transfer timeline, receipt display | Write authority, private signing keys, authoritative case status |
| Browser SDK | Typed integration API, official browser runtime orchestration, approved-field transfer envelope, receipt verification UI helpers | Server-side secret keys, fabricated confirmation, replacement agent runtime |
| Official nsDeploy runtime | Agent execution, linked-network discovery/delegation, supported first-party action bridge | Porden business persistence and domain-specific authorization |
| Hono sender API | Scoped consent records, transfer status, optional verified receipts and reconciliation | Courier's case ownership |
| Hono receiver API | Own case action validation, transaction, idempotency, signed receipt, lookup by request ID | Merchant-side permission decision |
| PostgreSQL | Atomic records, idempotent case state and minimal audit history | Full external case lifecycle beyond acceptance |

## Critical runtime placement

The **official nsDeploy runtime is browser-side** in the proven implementation. Keep its execution, discovery, consent hooks and browser action transport there. Hono supplies domain APIs and serves/proxies public artifacts as appropriate. Exposing a backend SDK or JSON endpoint must not quietly replace the official agent-to-agent mechanism with a bespoke HTTP relay.

A published TypeScript SDK can run from the merchant web UI. It should be browser-targeted in v1 and make this limitation explicit. A server-only SDK that claims equivalent official browser execution is a separate future project.

## Language, validation, and database

- TypeScript across web, SDK and Hono API.
- Zod for shared runtime validation and inferred types; do not trust TypeScript types at HTTP boundaries.
- Bun for workspace/package management, tests, Hono runtime and local Next.js (`bun --bun next dev` if compatible with the pinned setup).
- PostgreSQL only. Bun's native SQL PostgreSQL client is a reasonable initial query layer; track schema changes through versioned `.sql` migrations and a migration runner. No ORM is required for the MVP unless one is demonstrably needed.
- Next.js runtime support depends on the chosen host. Verify the actual deployed runtime rather than assuming `bun install` means the platform runs Next.js under Bun.

## Security boundaries

1. Sender user approval binds recipient origin, case type, approved field names and canonical approved values/values hash to a short-lived, single transfer ID.
2. Delegated model output is untrusted. Compare it against the approved envelope; reject unexpected fields or changed values.
3. Receiver action registration and origin restrictions use upstream official action transport. Receiver still authenticates/authorizes its own write and checks CSRF where relevant.
4. Only courier API writes courier cases and signs courier receipts.
5. Ignore client claims of `accepted` without a receipt that validates against an expected receiving issuer/key and case scope.
6. Never log API keys, raw customer identifiers or unrestricted model payloads.
7. Timeouts after a potential write become `unknown` until a read-only reconciliation resolves the outcome.

## Deployment convention

For the demo, public web origins may route their own `/api` to Hono services. Serve nsDeploy files without rewriting their content and retain CSP/origin behavior required by the upstream runtime. Publish public manifests per organization. Limit keys and action permissions to the named demo counterparty.
