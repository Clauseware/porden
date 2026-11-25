# 05 | Proposed SDK, APIs and frontend contract

**Important:** these interfaces are proposed target contracts for implementation and teammate alignment. They do **not** exist simply because they appear here. Keep official nsDeploy invocation, browser consent, and receiver action transport in the execution path.

## SDK location and packaging

Package: `packages/sdk` (`@porden/sdk` as working name). Build TypeScript browser-first ESM with an explicit public API. Do not bundle or modify upstream nsDeploy runtime unexpectedly; document how the pinned official runtime assets are loaded from each participating site.

```ts
import { createPordenClient } from '@porden/sdk';

const porden = createPordenClient({
  senderApiBaseUrl: '/api',
  runtimeAssetBaseUrl: '/agents/runtime',
});

const draft = await porden.createDraft({
  recipientOrigin: 'https://courier.example',
  caseType: 'delivery_damage',
  data: {
    orderReference: 'DEMO-1042',
    damageDescription: 'Parcel damaged in transit',
    // address excluded unless approved
  },
});

const result = await porden.transfer({
  transferId: draft.id,
  approvedFields: ['orderReference', 'damageDescription'],
  confirm: async (review) => showCustomerApprovalUI(review),
});
```

`confirm` is a UI callback supplied by the frontend. Its acceptance must produce a backend-verifiable, scoped approval. The official runtime and receiving site's independent first-party write confirmation remain active. The SDK must expose cancellation and unknown outcomes; it must not silently repair LLM-generated payloads or resubmit uncertain writes.

## Shared types

```ts
type CaseType = string;
type TransferStatus =
  | 'draft' | 'approved' | 'submitted'
  | 'accepted' | 'rejected' | 'cancelled' | 'unknown';

type TransferOutcome =
  | { status: 'accepted'; transferId: string; receipt: VerifiedReceipt }
  | { status: 'rejected'; transferId: string; reasonCode: string }
  | { status: 'cancelled'; transferId: string }
  | { status: 'unknown'; transferId: string; reasonCode: string };

type VerifiedReceipt = {
  issuer: string;
  receiptId: string;
  receiverCaseId: string;
  requestId: string;
  receivedAt: string;
  verification: 'valid';
};
```

Status names are application-level vocabulary. Map to observed official-runtime statuses and receiver-verified outcomes. Do not expose raw traces as the frontend's authoritative status field.

## Candidate Hono API endpoints

Endpoints are logical; both organizations use independent deployments. An HTTP reverse proxy may expose the API at same-origin `/api` paths.

### Sender

| Verb | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Process health |
| GET | `/ready` | DB and essential dependency readiness |
| POST | `/v1/transfers` | Validate and create sender-owned draft |
| POST | `/v1/transfers/:id/approve` | Bind customer approval to recipient, fields, payload integrity and expiry |
| GET | `/v1/transfers/:id` | Authenticated status lookup and recovery |
| POST | `/v1/transfers/:id/receipts` | Submit receiver-signed receipt for server verification and transition |

### Receiver

| Verb | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/case-types` | Advertise allowed receiver case types and schemas where appropriate |
| POST | `/v1/cases` | First-party authorized case creation through the official action bridge |
| GET | `/v1/cases/by-request/:requestId` | Authenticated read-only reconciliation with caller-origin scope |
| GET | `/.well-known/jwks.json` | Public verifier keys |
| GET | `/v1/receipts/:receiptId` | Scoped receipt lookup if genuinely needed; omit if not |

**Important:** `POST /v1/cases` must not become a general unauthenticated write shortcut. The bridge's exact caller-origin and first-party confirmation constraints must still be checked at the receiver. Browser Origin alone is not strong authorization against non-browser callers; use explicit demo partner credentials/session claims where needed and document the threat boundary.

## Suggested SDK lifecycle event names

- `draft_created`
- `recipient_discovered`
- `consent_required`
- `consent_approved`
- `delegating`
- `receiver_confirmation_required`
- `submitted`
- `receipt_verified`
- `rejected`
- `cancelled`
- `outcome_unknown`

Only emit an event when there is matching factual evidence. In particular, a model proposal is not a persisted case and an `accepted` event requires a verified receiver receipt.

## Error vocabulary

Use stable machine-readable codes, such as `INVALID_INPUT`, `CONSENT_REQUIRED`, `CONSENT_SCOPE_MISMATCH`, `RECIPIENT_NOT_ALLOWED`, `ORIGIN_NOT_ALLOWED`, `UNAUTHORIZED_ACTION`, `REQUEST_CONFLICT`, `RECEIPT_INVALID`, `RECIPIENT_UNAVAILABLE`, `OUTCOME_UNKNOWN`, and `INTERNAL_ERROR`. Specify HTTP mappings in OpenAPI/contract tests after validating the actual implementation.

## Frontend integration guarantee

- Typed SDK + fixtures must be delivered before UI work depends on backend changes.
- Preserve SDK method names and event shapes after contract freeze; changes need teammate review.
- SDK does not require frontend to know cryptographic signing internals.
- UI must show customer approval and receiver approval as distinct steps.
- On an unknown outcome, the UI should show a recoverable pending state, without automatic resubmission.

## Compatibility

Pinned official nsDeploy runtime revision in the proven source: `486ecf26aa8775963f9b765f894734bef1ac9817`. Validate this pin during migration; do not mutate vendored upstream runtime to match new APIs. The Porden SDK is an adapter around upstream contracts.
