# Porden platform

The central Porden API is in `apps/api/src/platform-*`, its typed contracts and SDK are in the existing packages, and the dashboard is `apps/dashboard-web`. The merchant and courier applications keep their original nsDeploy delivery demo at `/` and independently consume the central platform at `/tasks`.

## Local setup

Use the existing local PostgreSQL Compose service (`infra/postgres/compose.yml`). From the repository root:

```powershell
bun install --frozen-lockfile
bun run setup:platform:demo
```

Setup creates a separate `porden_platform` database and restricted login role on the documented local PostgreSQL server, applies both platform migrations, generates an ES256 key and session secret, and provisions Company A and Company B. It preserves the merchant/courier databases. It refuses to overwrite an existing platform configuration or role. `PORDEN_DEMO_ADMIN_DATABASE_URL` can override the local administrator connection; the setup script refuses remote hosts.

Private configuration is saved in `apps/api/.env.platform`, and local account credentials and organization IDs in `tmp/platform-demo/accounts.json`. Both locations are ignored by Git. Do not publish these files. The setup script does not print credentials. This setup has already been run in the current workspace.

Run these commands in separate terminals:

```powershell
bun run dev:platform
bun run dev:dashboard
bun run dev:merchant
bun run dev:courier
```

| Surface | URL | Local account |
|---|---|---|
| Company A consumer | http://localhost:4100/tasks | `a.member` |
| Company B consumer | http://localhost:4200/tasks | `b.member` |
| Porden dashboard | http://localhost:4300 | `a.approver` or `b.approver` |
| Central API | http://127.0.0.1:5300/api/v2 | Integration Bearer token or human session |

Use each local identity in a separate browser profile/context. Cookies are shared across ports on the same hostname, so signing into another account in the same browser changes that browser's identity. Both UIs detect changed accounts, clear private data, and require sign-in again. A deployed installation should give the independent applications their own hostnames. Each app proxies `/api/v2` to the central service so browser sessions use first-party cookies. `PORDEN_API_INTERNAL_ORIGIN` configures the upstream at build time; it contains no API credential.

## Demo

1. Company A creates a task for Company B with goal, constraints, acceptance criteria, a USD 500 budget and optional structured context. Demo setup configures both companies for automatic authorization of valid initial handoffs. Evidence references are stored without fetching their URLs.
2. If the sender organization's `humanApprovalRequired` policy is true, version 1 remains a draft until an `a.approver` human reviews and approves its exact terms in the dashboard. If false, the API records version 1 as approved at creation. Client text cannot change this policy or claim an approval.
3. Company B accepts the exact approved version in either policy mode. Its consumer polls the API for server-calculated authorization; acceptance remains necessary before execution or completion.
4. Company B proposes USD 550 and a reason. The original USD 500 terms and authorization remain recorded. Authorization is blocked while the revision is pending.
5. The Company A human reviews original and proposed versions and their evidence in the dashboard, then approves or rejects the exact revision. Concurrent or stale decisions cannot decide another version.
6. After approval, Company B must accept version 2 before its completion endpoint becomes available. Rejection leaves the original approved terms intact and the rejected version ineligible. The consumer's three-second polling observes the decision.
7. Company B records completion, then uses **Send linked return**. This creates a separate B-to-A handoff with its own versions, approval and receipts. A `b.approver` human authorizes that handoff, and Company A accepts it. The dashboard links both steps in chronological workflow history.

The consumer includes a budget revision form for the example; the SDK accepts changes to the complete structured task terms and context. Any changed terms leave the exact previously authorized scope and enter human review. Rejection retains the original approved version. Workflow grouping does not run agents or schedule work. SDK clients can link a new handoff to any visible predecessor with the same participants; each step retains its own versioned context in the shared workflow history. The demo's return button appears after completion for clarity.

## Identity and persistence

