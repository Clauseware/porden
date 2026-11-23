# 08 | Frontend teammate handoff

## Ownership

**Frontend teammate:** Next.js apps, product landing, merchant complaint screen, accessible consent review, courier first-party action confirmation presentation, transfer timeline, receipt visual, responsive design, demo video visual polish.

**Backend owner:** Hono and PostgreSQL, official runtime/SDK integration, validation, signed receipts, origin policy, cryptographic verification and deployed service reliability.

**Shared:** contract review, browser flow acceptance, demo script, UX copy that accurately describes what a receipt proves.

## Next.js layout

- `apps/merchant-web`: primary customer experience and Porden demo.
- `apps/courier-web`: independently branded receiver site, published agent documents and first-party confirmation bridge.
- Both are separate public origins; keep the action bridge in the receiver's first-party context and load the upstream runtime assets without changes.
- Both may expose their own Hono service through same-origin `/api/*` reverse proxies, while the APIs run as separate processes.

## Minimum screens/states

1. Problem input: case type, order reference, description, optional address.
2. Exact transfer review: receiving organization, reason, and every approved field/value.
3. Delegation progress: factual state labels based on SDK events.
4. Receiver-first-party confirmation: visible courier approval for case creation.
5. Successful outcome: courier-owned case ID, receipt ID, verified indicator and explanation that the case was **accepted**, not resolved.
6. Canceled or refused outcome: clear cause, no false success state.
7. Unknown outcome: reassuring factual explanation and a status-refresh/reconciliation action; prevent accidental new submissions.

## Initial contract files backend must deliver

- `@porden/contracts` with Zod schemas and types.
- `@porden/sdk` browser API signatures and typed events (stubs are fine initially).
- Approved and declined response fixtures, verified signed receipt fixture, invalid receipt fixture, and unknown-outcome fixture.
- `.env.example` listing public website URL and same-origin API prefix, with no private keys in `NEXT_PUBLIC_*` values.
- A local startup guide using Bun.

## Integration agreement

- Frontend calls the SDK, rather than assembling custom `remote_call` requests or posting directly to courier case creation.
- Backend controls status semantics; UI labels never infer persisted acceptance from model response text.
- The customer consent checkpoint and receiver write approval are separate interactions.
- The optional address stays outside model and courier requests unless approved.
- UI can mock stable fixtures while backend migrates; switch to live SDK when local tests pass.
- Any API/schema change after signoff requires a short versioned note and updated fixture.

## Suggested content tone

Use consumer-language descriptions: “Share these details with the courier,” “Courier received your case,” “Receipt verified,” and “We are checking whether the courier received this request.” Avoid exposing CRUSE, JWS, action bridge or model traces in customer-facing text.

## Frontend acceptance

A first-time visitor can complete the primary flow without developer controls, recognize who will receive their information, understand that approval has two checkpoints, and verify the result. The experience works at mobile and desktop widths and exposes keyboard-accessible confirmation.
