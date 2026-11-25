// Browser check of the locally deployed standalone stack (run by tests/test_backend_release.py).
// Chromium reaches https://{api,merchant,courier}.porden.test through the real Caddy on its
// published loopback port. Certificate verification for the browser is relaxed here only because
// Caddy's per-run internal CA is not in the OS trust store; check.mjs verifies TLS against that CA.
// Inference is scripted inside the browser; no model provider is contacted.
//
// Required env: PORDEN_DEPLOYED_HTTPS_PORT, MERCHANT_DEMO_PASSWORD, COURIER_DEMO_PASSWORD,
// TEST_HUMAN_PASSWORD, PORDEN_DEPLOYED_PROOF (evidence directory).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page, Route } from 'playwright';

const { chromium } = await import(process.env.HANDOFF_PLAYWRIGHT_MODULE || 'playwright');
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw Error(`${name} is required`);
  return value;
};
const port = required('PORDEN_DEPLOYED_HTTPS_PORT');
const proof = resolve(required('PORDEN_DEPLOYED_PROOF'));
mkdirSync(proof, { recursive: true });
const origins = {
  dashboard: 'https://api.porden.test',
  merchant: 'https://merchant.porden.test',
  courier: 'https://courier.porden.test',
};
const model = 'porden-scripted-test';

const entry = resolve(proof, 'entry.ts');
writeFileSync(
  entry,
  [
    `import * as agent from '${resolve('apps/claims-agent.ts').replaceAll('\\', '/')}';`,
    `import * as client from '${resolve('apps/claims-client.ts').replaceAll('\\', '/')}';`,
    `import { createPordenClient } from '${resolve('packages/sdk/src/delivery.ts').replaceAll('\\', '/')}';`,
    'Object.assign(window, { __claims: { ...agent, ...client, createPordenClient } });',
  ].join('\n'),
);
const bundle = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm' });
if (!bundle.success) throw Error(bundle.logs.map(String).join('\n'));
const bundleText = await bundle.outputs[0].text();

function proposal(text: string, components: unknown[]) {
  return { content: `${text}\n\`\`\`cruse-ui\n${JSON.stringify({ version: 1, components })}\n\`\`\`` };
}
const action = (name: string, ref: (name: string) => string, args: unknown) =>
  proposal('Please review.', [{ id: name, kind: 'action', label: 'Review and send', action: ref(name), arguments: args }]);
