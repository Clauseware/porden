# Official-runtime integration: investigation and results

## Claim workflow verification: 2026-11-25

The damaged-parcel claim workflow adds agent negotiation on top of the platform: the merchant agent files a claim, the courier agent proposes one policy decision, counter-offers become new versions that a human approves, and the case write is bound to the accepted version.

| Check | Observed outcome |
| --- | --- |
| `bun run test:unit` | **80 passed, 0 failed** |
| `bun run test:api` | **90 passed, 0 failed**, including the claim negotiation, governed delivery and receipt verification suites |
| `bun run test:claims:browser` | **9 passed, 0 failed** with scripted model responses: routine claim, counter-offer, clarification, adversarial courier and merchant models, cross-site boundaries and a lost courier response reconciled without a second write |
| Real-model evaluation (`bun run test:claims:live`) | **17 of 20** runs reached the expected outcome with `nvidia/nemotron-3.5-super-vl:free`. The other 3 failed with provider `502 PROVIDER_UNAVAILABLE` and are recorded as failures. |
| Real-model safety counts | Courier decisions within policy: 25 of 25. Server policy refusals, duplicate executions and unauthorized writes: 0. |

Limits of this evidence:

- The real-model evaluation runs the nsDeploy engine, site actions, model routes and services under Bun. It does not exercise the browser UI, the action-bridge popup or cross-site peer loading, and its human approvals are scripted.
- One complete claim has been run through the browser UI with a real model, on local dev servers (see below). Repeated-run reliability in the browser is unmeasured.
- The 20 runs were made in two sessions. Eleven runs in the first session were rate-limited by the provider and were re-run the next day; the original files were kept.
- Photo evidence is text supplied by the customer. An answered clarification counts as a received photo.
- Nothing is deployed. Public HTTPS behaviour remains unverified.

Evidence is under `tmp/porden-claims-browser/` and `tmp/porden-claims-eval/`, which Git ignores.

### One real-model claim through the browser UI: 2026-11-25

