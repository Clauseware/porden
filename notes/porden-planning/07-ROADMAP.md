# 07 | Roadmap to the January 11, 2027 submission

**Planning reference:** Monday, November 23, 2026. These dates are targets; re-sequence based on evidence from the implementation and teammate availability.

## Week 1 | Nov 24–30 | Foundations and product checks

- Freeze scope, repository layout and TypeScript/Zod contracts.
- Create Bun workspace and Hono skeleton without deleting the functional prototype.
- Set up Postgres databases, migrations, fixtures and role-specific environment configuration.
- Deliver SDK interfaces and mocked frontend fixtures to teammate.
- Interview at least five customers about specific incidents and three potential support/integration operators if contacts are available.

**Gate:** Teammate can build against an agreed contract; DB migrations and isolated test setup succeed.

## Week 2 | Dec 1–7 | Behavioral migration

- Move receiver case and signed receipts to PostgreSQL.
- Preserve atomic deduplication and unknown-outcome semantics.
- Port existing HTTP endpoints to Hono/Bun and restore original API regression tests.
- Port sender-side persistent transfer state and receipt validation.

**Gate:** Prior HTTP and idempotency tests pass on Hono/Postgres, with independent databases.

## Week 3 | Dec 8–14 | SDK and live integration

- Extract browser SDK around pinned nsDeploy runtime.
- Validate discovery, delegation, first-party action approval, consent and signed receipt.
- Run scripted Playwright regression tests on the migrated stack.
- Connect teammate's Next.js demo to the real SDK.

**Gate:** Complete local flow via Bun/Hono/Postgres/Next.js with saved trace and one case.

## Week 4 | Dec 15–21 | Public deployment

- Deploy two public HTTPS origins and corresponding Hono APIs with Postgres.
- Verify reverse proxy, origin policy, CSP, popup, cookies, provider requests and secret boundaries.
- Run real-model tests, record exact success counts and failure categories.
- Run official conformance checks where available and document limitations.

**Gate:** Unassisted clean-browser demo with independently verified receiver receipt.

## Week 5 | Dec 22–28 | Product evidence and polish

- Fix verified reliability issues, then freeze API/SDK surface.
- Publish a receiver integration example.
- Add one backend-only second case type only if P0 is green.
- Measure user understanding, developer integration effort and time-to-acknowledgment.

**Gate:** Credible reuse proof and measured impact data.

## Week 6 | Dec 29–Jan 4 | Submission package

- Frontend teammate delivers polished customer journey and responsive pages.
- Backend owner finalizes docs, environment example, tests and release checks.
- Record video under two minutes using the actual deployed flow.

**Gate:** Public repository, video, website and narrative ready to review.

## Week 7 | Jan 5–10 | Stabilization and submission

- Fresh-install smoke test, repeat public demo, inspect leaked secrets and broken URLs.
- Validate all required submission fields and submit **before January 11, 2027**.
- Freeze the working build; permit verified bug fixes only.

## After the challenge

Potential direction after external demand validation: more receiver adapters, organization onboarding, partner trust policies, asynchronous lifecycle webhooks, signed-receipt standardization, and formal SDK versioning. Make investments according to adoption evidence, rather than treating the entire list as committed scope.
