# 09 | Tests, acceptance criteria and release gates

## Baseline versus new target

**Baseline:** the supplied old-stack report describes six existing HTTP tests; 14 scripted browser scenarios after expansion; focused proxy and proposal-format tests; and one successful live-model test after a prompt correction. The final live run reports three real calls, one accepted case and a valid receipt.

**Target:** rerun equivalent behavior on Bun/Hono/PostgreSQL/Next.js, then public HTTPS. Existing results cannot be inherited as a new-stack pass.

## Core test matrix

| Area | Required tests | Release assertion |
| --- | --- | --- |
| DB isolation | Merchant and courier have separate credentials/databases | One org cannot query another's DB |
| Migrations | Fresh schema, repeated migration run, rollback plan | Deterministic schema setup |
| Authorization | Valid recipient, invalid Origin, unauthorized caller, CSRF, ownership checks | All unauthorized writes rejected |
| Consent | No pre-consent inference/peer contact; optional field omitted; unexpected extra fields rejected | Zero out-of-scope data transfer |
| Runtime | Official `remote_fetch` and `remote_call` and fetch-and-run-locally through public manifests | Upstream runtime remains used |
| Receiver write | First-party bridge confirmation success/cancel/refusal | Only approved write creates case |
| Idempotency | Concurrent same-ID calls; replay; same ID with altered body | Exactly one case, stable receipt or conflict |
| Unknown | Commit then dropped ACK; action timeout | No blind retry, read-only reconciliation |
| Receipt | Correct JWS/key/issuer/case/request and tampered content | Only authentic scoped receipt accepted |
| HTTP | Schema validation, errors, auth, key redaction, source origin, rate limits | Stable client error shapes |
| Persistence | Restart processes after case creation and transfer submission | Status and case retained |
| Browser | Modern Chrome, private window, fresh cache; mobile responsive | Primary flow works under supported browsers |
| HTTPS | Separate domains, CSP, cookie mode, popup, CORS, hosting | Public end-to-end passes |
| LLM | Repeat actual model requests, record model ID and outcomes | Report exact results and failure distribution |

## Proposed repeated-run criterion

Run **20 live end-to-end attempts** on the public deployment with a fixed model, fixed input fixtures and controlled consent paths. Target **at least 18/20 accepted and verified** for the standard success scenario, with **zero** unauthorized disclosures and **zero** duplicate receiver cases. This is a proposed release threshold; it has not been met or measured. Log each failure category and avoid cherry-picking reruns.

Run cancellation/refusal, altered fields, replay, unknown timeout and broken receipt as separate negative tests. The production-like customer flow should not retry after an unknown write until a read-only lookup determines whether it landed.

## Reproducible test commands (target names)

```bash
bun install
bun run typecheck
bun run lint
bun run test:unit
bun run test:api
bun run test:browser
bun run test:live     # only with explicit, authorized provider configuration
```

The scripts above are **target naming conventions**, not commands currently confirmed in the repository. Test configuration should use isolated Postgres databases and credentials. Avoid provider calls in ordinary CI by default.

## Production-like demo checklist

- [ ] Merchant website loads on public HTTPS.
- [ ] Courier website loads on a distinct public HTTPS origin.
- [ ] Both publish discoverable manifests and pinned runtime files.
- [ ] Hono deployments each reach their assigned PostgreSQL database.
- [ ] No browser-exposed API or signing secrets.
- [ ] First-party courier approval works through actual browser popup.
- [ ] Real-model `remote_call` is traceable to official runtime.
- [ ] Customer-approved data is exactly the receiver-submitted data.
- [ ] Receiver case and signed receipt survive restart.
- [ ] Duplicate requests do not create duplicate cases.
- [ ] Unknown outcomes reconcile without a second write.
- [ ] Invalid/tampered receipts are rejected.
- [ ] Teammate's UI displays accurate outcomes.
- [ ] README, one-command local setup and video instructions work from fresh clone.
- [ ] Impact metrics and success claims include denominators and limitations.

## Interpretation of '100% backend ready'

For this challenge, “ready” means **all agreed release gates pass on the chosen deployment**. It does not mean universally secure, compliant, multi-tenant, or proven at commercial scale. Record known exclusions in README.
