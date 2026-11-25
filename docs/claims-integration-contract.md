# Damaged-parcel claims: frontend integration contract

This is the contract between the backend work in T1 and the merchant, courier and dashboard UIs. The frontend can be built against it without changing server code.

The damaged-parcel claim is an **integration example** of Porden:

- **Porden core is unchanged.** That covers the platform API, the handoff lifecycle, `packages/contracts/src/handoffs.ts` and `createHandoffClient`.
- **The example lives in two places:**
  - `@porden/contracts/delivery-claims`: the shared claim schema both organizations agree on;
  - the merchant and courier applications: the merchant's order facts and pricing, and the courier's claims policy.
- **Another integration can use the same pattern without changing Porden.** For example, a procurement integration would add its own parameter schema, its own policy service and its own site actions.

## 1. Roles and lifecycle

| Person | Site | Does |
|---|---|---|
| Customer | merchant `/` | Describes the damage, reviews the claim the merchant agent proposes, answers clarifications, consents to sharing |
| Courier claims staff | courier site | Runs the courier agent on a claim, reviews its proposed decision, submits it |
| Merchant approver | dashboard | Approves or rejects courier counter-offers (Porden requires a human for revisions) |

```
customer message
  → merchant agent proposes merchant_file_claim → customer reviews → handoff v1
      (merchant policy may auto-authorize: status "approved"; otherwise "draft" waits for approval)
  → courier agent reviews the server evaluation → proposes ONE allowed decision → staff reviews:
       accept   → status "accepted"
       clarify  → open clarification; customer answers via merchant agent → courier reviews again
       counter  → v2 proposed (status "awaiting_approval") → approver approves → courier reviews v2
       reject   → status "rejected"
  → execution: customer consents for the accepted version → existing transfer flow → courier case
      plus signed receipt stating the agreed resolution
  → courier agent proposes "complete" → status "completed"
```

Every decision is enforced on a server:
- Consent and pricing are enforced by the merchant API.
- Policy and counter-offer terms are enforced by the courier API.
- Versions, approvals and acceptance are enforced by the platform.

The agents only interpret intent and propose.

## 2. Shared types

Import the schemas from `@porden/contracts/delivery-claims`:

| Schema | Use |
|---|---|
| `OrderFacts` | Merchant order record (input to the merchant agent) |
| `ClaimPolicy` | Courier's published policy (input to the merchant agent, for explanation only) |
| `ClaimParameters`, `Resolution` | The negotiated object of each version |
| `ClaimView` | Merchant read model: handoff, every version's parameters, current parameters |
| `ClaimEvaluation` | Courier read model: findings and the decisions the policy allows |
| `FileClaim`, `ResolveClaimClarification`, `CourierClaimDecision` | Request bodies |

Amounts are integer minor units (cents). Currency is ISO 4217.

## 3. Merchant API (customer session; same-origin; `X-CSRF-Token` on POST)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/orders/DEMO-1042` | → `OrderFacts` |
| POST | `/api/v1/claims` | `FileClaim` → `ClaimView` (201). Normally submitted by the `merchant_file_claim` action, not by hand. |
| GET | `/api/v1/claims/:handoffId` | → `ClaimView` |
| GET | `/api/v1/claims` | → `MerchantClaimList`: the signed-in customer's claims filed on this merchant, newest first (up to 50). |
| GET | `/api/v1/claims/:handoffId/consent` | → `ClaimConsentResponse`: the exact consented `data` and `approvedFields` for sending the case, or `consent: null` once the case was sent or the claim closed. 404 if this customer did not file the claim here. |
| POST | `/api/v1/claims/:handoffId/clarifications/resolve` | `ResolveClaimClarification` → `ClaimView` |
| POST | `/api/v1/claims/:handoffId/cancel` | `{requestId, version}` → `ClaimView` |
| GET | `/api/v1/claims/operations/:requestId` | → `HandoffMutation` (read-only reconciliation) |
| GET | `/api/config` | → `PublicConfig` (model availability) |

The courier also publishes its policy at `GET {courierOrigin}/api/v1/claim-policy` (public, CORS `*`) → `ClaimPolicy`.

Customer consent rules:
- `approvedFields` must exactly equal the keys of `data`; anything else is refused with `CONSENT_SCOPE_MISMATCH`.
- `merchant_file_claim` derives `approvedFields` from the data it sends. The UI must therefore show the customer which fields will be shared before they submit.