// Deterministic agents: the merchant files a full refund; the courier follows the server evaluation.
async function scriptedModel(route: Route) {
  const body = route.request().postDataJSON();
  const messages: Array<{ role: string; content: string }> = body.messages;
  const user = messages.findLast((message) => message.role === 'user')?.content ?? '';
  const children = messages.filter((message) => message.role === 'tool');
  const catalogText = messages[0].content.split('CRUSE browser actions (proposals only; these are NOT tool calls):\n')[1];
  const catalog: Array<{ name: string; ref: string }> = catalogText ? JSON.parse(catalogText.split('\n')[0]) : [];
  const ref = (name: string) => catalog.find((item) => item.name === name)?.ref ?? `missing#${name}`;
  let input: Record<string, any> = {};
  try {
    input = JSON.parse(user);
  } catch {
    // Non-JSON turns are not used here.
  }
  let delta: Record<string, unknown>;
  if (input.task === 'file_claim')
    delta = action('merchant_file_claim', ref, { damageDescription: 'Vase shattered in transit', photoProvided: true, remedy: 'full_refund' });
  else if (input.task === 'review_claim') {
    const counter = input.evaluation.allowed.find((item: any) => item.decision === 'counter' && item.resolution.remedy === 'partial_refund');
    const choice = counter ?? input.evaluation.allowed[0];
    delta = action('courier_claim_decision', ref, {
      handoffId: input.handoffId,
      version: input.version,
      decision: choice.decision,
      reason: 'Per the courier claims policy.',
      ...(choice.decision === 'counter' ? { remedy: 'partial_refund' } : {}),
    });
  } else if (input.task === 'complete_claim')
    delta = action('courier_claim_decision', ref, { handoffId: input.handoffId, version: input.version, decision: 'complete', reason: 'Case recorded.' });
  else if (body.tools?.length && !children.length)
    delta = { tool_calls: [{ index: 0, id: 'porden-delegation', type: 'function', function: { name: body.tools[0].function.name, arguments: JSON.stringify({ request: user }) } }] };
  else if (children.length)
    delta = proposal('Review the courier proposal.', children[0].content.startsWith('Error from tool ') ? [] : JSON.parse(children[0].content).presentation?.components ?? []);
  else delta = proposal('Review the proposed courier case.', [{ id: 'create_damage_case', kind: 'action', label: 'Submit approved case', action: ref('create_damage_case'), arguments: input }]);
  const chunk = { model, choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] };
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n` });
}

async function claimTurn(page: Page, task: Record<string, unknown>) {
  const running = page.evaluate(async (input) => {
    const { Engine } = await import('/runtime/engine.js');
    const { actionBindings } = await import('/runtime/actions.js');
    const { reviewActions } = await import('/runtime/action-transport.js');
    const w = window as unknown as { __engine?: any; __claims: Record<string, (...args: unknown[]) => Promise<any>> };
    w.__engine ??= new Engine({ originUrl: location.origin, byokKey: 'server-openrouter', routerOverride: `${location.origin}/api/llm`, modelOverride: 'porden-scripted-test' });
    w.__engine.onActionConfirm = (items: unknown) => reviewActions(items, 'Review before sending');
    const turn = await w.__claims.proposeClaimAction(w.__engine, actionBindings, input);
    if (turn.kind !== 'proposal') return { turn };
    return { turn, outcome: await w.__claims.submitClaimProposal(w.__engine, turn) };
  }, task);
  await page.getByRole('heading', { name: 'Review before sending', exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Confirm actions', exact: true }).click();
  return (await running) as Record<string, any>;
}
async function evaluation(courier: Page, handoffId: string) {
  return courier.evaluate(async (id) => {
    const w = window as unknown as { __claims: { createCourierClaimsClient(): Record<string, (...a: unknown[]) => Promise<any>> } };
    return w.__claims.createCourierClaimsClient().evaluation(id);
  }, handoffId);
}
async function review(courier: Page, handoffId: string) {
  const result = await evaluation(courier, handoffId);
  return claimTurn(courier, { task: 'review_claim', handoffId, version: result.version, status: 'approved', evaluation: { findings: result.findings, allowed: result.allowed, parameters: result.parameters, policyId: result.policyId } });
}
/** The merchant approver decides in the deployed dashboard UI. */
async function approveInDashboard(dashboard: Page, handoffId: string, version: number) {
  await dashboard.goto(`${origins.dashboard}/handoffs/${handoffId}`);
  await dashboard.getByRole('heading', { name: 'Decide exact terms', exact: true }).waitFor();
  await dashboard.getByRole('checkbox').check();
  await dashboard.getByRole('button', { name: `Approve version ${version}`, exact: true }).click();
  await dashboard.getByText('Status:').waitFor();
  await dashboard.waitForFunction((v) => !document.body.innerText.includes(`Approve version ${v}`), version);
}

const results: Array<{ name: string; passed: boolean; error?: string }> = [];
const browser = await chromium.launch({
  headless: true,
  args: [`--host-resolver-rules=MAP *.porden.test:443 127.0.0.1:${port}`],
  ...(process.env.HANDOFF_CHROME ? { executablePath: process.env.HANDOFF_CHROME } : {}),
});
let context: BrowserContext | undefined;
try {
  context = await browser.newContext({ ignoreHTTPSErrors: true });
  const errors: string[] = [];
  context.on('page', (page: Page) => page.on('pageerror', (error) => errors.push(error.message)));
  for (const origin of [origins.merchant, origins.courier])
    await context.route(`${origin}/api/llm/chat/completions`, scriptedModel);
  const name = 'deployed stack: claim across merchant, courier and dashboard sites with SDK transfer and receipt verification';
  try {
    const courier = await context.newPage();
    await courier.goto(origins.courier);
    await courier.getByLabel('Courier demo password').fill(required('COURIER_DEMO_PASSWORD'));
    await courier.getByRole('button', { name: 'Sign in to courier', exact: true }).click();
    await courier.getByText('Signed in. You can now approve a courier case.', { exact: true }).waitFor();
    const merchant = await context.newPage();
    await merchant.goto(origins.merchant);
    await merchant.getByLabel('Merchant demo password').fill(required('MERCHANT_DEMO_PASSWORD'));
    await merchant.getByRole('button', { name: 'Sign in to merchant', exact: true }).click();
    await merchant.getByLabel('What happened?').waitFor();
    const dashboard = await context.newPage();
    await dashboard.goto(origins.dashboard);
    await dashboard.getByLabel('Login').fill('release-approver');
    await dashboard.getByLabel('Password').fill(required('TEST_HUMAN_PASSWORD'));
    await dashboard.getByRole('button', { name: 'Sign in', exact: true }).click();
    await dashboard.getByRole('heading', { name: 'Organization handoffs' }).waitFor();
    for (const page of [merchant, courier]) {
      await page.addScriptTag({ type: 'module', content: bundleText });
      await page.waitForFunction(() => '__claims' in window);
    }
    const order = await merchant.evaluate(async () => (window as any).__claims.createMerchantClaimsClient().order('DEMO-1042'));
    const courierPolicy = await merchant.evaluate(async (origin) => (window as any).__claims.createMerchantClaimsClient().courierPolicy(origin), origins.courier);
    const filed = await claimTurn(merchant, { task: 'file_claim', customerMessage: 'The vase arrived shattered; photo uploaded; I want my money back.', order, courierPolicy });
    assert.equal(filed.outcome?.status, 'succeeded', JSON.stringify(filed));
    const handoffId: string = filed.outcome.result.handoff.id;
    assert.equal(filed.outcome.result.handoff.status, 'draft', 'the release merchant requires human approval');
    await approveInDashboard(dashboard, handoffId, 1);
    const countered = await review(courier, handoffId);
    assert.equal(countered.turn.arguments.decision, 'counter');
    assert.equal(countered.outcome.status, 'succeeded', JSON.stringify(countered.outcome));
    await approveInDashboard(dashboard, handoffId, 2);
    const accepted = await review(courier, handoffId);
    assert.equal(accepted.turn.arguments.decision, 'accept');
    assert.equal(accepted.outcome.status, 'succeeded');
    // Real SDK transfer: merchant agent → courier network on the courier origin → bridge popup.
    const sending = merchant.evaluate(async ([id, courierOrigin]) => {
      const client = (window as any).__claims.createPordenClient({ model: 'porden-scripted-test' });
      const draft = await client.createDraft({ recipientOrigin: courierOrigin, caseType: 'delivery_damage', data: { orderReference: 'DEMO-1042', damageDescription: 'Vase shattered in transit' }, governance: { handoffId: id, version: 2 } });
      return client.transfer({ transferId: draft.id, approvedFields: ['orderReference', 'damageDescription'], confirm: async () => true });
    }, [handoffId, origins.courier] as const);
    await merchant.getByRole('heading', { name: 'Review the approved courier transfer', exact: true }).waitFor({ timeout: 30_000 });
    await merchant.getByRole('button', { name: 'Confirm actions', exact: true }).click();
    const opened = merchant.waitForEvent('popup');
    await merchant.getByRole('button', { name: 'Open action site', exact: true }).click();
    const bridge = await opened;
    assert.equal(new URL(bridge.url()).origin, origins.courier);
    await bridge.getByRole('button', { name: 'Confirm actions', exact: true }).click();
    const sent = await sending;
    assert.equal(sent.status, 'accepted', JSON.stringify(sent));
    // Cross-origin receipt verification against the courier site through Caddy.
    const view = await merchant.evaluate(async (id) => (window as any).__claims.createMerchantClaimsClient().claim(id), handoffId);
    assert.deepEqual(view.current.resolution, { remedy: 'partial_refund', amountMinor: 5_000, currency: 'USD' });
    const handoffReceipt = view.handoff.receipts.at(-1).signedReceipt;
    const verified = await merchant.evaluate(async ([receipt, origin]) => (window as any).__claims.verifyReceipt(receipt, origin), [handoffReceipt, origins.courier] as const);
    assert.equal(verified.valid, true);
    assert.equal(verified.receipt.kind, 'handoff');
    const done = await claimTurn(courier, { task: 'complete_claim', handoffId, version: 2 });
    assert.equal(done.outcome.status, 'succeeded', JSON.stringify(done.outcome));
    assert.equal(done.outcome.result.handoff.status, 'completed');
    assert.deepEqual(errors, []);
    for (const [label, page] of [['merchant', merchant], ['courier', courier], ['dashboard', dashboard]] as const)
      await page.screenshot({ path: resolve(proof, `deployed-${label}.png`), fullPage: true });
    results.push({ name, passed: true });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false, error: error instanceof Error ? error.stack : String(error) });
    console.error('FAIL', name, error);
  }
} finally {
  await context?.close();
  await browser.close();
}
writeFileSync(resolve(proof, 'browser-results.json'), JSON.stringify(results, null, 2));
if (results.some((item) => !item.passed)) process.exitCode = 1;
