# 12 | Decisions and open questions

## Locked decisions, November 23, 2026

| Decision | Rationale |
| --- | --- |
| Broad product category: cross-business consented case transfer | More reusable than an e-commerce complaint app |
| Demo reference: merchant → courier damaged delivery | Working technical foundation and relatable problem |
| Bun runtime and workspace | Requested stack and direct TS execution |
| Hono as a separate backend service | Reusable backend independent of Next.js implementation |
| PostgreSQL instead of SQLite | Chosen persistent relational store |
| Next.js frontend owned by teammate | Clear split of UX and backend responsibilities |
| Browser TypeScript SDK independent of Next.js | Reusable integration surface without altering official runtime |
| Official nsDeploy runtime remains the agent-execution path | Demonstrated integration and hackathon conformance target |
| Separate organizational origins and database scopes | Receiver controls its own data and writes |
| Monorepo with independent deployments | Shared type safety without forced shared operational ownership |
| One reference flow, second case type backend-only after P0 | Broad generality proof with limited implementation risk |

## Open questions and recommended defaults

| Question | Default for MVP | Verify when |
| --- | --- | --- |
| Hosting for Bun/Hono and Next.js | Choose services supporting independent public HTTPS origins | Before Dec 15 deployment |
| Postgres provider | One local server with two databases; independently scoped cloud DB credentials | Before DB provisioning |
| Public API hostname layout | Reverse-proxy each organization's `/api/*` to its Hono service | During deployment and bridge testing |
| Server session/identity for demo | A small explicit authenticated demo user with order ownership fixture | During contract freeze |
| Signing key lifecycle | Existing ES256 behavior with configured private keys and public JWKS; document rotation as future | Before public exposure |
| Consent artifact and lifetime | Scope-bound, short-lived and server-verifiable; no broad reusable grants | Before implementing approval endpoint |
| SDK package publication | Private monorepo workspace first, then public package when stable | After SDK browser tests |
| Database query abstraction | Bun native SQL and SQL migration files initially | After repository inspection |
| Model provider | Existing supported OpenRouter route as configurable demo backend; no secret in frontend | During live test setup |
| Second domain scenario | `service_referral`, synthetic fixture without regulated personal data | After P0 green |
| Automated repeated-run threshold | 20 success-path runs, target at least 18 verified | Before reliability test |

## Explicitly unresolved product claims

- Independent support teams' willingness to adopt an external case-transfer integration.
- Cross-industry demand and regulatory fit.
- Reliability across different model vendors, browsers and deployment environments.
- Compatibility with independent third-party Agentic Web implementations.

These claims must remain hypotheses until measured. The current single live success proves feasibility in the tested scenario only.

## References

- [Bun SQL](https://bun.com/docs/runtime/sql)
- [Hono Bun guide](https://hono.dev/docs/getting-started/bun)
- [Next.js with Bun guide](https://bun.com/guides/ecosystem/nextjs)
- [Agentic Web MVP](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md)
- [nsDeploy actions](https://github.com/cognizant-ai-lab/nsdeploy/blob/main/docs/actions.md)