Run by hand on the local setup in [docs/WORKSPACE.md](docs/WORKSPACE.md#claim-workflow-setup), with all six dev processes and the configured model route. Model calls were not scripted: the organization APIs logged 15 model requests, all answered, one of them by the fallback provider.

| Step | Observed |
| --- | --- |
| Customer message asks for a full refund and says the address must not be shared | The merchant agent proposed a full-refund claim without the address. Version 1 was created for 80.00 USD. |
| Courier agent, first run | Proposed `clarify` (photo required), the only non-reject decision the policy allowed. |
| Customer answer | Sent through the merchant agent. |
| Courier agent, second run | Proposed `counter` with a partial refund. The server built version 2 at 50.00 USD. |
| Dashboard | The merchant approver reviewed version 1 against version 2 and approved version 2. |
| Courier agent, third run | Proposed `accept` for version 2. |
| Send case | The merchant agent delegated to the courier network, the courier confirmed in its own pop-up window, and the merchant showed "Courier confirmed: partial refund of 50.00 USD" with the signature checked. |
| Courier agent, fourth run | Proposed `complete`. The merchant page showed the claim as completed. |

Two model errors occurred, and neither produced a wrong write:

- The merchant agent set `photoProvided` to false although the customer's message said a photo existed. The claim went through a clarification it did not need.
- The first attempt to send the case failed with "The courier did not return a valid proposal". No case was written, and a second attempt succeeded.

This run was driven through browser automation. The negotiation and dashboard steps ran in one browser and the pop-up step in headless Chromium, because the first browser could not open a pop-up window.

## Error boundaries and quality tooling follow-up

Implemented consistent safe API error envelopes with diagnostic request IDs, provider/network/status classification, SDK transport and schema-error normalization, Next.js page/root render-error screens, and controlled process lifecycle errors. Sanitized diagnostic tests verify that private error messages and SQL/provider payloads do not reach responses or logs. Provider streaming failures terminate the stream after headers; they cannot retroactively become a JSON error response. No automatic write retries or successful defaults were introduced.

Oxlint 1.86.0 and Oxfmt 0.71.0 are installed and locked. `bun run check:apps` passes with zero lint warnings, clean formatting and strict TypeScript checking. Formatting is scoped to `apps/` and excludes generated Next.js files, Drizzle snapshots/migrations and historical SQL. Source findings were corrected rather than suppressed. `AGENTS.md` documents the requirement; the added GitHub Actions workflow runs the same command but has not been executed remotely.

Focused regression: **23 unit tests passed**, **six PostgreSQL integration tests passed**, **13 browser scenarios passed**, and **both Next.js production builds passed**. Added browser scenarios cover malformed configuration responses, safe provider errors and expired-session recovery without losing case details. Final browser evidence: `tmp/porden-browser-proof/2026-11-23T13-49-00-325Z/results.json`. Earlier end-to-end evidence and outstanding public/live-model limitations are retained below.

## New-stack verification — 2026-11-23

The Bun/Hono/Drizzle/PostgreSQL implementation now runs through both production-built Next.js apps in real Chromium. The test harness uses the actual `@porden/sdk`, official nsDeploy Engine/action bridge, two Hono HTTP listeners, and independently authenticated `porden_merchant` / `porden_courier` database connections. Only inference is scripted in the deterministic suite. Each run creates and removes its own schema in both organization databases; migrations and application records outside those schemas are preserved.

| Check | Observed outcome |
| --- | --- |
| Final new-stack browser matrix | **12 passed, 0 failed**; success (with/without approved address), customer cancellation, merchant-review cancellation, courier refusal, changed delegation/proposal/write data, broken receipt, dropped acknowledgement, receipt screen and database isolation |
| Repeated scripted success flow | **20/20** accepted transfers with verified receipts and exactly one case per attempt |
| Concurrent duplicate requests | **20** simultaneous requests produce one case and the same signed receipt; altered payload or new request ID for the same transfer conflicts |
| PostgreSQL integration suite | **6 passed**: migration adoption, concurrency/idempotency, invalid states, transaction rollback, reconciliation and consent validation |
| Unit suite | **14 passed**: request contracts, cryptography, origin/session/CSRF, provider failure, SDK cancellation and missing-model fail-fast behavior |
| Prototype regression | **6 HTTP + 2 config/prompt tests passed** |
| TypeScript and frontend builds | Strict typecheck and both Next.js production builds passed |
| Dependency lock | Frozen offline install passed; no dependency added for this task |
| Organization permissions | Both roles can use their own database; connecting to the other database and assuming the other role are rejected with PostgreSQL `42501` |
| Real-model new-stack transfer | Attempted with the configured free model; **failed before action approval**, with provider request reported as `502 PROVIDER_UNAVAILABLE`. No live reliability pass is claimed. |
| Public HTTPS origins | Not supplied/deployed; unverified |

The 20-success loop was part of an earlier 29-scenario run that also exposed two negative-test failures. Those failures were investigated rather than counted as passes. One was a scripted-model fixture parsing an official tool error as JSON; the other exposed the need to reject changed proposal arguments before entering submitted state. The rebuilt final 12-scenario matrix passes after both fixes. All results remain in the evidence directories.

Reproduced application defects corrected:

- **JSONB double encoding:** Drizzle serializes JSON, while prepared parameters on installed Bun 1.4.3 encode JSON strings again. Connections used by Drizzle now set `prepare:false`; database assertions require actual JSON objects.
- **Changed proposal arguments:** the SDK now compares the proposed action arguments to the approved envelope before posting `/submit`; final prepared-action checking remains at the existing confirmation boundary.
- **Provider network errors:** the inference endpoint returns stable `502 PROVIDER_UNAVAILABLE` rather than an unclassified internal error. It does not retry or expose credentials.

Courier refusal remains the official runtime's conservative `unknown` outcome. When the runtime explicitly reports that the user declined, the SDK supplies `RECEIVER_DECLINED` for truthful refusal copy. Recovery is read-only at the receiver; dropped-ack and altered-receipt scenarios each assert a single receiver write and a single case. Unknown outcomes disable a new UI submission.

Final browser evidence: `tmp/porden-browser-proof/2026-11-23T13-26-16-652Z/` (`results.json`, per-attempt traces, merchant/courier desktop and mobile screenshots). The earlier 20-success loop is retained in `tmp/porden-browser-proof/results.json`. Latest real-model failure evidence: `tmp/porden-live-proof/2026-11-23T13-28-09-871Z/` (`results.json`, `failure-1.json`, screenshot). These traces contain synthetic approved data and temporary consent tokens. Runtime source, historical migrations, `.env`, prototype data and prototype signing material were not edited. No commit or deployment occurred.

The following sections record the original prototype evidence; they must not be treated as new-stack live-model or public-HTTPS passes.

Date: 2026-11-23. Environment: Windows, Node v24.21.0, Python 3.15, Chromium 141.0.7390.37, JavaScript Playwright 1.62.1.

## Investigation checkpoint

The integration approach was explained before implementation and approved by the user. The official checkout became available at `vendor/nsdeploy`, revision `486ecf26aa8775963f9b765f894734bef1ac9817`. The checkout was inspected locally; no upstream source was edited.

The official Python distribution is `nsdeploy` 0.1.0 (`vendor/nsdeploy/pyproject.toml`). Its browser runtime consists of dependency-free ES modules, which can run under the existing Node application without installing the Python build/hosting dependencies. The application therefore publishes the resolved data artifacts directly and serves the upstream browser files in place. It does not claim that its files were produced by the Python generator.

Source boundaries inspected:

- `vendor/nsdeploy/nsdeploy/runtime/engine.js`: `Engine.loadTop()`, `runTurn()`, consent hooks, `resolveRemote()`, `Session.invoke()`, retained action presentations and `submitActions()`.
- `vendor/nsdeploy/nsdeploy/runtime/runner.js`: linked-network tools, consent before peer fetch, official agent loop, propagation of validated child proposals.
- `vendor/nsdeploy/nsdeploy/runtime/action-transport.js`: `loadActionModule()`, remote catalog discovery, `ActionBridgeClient`, first-party review and `serveActionBridge()`.
- `vendor/nsdeploy/nsdeploy/runtime/actions.js`: action registration, schema validation, argument preparation, duplicate submissions and unknown-outcome classification.
- `vendor/nsdeploy/nsdeploy/generate.py`: manifest, linking and MCP metadata formats, CRUSE configuration and action-bridge assets.
- `vendor/nsdeploy/examples/link_demo_travel_agency.hocon`: published network delegation example. Its fabricated airline fallback was not adopted.

The official [MVP Profile 0.3 specification](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md) permits resolved JSON as HOCON serialization and describes consented peer loading and execution in the caller's browser. Cross-site action transport is outside the minimum profile; this proof uses nsDeploy's reference action transport. The [action documentation](https://github.com/cognizant-ai-lab/nsdeploy/blob/main/docs/actions.md) defines `registerActions(actions)`, `effect: write`, `availability: bridge`, exact caller origins, stable request IDs and first-party confirmation.

No speculative interoperability API or replacement custom transport was added.

## Files changed

| File | Purpose |
| --- | --- |
| `server.mjs` | Serve official runtime modules and both networks' discovery artifacts; courier-owned caller policy and official bridge route |
| `public/merchant/merchant.network.json` | Merchant agent, CRUSE and courier link slot |
| `public/courier/courier.network.json` | Independently published courier agent and action-proposal instructions |
| `public/merchant/index.html` | Browser BYOK settings and recipient label, retaining existing form and receipt UI |
| `public/merchant/merchant.js` | Official agent invocation and action submission, exact field consent checks and receipt verification |
| `public/courier/action-bridge.html` | First-party page loading the upstream bridge module |
| `public/courier/actions.js` | Runtime action registration, server-owned caller origins and stable request-ID mapping |
| `tests/test_runtime.mjs` | Real browser integration scenarios with scripted inference |
| `tests/test_handoff.py` | Existing pytest entry point delegates to the new browser scenarios |
| `package.json` | Browser-test command |
| `.gitignore` | Ignore runtime checkout, scratch evidence and local test dependencies |
| `README.md`, `PROOF_RESULTS.md` | Current setup, execution path, validation and limitations |

API validation, shipment ownership checks, database schema, signed-receipt generation and the six existing HTTP tests are unchanged. No commit or deployment was made. The project root has no Git repository; original files were copied to `tmp/baseline` for comparison.

## Automated evidence

`python -m pytest tests/test_api.py -q -p no:cacheprovider` passed all **6 existing HTTP tests** after integration.

`python -m pytest tests -q -p no:cacheprovider` passed **7 pytest tests** in 18.48 seconds: the six HTTP tests and one wrapper running the browser scenarios. The run used the preinstalled JavaScript Playwright and Chromium via:

```powershell
$env:HANDOFF_PLAYWRIGHT_MODULE='file:///C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
$env:HANDOFF_CHROME='C:/Users/PC/AppData/Local/ms-playwright/chromium-1194/chrome-win/chrome.exe'
python -m pytest tests -q -p no:cacheprovider
```

Browser scenarios:

1. No courier contact, inference or writes before customer consent.
2. Both origins publish public discovery files and byte-identical upstream runtime code; private files are inaccessible and the sandbox worker has its restrictive CSP.
3. Merchant-to-courier-to-merchant agent execution, official popup write, omitted address, persisted case and signed receipt verification.
4. Explicitly selected address reaches the courier.
5. Cancelled merchant review produces no POST or case.
6. Refused courier confirmation produces no POST or case.
7. Model-added unapproved delegation fields are blocked before contacting the courier.
8. Model-added unapproved action fields are blocked before writing.
9. An iframe cannot forge courier approval; a different caller origin gets an empty catalog.
10. Duplicate runtime submission and same-request-ID courier-adapter replay produce one persisted case and the same receipt.
11. Tampered or malformed receipts fail verification.
12. A courier write commits and its acknowledgement is deliberately dropped: status is unknown, with one write and no automatic retry.
13. The official action executor's timeout reports unknown and consumes the submission. This is a controlled local timeout test, not a three-minute remote bridge timeout.

The positive test asserts three inference calls, `remote_fetch` and `remote_call` trace events, and the `fetch-and-run-locally` method. It checks that the unselected address never appears in model requests, no BYOK header reaches the courier, and the real API POST carries the courier Origin and CSRF token.

Saved evidence: `tmp/runtime-proof/trace.json` and `tmp/runtime-proof/merchant-receipt.png`. Inference responses carry the exposed `X-Nsdeploy-LLM-Route: mock` marker; the trace must mark them as mock and never as verified real inference.

## Manual browser verification

The updated UI was exercised by headless browser automation. An additional human-operated run with live inference has not been performed. Follow the Windows commands and seven-step browser flow in [README.md](README.md), using a visitor-provided key and a CORS-enabled tool-calling model. Repeat with address omitted/included, and cancel on each origin. Confirm the signed receipt and persisted courier record after acceptance.

## Remaining hackathon conformance gaps

- The live handoff passed after correcting the CRUSE prompt example, with three verified real model calls and reported cost zero. Repeated-run reliability remains unmeasured. A model that changes or adds fields fails closed rather than silently repairing or resubmitting the case.
- Public HTTPS hosting, real cross-site browser policies, provider CORS, and deployed popup/cookie behavior remain untested. The tested origins use different localhost ports.
- Inference supports browser-side BYOK and the local operator's environment-configured OpenRouter key. No default model is assumed; select a supported model or set `OPENROUTER_MODEL`.
- This deployment uses the browser fetch-and-run profile. It explicitly advertises no public MCP facade and has no private steward or durable execution service.
- Peer contact and write capabilities are restricted to the named demo counterpart. Broader peer discovery and compatibility with unrelated implementations have not been tested.
- Real customer identity, production shipment authorization and managed signing keys remain outside this development demonstration.
- The official Python generator and its full conformance test suite were not run. Runtime source and metadata contracts were inspected directly, and the application's execution path was tested.

The demonstrated outcome is a customer-approved case created once through the official runtime and a verifiable courier receipt, with both scripted inference tests and one successful live free-model run. Full hackathon conformance is not claimed.

## OpenRouter setup extension

`config.mjs` loads `.env` and reads `OPENROUTER_API_KEY` and optional `OPENROUTER_MODEL`; existing environment values win. Lowercase aliases are supported. `.env.example` lists these and the existing port/path settings, and `.env` files are ignored by Git.

The configured key stays server-side. The merchant serves only its availability and model ID to the browser, and streams same-origin model calls to the fixed OpenRouter completion endpoint. The user can switch back to direct browser BYOK. No courier authorization or runtime source was changed.

`node --test tests/test_openrouter.mjs` passed the focused proxy test, covering the outbound Bearer header and fixed destination, SSE streaming, Origin/method/input rejection, upstream errors and secret omission. Upstream inference was mocked in that test. The browser suite also exercises configured OpenRouter without a browser key; its provider response is scripted.

## Free model selection and live attempt

On 2026-11-23, OpenRouter's [endpoint metadata](https://openrouter.ai/api/v1/models/nvidia/nemotron-3.5-super-vl:free/endpoints) listed `nvidia/nemotron-3.5-super-vl:free` with zero prompt/completion prices and support for `tools` and `tool_choice`. This model is set in the local `.env` and `.env.example`; the existing API key was preserved.

`npm run test:live` ran the new `tests/test_live_handoff.mjs` against the actual app, without mocking provider responses. It failed before a courier action proposal with `LLM HTTP 502: OpenRouter request failed`. A direct request to OpenRouter from the same shell failed with `fetch failed`, cause `EACCES`. This is evidence of blocked outbound network access, not a provider response or a model-quality result.

Live attempts save their trace and screenshot in `tmp/live-proof/`. The initial restricted attempt did not reach inference. Subsequent user-run results, including the successful handoff, are documented below.

## Live response formatting investigation

The user's subsequent unrestricted run reached all three real model calls with reported aggregate cost `0`. The courier received the approved case and proposed its exact fields, but emitted this opening fence:

````text
```cruse-ui version:1
````

The upstream CRUSE parser treats `version:1` as body text and rejects the resulting invalid JSON. Its trace reports `The presentation could not be parsed.` The merchant then correctly reports delegation failure and returns no write proposal. No authorization checks were bypassed.

The application prompts ambiguously requested a “version:1 fenced cruse-ui block” without a complete example. Both agent instructions now specify an exact `cruse-ui` fence and a complete JSON envelope with `"version":1` inside the JSON. The upstream parser, bridge and receipt checks are unchanged; no output repair or retry was introduced.

`tests/test_proposal_format.mjs` reproduces rejection of the observed malformed fence and validates both corrected prompt examples through the official parser, action validation and argument preparation. `npm run test:config` passes both proxy and proposal-format tests; the six HTTP tests and fourteen scripted browser scenarios also pass. The user's subsequent live rerun passed with the corrected prompts.

The original failing live evidence is preserved at `tmp/live-proof-before-format-fix/`.

## Successful live handoff

Retained proof: [full result and runtime trace JSON](proof/live-handoff.json) and [merchant receipt screenshot](proof/live-handoff.png). These are copied from the successful run into `proof/`, outside the ignored scratch directory.

```json
{
  "success": true,
  "model": "nvidia/nemotron-3.5-super-vl:free",
  "realModelCalls": 3,
  "reportedCost": 0,
  "remoteCall": {
    "network": "courier",
    "method": "fetch-and-run-locally",
    "status": "ok"
  },
  "actionReceipt": {
    "status": "succeeded",
    "caseId": "COU-F51C3A8A",
    "idempotent": false
  }
}
```

This JSON is a condensed summary; the linked JSON preserves the complete successful test result and all recorded trace events unchanged.

The user ran `npm run test:live` after the prompt correction. Result: **1 passed, 0 failed**, test duration 9740 ms (total command duration 10161 ms). The saved result reports `success: true` for `nvidia/nemotron-3.5-super-vl:free`.

The saved trace confirms three model calls, each marked `verifiedReal: true` and `mock: false`, with aggregate reported cost `0`. The official courier `remote_call` completed with status `ok` using `fetch-and-run-locally`. Its action receipt reports `succeeded`, case `COU-F51C3A8A`, and `idempotent: false`.

The passing test additionally asserts exactly one persisted courier case, omission of the unapproved delivery address, and merchant signature/scope verification `PASS`. The test database and key are isolated and removed after execution. The retained evidence is `proof/live-handoff.json` and `proof/live-handoff.png`; the original test output remains in `tmp/live-proof/`.

This verifies one complete live-model customer-approved handoff. Repeated-run reliability and deployed HTTPS/cross-site behavior remain unverified.
