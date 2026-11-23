# 02 | Hypotheses, validation, and potential impact

## Evidence hierarchy

### Observed in the supplied prototype report

- Browser integration scenarios using official nsDeploy sources were reported passing.
- One successful real-model merchant-to-courier transfer was recorded on 2026-11-23: three real calls, official `remote_call`, one persisted case, accepted receipt, and signature/scope verification passing.
- A first live-model failure exposed a CRUSE formatting ambiguity. The prompt example was corrected and the next recorded live run passed.

**Limits:** localhost origins, one successful live run, fictitious organizations, no external operator adoption study, no measured cross-industry integration effort.

### Published external background

General customer-support research supports frustration around repetition and fragmented context. It does **not**, by itself, prove businesses will pay to integrate an independent cross-company handoff protocol. Use a source's exact methodology and question wording in any pitch; do not convert general support statistics into cross-organization adoption statistics.

## Testable hypotheses

| ID | Hypothesis | Current confidence | Evidence needed | Decision rule |
| --- | --- | --- | --- | --- |
| H1 | Real customers lose time and context when support crosses business boundaries | Plausible; general continuity research | 5 incident interviews with examples involving two organizations | At least 3 concrete incidents and clear repeated work or uncertainty |
| H2 | Official agentic websites can complete an approved, verifiable cross-organization case handoff | Demonstrated once locally | Repeated HTTPS live tests incl. failures | Predeclared pass threshold met; no unapproved fields or duplicate accepted cases |
| H3 | Support operators or integrators would adopt an SDK/API | Unknown | 3 operator/integrator interviews + integration walkthrough | At least 1 credible willingness to try, plus actionable integration constraints |
| H4 | One transfer core can serve different workflows | Architectural hypothesis | Second backend-only case schema through unchanged shared lifecycle | Same SDK/runtime path; no delivery-specific conditionals in core |
| H5 | A signed receipt materially improves confidence or follow-up | Unvalidated | User comparison with/without receipt in controlled tasks | Users can correctly identify who received the case and whether it was merely accepted |

These rules are working thresholds for this project, not market estimates.

## Research plan

### Customer incident interviews (5)

Ask about the last incident involving two companies: what happened, who they contacted, what data they had to repeat, how they knew it reached the right organization, and whether a record or receipt existed. Ask about specific past behavior before showing Porden. Record anonymized notes and seek permission before using a quote.

### Support/operator interviews (3)

Ask how partner escalations currently occur; what integration contracts exist; whether the parties trust shared tickets; who can authorize a write; how recipients acknowledge receipt; whether the receiving organization can return a stable case ID; what would block adoption.

### Integration trial (1)

Give one external developer the SDK README and a starter receiver. Measure time to first successful transfer, support interventions, and integration points they must modify. This evidence is more persuasive than a second mock consumer scenario.

## Quantitative impact measures

| Metric | Definition | Collection | Target for hackathon |
| --- | --- | --- | --- |
| Verified acceptance rate | Valid receipts for submitted approved transfers / all submitted approved transfers | Automated test batch | Set a realistic threshold before repeated runs; report numerator/denominator |
| Duplicate case count | Extra receiver cases created per request ID | Postgres queries and replay tests | 0 |
| Unapproved-field disclosure | Unapproved fields found in model request, delegated payload or receiver write | Instrumented fixtures | 0 in all tested paths |
| Time to acknowledgment | Customer approval to verified receiver receipt | Browser timestamps | Report median and range; compare with same-task manual workflow |
| Customer re-entry count | Number of fields a test participant manually repeats | Recorded usability tasks | Show measured difference, not invented savings |
| Developer integration time | Start of setup to first successful receiver action | Developer walkthrough | Publish actual time and blockers |
| Receipt comprehension | Participants who correctly distinguish case accepted from case resolved | Short user test | Record results and revise copy |

## How to tell the impact story

Present a real customer workflow in under two minutes: consent → independent agent transfer → receiver-owned case → independent receipt verification. Support it with one usability comparison and a developer integration result. Include negative evidence where the flow fails.

## Commercial risk

An existing API integration can be simpler for two organizations with a long-established partnership. Porden's likely value increases when independently managed agentic websites need a repeatable consent and acknowledgment contract. Interviews must test this narrow opportunity.