Consent storage and the stale-filing sweep:
- The merchant stores the consented `data` and `approvedFields` before it calls the platform, keyed by the filing's `requestId`. It links them to the claim when the filing succeeds or when `GET /api/v1/claims/operations/:requestId` reconciles it. A failed or uncertain filing keeps its consent; it is never deleted on an error.
- A filing left unlinked for more than 10 minutes is settled by a sweep: linked if the platform created a claim from this consent, deleted if the platform has no record of it, kept while the platform can't be reached. An exact replay restarts the 10 minutes, so a sweep can't remove a filing whose replay is in flight.
- **Limitation:** the sweep runs only when `GET /api/v1/claims` (the "Your claims" page) is loaded, up to 20 filings per run. Until then an unlinked filing's consented details stay in the merchant database. With the single demo customer any visit to "Your claims" covers every filing; a deployment with real customers needs the sweep on a server timer (deferred).

## 4. Courier API (courier staff session; same-origin; `X-CSRF-Token` on POST)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/v1/claims/:handoffId/evaluation` | → `ClaimEvaluation` for the current version |
| POST | `/api/v1/claims/:handoffId/decisions` | `CourierClaimDecision` → `HandoffMutation`. Normally submitted by the `courier_claim_decision` action. |
| GET | `/api/v1/claims/operations/:requestId` | → `HandoffMutation` (read-only reconciliation) |
| GET | `/api/config` | → `PublicConfig` (the courier now has its own model route) |

| GET | `/api/v1/claims?status=&page=&limit=` | → `ClaimInbox`: received claims with `stage` (`review`, `waiting_for_customer`, `waiting_for_merchant_approval`, `waiting_for_execution`, `execution_unresolved`, `ready_to_complete`, `closed`) and `current` parameters. `limit` ≤ 50. `items` holds claims only; `scanned` and `totalReceived` count all received handoffs. |
| POST | `/api/v1/claims/:handoffId/executions/recover` | `{}` → `ExecutionRecovery`. Settles executions left `reserved` by an interrupted write from what the courier database committed (`completed` with the case ID, or `failed`). Never writes a case; idempotent. Show it when `stage === 'execution_unresolved'`. |

Use `stage` to choose the courier's next action:

| Stage | Courier action |
|---|---|
| `review` | Run the courier agent (`review_claim`) |
| `waiting_for_customer` | Wait for the customer's answer |
| `waiting_for_merchant_approval` | Wait for the merchant approver |
| `waiting_for_execution` | Wait for the merchant's transfer |
| `execution_unresolved` | "Recover execution" button |
| `ready_to_complete` | Run the courier agent (`complete_claim`) |
| `closed` | Read-only |

## 5. Dashboard (merchant approver, existing platform session)

Counter-offers arrive as pending revisions. They appear in the existing `listPendingApprovals()`. The decision uses the existing `decideRevision(handoffId, revisionId, {version, decision})`.

The dashboard should show a v1 → v2 comparison. Read the parameters with the merchant's `GET /api/v1/claims/:handoffId` or by parsing terms, and show:
- the remedy and amount before and after;
- the courier's `reason` (the revision `reason`).

## 5a. Typed client (`apps/claims-client.ts`)

`createMerchantClaimsClient()` provides:
- `order`, `courierPolicy`, `file`, `claim`, `answerClarification`, `cancel`, `operation`.

`createCourierClaimsClient()` provides:
- `inbox`, `evaluation`, `decide`, `recoverExecutions`, `operation`.

Behaviour:
- Responses are parsed with the shared Zod schemas, and errors are `PordenError(code, status, requestId)`.
- A write that fails in transit or with a 5xx error becomes `OUTCOME_UNKNOWN`. Reconcile it with `operation(requestId)`; never resubmit automatically.
- `courierPolicy` is a public cross-origin read **without credentials**. A credentialed request is blocked by the browser, because the policy uses wildcard CORS. The browser test verifies this.

## 5b. Public receipt verifier (both sites)

`POST /api/v1/receipts/verify` takes `{ receipt }` (≤ 16,384 characters) and returns `ReceiptVerification` (`@porden/contracts`).

**Access:** no session, no CSRF token and no cookies. CORS is `*`, so another site, or a judge's page, can call it.

**What it accepts:**
- platform **handoff receipts**: `kind: 'handoff'`, issuer = this site's Porden platform;
- courier **case receipts**: `kind: 'delivery_case'`, issuer = the courier site.

**How it decides:**
- It trusts only issuers this site already knows: itself, its partner and its platform. A receipt naming any other issuer gets `UNTRUSTED_ISSUER`, and no keys are fetched.
- It never writes anything.

**Responses:**
- **Valid:** `{ valid: true, issuer, keyId, receipt: { kind, claims } }`.
  - Case receipts include `resolution` and `governance { handoffId, version }`.
  - Handoff receipts include `action`, `version`, `termsSha256`, `occurredAt` and `event`.