Organizations and principals are provisioned by the operator, never claimed in a handoff payload. Each organization has a server-side `humanApprovalRequired` policy (default `true` for migrated and manually provisioned organizations). Set it to `false` to automatically authorize valid new handoffs. For an existing organization, an operator updates this value in the private platform database; no client field or dashboard prose can change it. Only a sender-side human approver can approve drafts when policy requires it or decide out-of-scope revisions. Membership, active status, role and policy are read from the database on every relevant request. Integration principals cannot hold the approver role. Approval eligibility comes from persisted version, revision, status and signed-receipt records, never from agent-generated context prose.

Human passwords use Bun's password hashing. Integration tokens and opaque, expiring session tokens are stored as SHA-256 digests. Human sessions use HttpOnly, SameSite=Lax cookies (Secure under HTTPS); writes require an allowed exact Origin and a token-bound CSRF value. Machine integrations use Bearer tokens and cannot approve human decisions. Browser origins are allowlisted for credentialed CORS.

For manual provisioning, configure `apps/api/.env.platform` using its example, run `bun run db:migrate:platform`, then set `PORDEN_PROVISION_FILE` to a private JSON file and run `bun run platform:provision`. The file has `organizations: [{id, name, humanApprovalRequired?}]` and `principals: [{id, organizationId, name, login, kind, role, secret}]`. Omitted policy defaults to human approval required; use `false` for automatic authorization of valid creates. IDs must be UUIDs and secrets at least 16 characters. Provisioning only inserts; duplicate identities fail rather than changing existing accounts. Restrict access to this file and remove it securely according to your deployment's credential handling. To revoke access, the operator sets a principal's `active` field to zero. There are no public account-management or role-assignment endpoints in this MVP.

Migrations use a separate platform journal and schema definitions. Existing merchant/courier migrations and their checksum/adoption protections remain intact. New handoff records store immutable task versions, structured context, revisions, membership-derived actors and signed receipts. Context is stored with the versioned terms and included in its hash and SDK readback. Evidence references are bounded text and HTTP(S) source references; Porden does not search or fact-check them. Transactional locks serialize changes to a handoff. Each mutation uses a caller-scoped UUID request ID and fingerprint; the exact same request returns the same persisted signed receipt. Reusing a key with changed terms, context or evidence returns a conflict. State updates and receipt creation commit together.

The central database is private to Porden; external organizations access the API rather than receiving its database credentials. Local setup revokes public database connections. Cross-organization API queries return 404 for invisible handoffs, workflows and decisions.

## API and SDK

`createHandoffClient` is exported by `@porden/sdk`. The existing `createPordenClient` and official nsDeploy adapter retain their behavior.

```typescript
import { createHandoffClient } from '@porden/sdk';

// Server-side integration: keep this token out of browser bundles.
const porden = createHandoffClient({
  baseUrl: 'https://porden.example/api/v2',
  token: process.env.PORDEN_INTEGRATION_TOKEN,
});
const requestId = crypto.randomUUID(); // Persist before sending; reuse for an identical explicit retry.
const created = await porden.createHandoff({
  requestId,
  receiverOrganizationId,
  terms: {
    goal: 'Purchase replacement supplies',
    constraints: ['Do not exceed the authorized budget'],
    acceptanceCriteria: ['Provide a purchase receipt'],
    budget: { amountMinor: 50000, currency: 'USD' },
    completedWork: ['Supplier quote recorded'],
    remainingWork: ['Purchase and inspect supplies'],
    openQuestions: ['Confirm stock'],
    nextStep: 'Wait for supplier confirmation',
    evidence: [{ claim: 'Supplier offers replacements', sourceUrl: 'https://example.com/supplies' }],
  },
});
// Poll the authorized state; do not execute changed terms under an older authorization.
const scope = await porden.getAuthorization(created.handoff.id, 1);
```

Money is expressed as integer minor units, not floating point totals. Terms and structured context are validated at typed route boundaries. Context fields are optional for compatibility. Evidence supports the current `claim`/nested `source` shape and the optional `claim`, `sourceUrl`, `excerpt` shape; it is capped at 20 references (claim 1,000 characters, URL 2,048, locator 500, excerpt 4,000). Every API request body is capped at 64 KiB. The dashboard renders excerpts as text, labels them provided evidence and opens HTTP(S) sources only on an explicit click.

