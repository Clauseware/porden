# 01 | Product scope

## Product statement

**Porden enables a customer-approved transfer of a case from one independent organization to another, through interoperable AI agents, and returns verifiable evidence that the receiver accepted it.**

It can be embedded into an existing customer-service website or integrated programmatically through a documented client/API contract. Porden itself is not intended to become a CRM, full customer-support platform, case-resolution authority, or central owner of every organization's customer data.

## Who benefits

- **Customer:** avoids manually repeating approved context, chooses what is transferred, and sees where the case went.
- **Sending organization:** can route a case to the correct counterpart with an acknowledgment that can be audited.
- **Receiving organization:** controls which cases it accepts and creates its own local record using its own authorization rules.
- **Developer:** can reuse a contract and client SDK instead of reconstructing a fragile per-partner handoff UI.

## Reference experience

A customer reports a damaged order to a merchant. The merchant agent uses official Agentic Web linking to discover and invoke the courier agent. The customer explicitly approves the recipient and exact fields. The courier requires first-party confirmation for the write, creates one case, and returns a signed receipt. The merchant verifies issuer, scope, signature, and outcome.

A receipt proves **accepted into the receiving system**. It does not prove that the complaint has been resolved or that the delivery company accepts fault.

## Universal operation

`transferCase(sender, recipient, caseType, approvedData, approvalContext)`

This represents desired capability and **is not a claim about the existing SDK API**. The underlying consent, model invocation, write confirmation, and receipt semantics remain enforced by the official runtime and receiver, respectively.

## MVP in scope

1. Merchant and courier as two genuinely separate web origins and independently configured backend deployments.
2. Official nsDeploy browser runtime and public agent discovery files.
3. Explicit field-level customer consent, preserved through an immutable approved payload and recipient scope.
4. A single receiver-controlled write action and persisted case in PostgreSQL.
5. Idempotency, verifiable signed receipt, safe handling of unknown results, and recovery by stable request ID.
6. Reusable TypeScript browser SDK with a documented frontend contract.
7. Live-model run, realistic failure tests, and deployed HTTPS demonstration.
8. A second **backend-only** synthetic case type to test generality if P0 work is complete.

## Outside this hackathon's MVP

- Broad CRM connector library or case management dashboard.
- Multi-tenant self-service SaaS onboarding, subscriptions, billing, or external customer identity providers.
- Cross-industry compliance certification, universal organization directory, or private stewards.
- General-purpose public MCP hosting, broad interoperability promises, or independent support of unrelated third-party runtimes.
- Automatic dispute resolution, refunds, payouts, ongoing claims workflow, or bilateral status synchronization.

## Definition of product success

A new developer can use the documented SDK example and an organization-owned Hono adapter to complete a transfer between two deployed sites; the customer can see exactly which fields they approved; the receiving system stores one case and returns a valid receipt; duplicates, cancellations, tampering and uncertain outcomes behave safely.

## Scope discipline

Keep e-commerce logistics as the **demo story**, not a restriction in the core transfer schema. Use neutral terms such as `caseType`, `recipient`, and `approvedPayload` in shared contracts. Business-specific fields belong in validated per-case-type schemas.