- **Invalid:** `{ valid: false, reasonCode }`, a definite verdict. The codes are `MALFORMED`, `UNSUPPORTED_TYPE`, `UNTRUSTED_ISSUER`, `SIGNATURE_INVALID` and `CLAIMS_INVALID`.
- **502 `VERIFICATION_UNAVAILABLE`:** the issuer's keys could not be reached. **Show "not checked", never "invalid".**

**Abuse limits and key handling:**
- **Size:** requests are capped at 64 KB, and the `receipt` field at 16,384 characters.
- **Rate:** **30 checks per client and 600 in total per minute per API process**. Beyond that the endpoint returns `429 RATE_LIMITED` with `Retry-After`. The UI should show "Too many checks; try again in N seconds".
- **Key fetches:**
  - Issuer keys are fetched with a 5-second timeout and no redirects.
  - They are cached for 5 minutes.
  - An unknown key ID forces at most one refresh every 30 seconds.
- **Key rotation:** each site publishes retired public keys next to its current key, so receipts signed before a rotation stay valid. See the runbook, `infra/standalone/README.md`.

**Client:** `verifyReceipt(receipt, siteOrigin?)` in `apps/claims-client.ts`.

**Plain-language meaning to show next to a valid result:**
- **Case receipt:** "The courier signed that it accepted case `caseId` into its system on `receivedAt`, for handoff version `version`, with the agreed resolution."
- **Handoff receipt:** "Porden recorded `action` on version `version` at `occurredAt`."
- Always add: **"A receipt proves the issuer recorded this. It does not prove the claim was paid, resolved, or that the damage happened."**

## 6. Running the agents (`apps/claims-agent.ts`)

```ts
import { proposeClaimAction, submitClaimProposal } from '../claims-agent';
// Engine set up exactly like packages/sdk/src/delivery.ts:
const engine = new Engine({ originUrl: location.origin, byokKey: 'server-openrouter',
  routerOverride: new URL('/api/llm', location.origin).href, modelOverride: config.openrouterModel });
engine.onActionConfirm = (items) => reviewActions(items, 'Review before sending');  // the person decides
const turn = await proposeClaimAction(engine, actionBindings, task);
if (turn.kind === 'proposal') {
  // Show turn.text and turn.arguments, then:
  const outcome = await submitClaimProposal(engine, turn);
}
```

Task inputs (`ClaimTask`). The page supplies the facts; the model never fetches them:

| Site | Task | Input the page must load first |
|---|---|---|
| merchant | `file_claim` | `customerMessage`, `order` (GET orders), `courierPolicy` (GET courier claim-policy) |
| merchant | `answer_clarification` | `customerMessage`, `handoffId`, `version`, `clarification {id, missingInformation, reason}` from `ClaimView.handoff.clarifications` |
| courier | `review_claim` | `handoffId`, `version`, `status`, `evaluation` (GET evaluation), optional `staffNote` |
| courier | `complete_claim` | `handoffId`, `version` (after the case exists) |

`proposeClaimAction` returns one of:
- `proposal`: exactly one action, for this task's action, and for the right handoff and version;
- `none`: the agent asked a question in `text`; show it and let the person reply;
- `invalid`: show "The assistant could not prepare a valid action", and offer to try again.

`submitClaimProposal` returns one of:

| Status | Meaning | UI |
|---|---|---|
| `succeeded` | `result` is a `ClaimView` (merchant) or `HandoffMutation` (courier) | Refresh |
| `refused` | `code` is a server error code, e.g. `POLICY_VIOLATION`, `STALE_VERSION`, `CONSENT_SCOPE_MISMATCH` | Show the message; nothing changed |
| `unknown` | Outcome uncertain | Disable new writes; call `GET /api/v1/claims/operations/{operationId}`; **never resubmit automatically** |
| `cancelled` | The person declined in the review dialog | Nothing changed |

## 7. Execution after acceptance (existing flow, unchanged)

When `handoff.status === 'accepted'`:

1. `POST /api/v1/transfers` with `{recipientOrigin, caseType: 'delivery_damage', data, governance: {handoffId, version: handoff.currentVersion}}`.
   - `data` must be the same consented data as the claim, or the server returns `SCOPE_MISMATCH`.
2. `createPordenClient(...).transfer({transferId, approvedFields, confirm})`. This is the existing SDK flow: the courier agent through the bridge, `create_damage_case`, then the signed receipt.
3. The receipt now carries `resolution`. The merchant verifies it against the accepted version (`RECEIPT_INVALID` if it differs). Show it as "Courier confirmed: partial refund of 50.00 USD".
4. Run the courier agent with `complete_claim`. The status becomes `completed`.

A counter-offer creates a new version. Consent for execution must therefore be given for the accepted version. That is a new transfer draft with the new `version`.

## 8. Plain-language copy