| SDK method | API operation |
|---|---|
| `signIn`, `session`, `signOut` | `POST/GET /session`, `POST /logout` |
| `organizations` | `GET /organizations` |
| `createHandoff`, `listHandoffs`, `getHandoff` | `POST/GET /handoffs`, `GET /handoffs/:id` |
| `approveHandoff` | `POST /handoffs/:id/approve` (sender human approver) |
| `acceptHandoff`, `rejectHandoff` | `POST /handoffs/:id/accept`, `/reject` (receiver) |
| `cancelHandoff` | `POST /handoffs/:id/cancel` (sender) |
| `proposeRevision` | `POST /handoffs/:id/revisions` (receiver) |
| `decideRevision` | `POST /handoffs/:id/revisions/:revisionId/decision` (sender human approver) |
| `finishHandoff` | `POST /handoffs/:id/finish` (receiver, accepted exact version) |
| `getAuthorization` | `GET /handoffs/:id/authorization?version=N` |
| `listPendingApprovals` | `GET /approvals` (authorized sender human) |
| `getWorkflowHistory` | `GET /workflows/:id` |
| `reconcileOperation` | `GET /operations/:requestId` (same principal that issued the operation) |

Lists support validated status/direction filters and page/limit pagination. A continuation specifies `previousHandoffId` and optionally the same `workflowId`; existing workflow IDs cannot be reused as unrelated roots. New caller-chosen workflow IDs are serialized to prevent concurrent roots with conflicting participants.

Lifecycle uses the existing meanings of `draft`, `approved`, `accepted`, `rejected` and `cancelled`, adding `awaiting_approval`, `completed` and `failed` for versioned tasks. Original demo transport states `submitted`/`unknown` remain unchanged. In the central SDK, transport uncertainty is represented by `HandoffWriteUnknown` with an `operationId`, separately from the authoritative handoff's state. There is no second competing transport state stored on the handoff.

All mutations require `requestId`; versioned transitions require `version`, and revision decisions require the revision ID plus its proposed version. Receipt claims include actor/integration identity, organization, operation ID, action, time, exact version and terms digest. ES256 signatures use `porden-handoff-receipt+jwt` and the central service's public `/.well-known/jwks.json`. Use a trusted issuer/key source when independently verifying a receipt; a digest or source URL alone does not prove approval or truth.

The SDK never retries writes automatically. A network failure, server failure or malformed successful acknowledgement leaves the operation unknown. Both UIs save its UUID before sending, preserve it across reloads in principal-scoped session storage, block new writes, and expose **Check operation receipt**. A 404 during reconciliation does not prove that an in-flight write failed; it remains unknown and should be checked again. An explicit retry by an integration must use the same principal, UUID and exact payload. Reads and polling do not create receipts or resubmit actions.

## Verification and release boundary

```powershell
bun run format
bun run check:apps
bun run test:unit
$env:PORDEN_TEST_DATABASE_URL='postgres://porden_admin:local-admin-only@127.0.0.1:54329/porden_test'
bun run test:api
bun run build:dashboard
bun run build:merchant
bun run build:courier
# Set HANDOFF_PLAYWRIGHT_MODULE / HANDOFF_CHROME to the existing installations if needed.
bun run test:platform:browser
bun run test:porden:browser
```

API and browser suites create unique schemas in disposable databases and clean them up. The central browser suite starts all three production Next.js apps plus Hono on ports 4100/4200/4300/5300, so those ports must be free. The original nsDeploy browser suite separately uses ports 4100/4200/5100/5200; run the two browser suites sequentially. Reports and screenshots are under timestamped `tmp/platform-browser-proof` and `tmp/porden-browser-proof` directories.

The central task demo uses no LLM and performs no external purchase. The original nsDeploy regression uses the real pinned runtime with explicitly scripted inference. Public HTTPS deployment, deployed CORS/session behavior, deployed database permissions and real-model completion require deployment-specific configuration and verification. No deployment is performed by these scripts. Porden controls authorization at its API boundary; it cannot physically stop external tools that bypass Porden or certify that supplied evidence is factually true.
