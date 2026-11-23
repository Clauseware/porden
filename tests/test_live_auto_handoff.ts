import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SQL } from 'bun';
import { CreateHandoff } from '../packages/contracts/src/handoffs';
import { createHandoffClient } from '../packages/sdk/src/handoff-client';
import { registerActions } from '../apps/api/public/actions.js';

const model = process.env.OPENROUTER_MODEL || process.env.openrouter_model || '';
const apiKey = process.env.OPENROUTER_API_KEY || process.env.openrouter_api_key || '';
assert.ok(model.endsWith(':free'), 'Live test requires a configured :free model');
assert.ok(apiKey, 'Live test requires an OpenRouter API key');

const accounts = JSON.parse(await readFile('tmp/platform-demo/accounts.json', 'utf8'));
const senderOrg = accounts.organizations.find((item) => item.name === 'Company A');
const receiverOrg = accounts.organizations.find((item) => item.name === 'Company B');
const senderToken = accounts.principals.find(
  (item) => item.organizationId === senderOrg?.id && item.kind === 'integration',
);
const receiverToken = accounts.principals.find(
  (item) => item.organizationId === receiverOrg?.id && item.kind === 'integration',
);
assert.ok(senderOrg && receiverOrg && senderToken?.secret && receiverToken?.secret);

const database = new SQL({ url: process.env.PORDEN_DATABASE_URL, prepare: false });
let policyChange: { human_approval_required: boolean }[] = [];
try {
  policyChange = await database`
    UPDATE organizations
    SET human_approval_required = ${false}
    WHERE id = ${senderOrg.id}
    RETURNING human_approval_required
  `;
} finally {
  await database.close();
}
assert.equal(policyChange.length, 1);
assert.equal(policyChange[0].human_approval_required, false);

const registered: Array<{ name: string; description: string; inputSchema: object }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const path = String(input);
  if (path === '/action-policy.json')
    return new Response(JSON.stringify({ callerOrigins: ['http://localhost:4100'] }));
  if (path === '/api/v1/case-types') return new Response('', { status: 404 });
  throw new Error('Unexpected action discovery request');
};
try {
  await registerActions({ register: (action) => registered.push(action) });
} finally {
  globalThis.fetch = originalFetch;
}
const action = registered.find((item) => item.name === 'porden_handoff');
assert.ok(action);
const network = JSON.parse(await readFile('public/merchant/merchant.network.json', 'utf8'));
const instructions = network.tools.find((item) => item.name === 'merchant_front').instructions;

const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  signal: AbortSignal.timeout(90000),
  body: JSON.stringify({
    model,
    messages: [
      { role: 'system', content: instructions },
      {
        role: 'user',
        content: `Create one versioned Porden handoff from Company A to Company B (receiverOrganizationId ${receiverOrg.id}) for a synthetic, no-side-effect validation. Goal: verify that a valid handoff is automatically authorized and still waits for receiver acceptance. Constraints: do not purchase anything or contact external services; this is test-only. Acceptance criteria: Company B receives version 1, confirms its authorization state, and accepts the exact version. Include structured context: completedWork should say no external action has occurred; remainingWork should say to verify receipt and acceptance eligibility; nextStep should say the receiver accepts version 1. Do not add evidence. Call porden_handoff exactly once with operation=create.`,
      },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: action.name,
          description: action.description,
          parameters: action.inputSchema,
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: action.name } },
  }),
});
if (!response.ok)
  throw new Error(`OpenRouter returned HTTP ${response.status}; response body omitted`);
const completion = await response.json();
const calls = completion.choices?.[0]?.message?.tool_calls || [];
assert.equal(calls.length, 1);
assert.equal(calls[0].function?.name, 'porden_handoff');
const args = JSON.parse(calls[0].function.arguments);
assert.equal(args.operation, 'create');
assert.equal(args.receiverOrganizationId, receiverOrg.id);

const createInput = CreateHandoff.parse({
  requestId: crypto.randomUUID(),
  receiverOrganizationId: args.receiverOrganizationId,
  terms: args.terms,
});
assert.ok(createInput.terms.remainingWork?.length && createInput.terms.nextStep);

const baseUrl = 'http://127.0.0.1:5300/api/v2';
const sender = createHandoffClient({ baseUrl, token: senderToken.secret });
const receiverClient = createHandoffClient({ baseUrl, token: receiverToken.secret });
const created = await sender.createHandoff(createInput);
assert.equal(created.handoff.status, 'approved');
assert.equal(created.handoff.currentVersion, 1);
assert.equal(created.handoff.approvedVersion, 1);
const beforeAcceptance = await sender.getAuthorization(created.handoff.id, 1);
assert.equal(beforeAcceptance.eligible, false);
assert.equal(beforeAcceptance.reasonCode, 'ACCEPTANCE_REQUIRED');
const readback = await receiverClient.getHandoff(created.handoff.id);
assert.deepEqual(readback.versions[0].terms, createInput.terms);
const accepted = await receiverClient.acceptHandoff(created.handoff.id, {
  requestId: crypto.randomUUID(),
  version: 1,
});
assert.equal(accepted.handoff.status, 'accepted');
const afterAcceptance = await receiverClient.getAuthorization(accepted.handoff.id, 1);
assert.equal(afterAcceptance.eligible, true);
assert.equal(afterAcceptance.reasonCode, 'AUTHORIZED');

console.log(
  JSON.stringify(
    {
      result: 'passed',
      inferenceCalls: 1,
      model,
      tool: calls[0].function.name,
      senderHumanApprovalRequired: policyChange[0].human_approval_required,
      handoffId: accepted.handoff.id,
      version: accepted.handoff.currentVersion,
      status: accepted.handoff.status,
      authorizationBeforeAcceptance: beforeAcceptance.reasonCode,
      authorizationAfterAcceptance: afterAcceptance.reasonCode,
      eligibleAfterAcceptance: afterAcceptance.eligible,
      terms: createInput.terms,
      receiptId: accepted.receipt.id,
    },
    null,
    2,
  ),
);