| Code / state | Show |
|---|---|
| `WITHIN_POLICY` | "Within the courier's claims policy." |
| `PHOTO_REQUIRED` | "The courier needs a photo of the damage for refunds above 25.00 USD." |
| `REFUND_EXCEEDS_COVER` | "The request is above the courier's cover for this parcel." |
| `RESHIP_NOT_AVAILABLE` | "The courier can't reship this kind of item." |
| `CURRENCY_NOT_SUPPORTED` | "The courier only handles claims in USD." |
| status `approved` | "Waiting for the courier" |
| status `awaiting_approval` | "The courier made a counter-offer: needs your approval" |
| status `accepted` | "Courier accepted. Ready to send the case." |
| status `completed` | "Done. Signed receipt verified." |
| `POLICY_VIOLATION` | "That decision isn't allowed by the courier's policy. Nothing was changed." |

Do not show internal IDs, hashes or the "Claim parameters (canonical)" constraint line to customers.

## 9. Required states (accessibility)

Make these states explicit and announced (`aria-live`):
- loading;
- waiting for review;
- needs approval;
- clarification requested;
- counter-offer;
- refused;
- unknown → checking;
- cancelled;
- completed;
- error.

## 9a. Verified in a real browser (`bun run test:claims:browser`)

These scenarios run with the real Next.js sites, the official runtime and action bridge, this runner and client, and the SDK `transfer()` flow. Inference is scripted. Run it with `bun run test:claims:browser`.

- Routine filing, acceptance, transfer through the bridge popup, receipt resolution and completion.
- Counter-offer v2, with consent for the stale v1 refused.
- A clarification answered by the merchant agent.
- Adversarial courier and merchant models.
- Cross-site boundaries.
- A lost courier response reconciled without a second write.
- Receipt verification from the browser, same-origin and cross-origin, with tampering detected (B8).

## 9b. Frontend checklist

Each item names the backend it uses. Check items off as screens land.

**Merchant site (customer)**
- [ ] Claim chat: `file_claim` agent turn → runtime review dialog shows the fields to be shared → submit (§6). Handle `none`, `invalid`, `refused`, `unknown` and `cancelled`.
- [ ] Claim status page: `GET /api/v1/claims/:id` (`ClaimView`), with versions, the current resolution and the plain-language status (§8).
- [ ] Clarification answer: the `answer_clarification` agent turn (§6).
- [ ] Execution: transfer for the **accepted** version through the SDK `transfer()` (§7). The bridge popup and the uncertain → `reconcile` path are **T3**.
- [ ] Receipt panel: show the courier receipt and verify it with `verifyReceipt` (§5b).

**Courier site (claims staff)**
- [ ] Claims inbox: `GET /api/v1/claims`, grouped by `stage` (§4).
- [ ] Claim review: show the `evaluation` findings, run the `review_claim` agent, then review the dialog and submit (§6).
- [ ] "Recover execution" button when `stage === 'execution_unresolved'` (§4, **T3**).
- [ ] Complete: run the `complete_claim` agent when `stage === 'ready_to_complete'`.

**Dashboard (merchant approver)**
- [ ] Counter-offer approval with a v1 → v2 comparison and the courier's reason (§5).

**Shared**
- [ ] Negotiation timeline: versions, who proposed what, approvals, acceptance and receipts, each with a "verified" badge from §5b.
- [ ] **T2 "Try a bypass" panel.** One-click attempts using existing endpoints, each showing the server's refusal:
  - an out-of-policy courier decision → `POLICY_VIOLATION`;
  - executing a stale version → `REQUEST_CONFLICT` or `STALE_VERSION`;
  - altered case data → `SCOPE_MISMATCH`;
  - a forged receipt → verifier `SIGNATURE_INVALID`;
  - a duplicate request → the same receipt returned.
- [ ] **T3 unknown-outcome UI:** after `unknown`, disable new writes, show "checking", call the read-only `operation`, `reconcile` or `recoverExecutions` path, then show the settled result.
- [ ] **Standalone receipt verifier page (judges):** paste box → `verifyReceipt` → valid/invalid with the issuer, the claims in plain language and the limitation sentence (§5b). Treat `VERIFICATION_UNAVAILABLE` as "not checked". No sign-in required.
- [ ] **D2 scripted demo mode:** clearly labelled ("Demo: scripted AI, no model calls") for judging when the free model quota is exhausted.
- [ ] Accessible, announced states (§9) and the plain-language copy (§8). Never show hashes or internal IDs to customers.

## 10. Not provided by the backend

- Photo upload. A clarification answer is text; the policy treats any answered `photo_of_damage` clarification as "photo received".
- Visitor BYOK (T7).
- Merchant approver UI changes beyond the existing dashboard decision.
