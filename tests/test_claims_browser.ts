// Browser negotiation and cross-site verification for the damaged-parcel claims example.
// Real Next.js merchant and courier sites, real HTTP APIs, the official nsDeploy runtime and action
// bridge, the shared claims runner/client and the SDK transfer flow, in Chromium. Inference is
// scripted (deterministic and adversarial); no provider is contacted. The merchant approver's
// counter-offer decision is made through the platform API (the dashboard UI is not under test).
//
// Usage: bun tests/test_claims_browser.ts
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page, Route } from 'playwright';
import { origins, startClaimsStack } from '../apps/api/test/claims-stack';

const { chromium } = await import(process.env.HANDOFF_PLAYWRIGHT_MODULE || 'playwright');
const url = process.env.PORDEN_TEST_DATABASE_URL;
if (!url) throw Error('PORDEN_TEST_DATABASE_URL is required');
const model = 'porden-scripted-test';
const proof = resolve('tmp/porden-claims-browser', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(proof, { recursive: true });
const ports = { merchant: 5100, courier: 5200 };
const results: Array<{ name: string; passed: boolean; error?: string; ms: number }> = [];

// Bundle the shared claims runner, the claims client and the SDK transfer client for injection.
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

const stack = await startClaimsStack({
  url,
  env: { OPENROUTER_API_KEY: 'scripted-not-a-key', OPENROUTER_MODEL: model },
});
const servers = [
  Bun.serve({ hostname: '127.0.0.1', port: ports.merchant, fetch: stack.apps.merchant.fetch }),
  Bun.serve({ hostname: '127.0.0.1', port: ports.courier, fetch: stack.apps.courier.fetch }),
];
const processes: ChildProcess[] = [];
for (const role of ['merchant', 'courier'] as const) {
  const proc = spawn(
    'node',
    [resolve('node_modules/next/dist/bin/next'), 'start', resolve(`apps/${role}-web`), '-p', new URL(origins[role]).port],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  proc.stdout?.on('data', () => {});
  proc.stderr?.on('data', (data) => console.error(`${role}:`, String(data)));
  processes.push(proc);
}
for (let attempt = 0; ; attempt += 1) {
  try {
    if ((await fetch(origins.merchant)).ok && (await fetch(origins.courier)).ok) break;
  } catch {
    // Next.js is still starting.
  }
  if (attempt > 160) throw Error('Next.js did not start');
  await Bun.sleep(250);
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.HANDOFF_CHROME ? { executablePath: process.env.HANDOFF_CHROME } : {}),
});

// ---------- scripted model ----------
type Script = Partial<Record<string, (input: Record<string, unknown>, ref: (name: string) => string) => unknown>>;
function sse(delta: Record<string, unknown>) {
  const chunk = { model, choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] };
  return `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
}
function proposal(text: string, components: unknown[]) {
  return { content: `${text}\n\`\`\`cruse-ui\n${JSON.stringify({ version: 1, components })}\n\`\`\`` };
}
async function scriptedModel(route: Route, script: Script, log: unknown[]) {
  const body = route.request().postDataJSON();
  log.push(body);
  const messages: Array<{ role: string; content: string }> = body.messages;
  const user = messages.findLast((message) => message.role === 'user')?.content ?? '';
  const children = messages.filter((message) => message.role === 'tool');
  const catalogText = messages[0].content.split('CRUSE browser actions (proposals only; these are NOT tool calls):\n')[1];
  const catalog: Array<{ name: string; ref: string }> = catalogText ? JSON.parse(catalogText.split('\n')[0]) : [];
  const ref = (name: string) => catalog.find((item) => item.name === name)?.ref ?? `missing#${name}`;
  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(user);
  } catch {
    // Non-JSON turns fall through to a plain answer.
  }
  let delta: Record<string, unknown>;
  if (typeof input.task === 'string') {
    const answer = script[input.task]?.(input, ref);
    delta = answer === undefined ? { content: 'I need more information before proposing anything.' } : (answer as Record<string, unknown>);
  } else if (body.tools?.length && !children.length) {
    // Existing SDK transfer: the merchant agent delegates the approved envelope to the courier.
    delta = { tool_calls: [{ index: 0, id: 'porden-delegation', type: 'function', function: { name: body.tools[0].function.name, arguments: JSON.stringify({ request: user }) } }] };
  } else if (children.length) {
    const child = children[0].content;
    delta = proposal('Review the courier proposal.', child.startsWith('Error from tool ') ? [] : JSON.parse(child).presentation?.components ?? []);
  } else {
    delta = proposal('Review the proposed courier case.', [{ id: 'create_damage_case', kind: 'action', label: 'Submit approved case', action: ref('create_damage_case'), arguments: input }]);
  }
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(delta) });
}
const action = (name: string, ref: (name: string) => string, args: unknown, text = 'Please review.') =>
  proposal(text, [{ id: name, kind: 'action', label: 'Review and send', action: ref(name), arguments: args }]);

// ---------- browser session ----------
type Session = { context: BrowserContext; merchant: Page; courier: Page; modelLog: unknown[]; errors: string[] };
async function session(script: Script, setup?: (context: BrowserContext) => Promise<void>): Promise<Session> {
  const context = await browser.newContext();
  const modelLog: unknown[] = [],
    errors: string[] = [];
  for (const role of ['merchant', 'courier'] as const)
    await context.route(`${origins[role]}/api/llm/chat/completions`, (route: Route) => scriptedModel(route, script, modelLog));
  context.on('page', (page: Page) => page.on('pageerror', (error) => errors.push(error.message)));
  if (setup) await setup(context);
  const courier = await context.newPage();
  await courier.goto(origins.courier);
  await courier.getByLabel('Courier demo password').fill('claims-test');
  await courier.getByRole('button', { name: 'Sign in to courier', exact: true }).click();
  await courier.getByText('Signed in. You can now approve a courier case.', { exact: true }).waitFor();
  const merchant = await context.newPage();
  await merchant.goto(origins.merchant);
  await merchant.getByLabel('Merchant demo password').fill('claims-test');
  await merchant.getByRole('button', { name: 'Sign in to merchant', exact: true }).click();
  await merchant.getByLabel('What happened?').waitFor();
  for (const page of [merchant, courier]) await page.addScriptTag({ type: 'module', content: bundleText });
  for (const page of [merchant, courier]) await page.waitForFunction(() => 'window' in globalThis && '__claims' in window);
  return { context, merchant, courier, modelLog, errors };
}

/** Runs one claims turn in the page and confirms (or cancels) in the runtime review dialog. */
async function claimTurn(page: Page, task: Record<string, unknown>, review: 'confirm' | 'cancel' = 'confirm') {
  const running = page.evaluate(async (input) => {
    const { Engine } = await import('/runtime/engine.js');
    const { actionBindings } = await import('/runtime/actions.js');
    const { reviewActions } = await import('/runtime/action-transport.js');
    const w = window as unknown as { __engine?: InstanceType<typeof Engine>; __claims: Record<string, (...args: unknown[]) => Promise<unknown>> };
    w.__engine ??= new Engine({ originUrl: location.origin, byokKey: 'server-openrouter', routerOverride: `${location.origin}/api/llm`, modelOverride: 'porden-scripted-test' });
    w.__engine.onActionConfirm = (items: unknown) => reviewActions(items, 'Review before sending');
    const turn = (await w.__claims.proposeClaimAction(w.__engine, actionBindings, input)) as { kind: string };
    if (turn.kind !== 'proposal') return { turn };
    return { turn, outcome: await w.__claims.submitClaimProposal(w.__engine, turn) };
  }, task);
  const dialog = page.getByRole('heading', { name: 'Review before sending', exact: true });
  const settled = await Promise.race([
    dialog.waitFor({ timeout: 15_000 }).then(() => 'dialog'),
    running.then(() => 'done'),
  ]);
  if (settled === 'dialog') {
    const shown = await page.locator('dialog').last().innerText();
    await page.getByRole('button', { name: review === 'confirm' ? 'Confirm actions' : 'Cancel', exact: true }).click();
    return { ...(await running), shown } as Record<string, any>;
  }
  return (await running) as Record<string, any>;
}
async function merchantClient<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([name, rest]) => {
      const w = window as unknown as { __claims: { createMerchantClaimsClient(): Record<string, (...a: unknown[]) => Promise<unknown>> } };
      return w.__claims.createMerchantClaimsClient()[name as string](...(rest as unknown[]));
    },
    [method, args] as const,
  ) as Promise<T>;
}
async function courierClient<T>(page: Page, method: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([name, rest]) => {
      const w = window as unknown as { __claims: { createCourierClaimsClient(): Record<string, (...a: unknown[]) => Promise<unknown>> } };
      return w.__claims.createCourierClaimsClient()[name as string](...(rest as unknown[]));
    },
    [method, args] as const,
  ) as Promise<T>;
}
async function fileClaim(s: Session, customerMessage: string) {
  const order = await merchantClient(s.merchant, 'order', 'DEMO-1042');
  const courierPolicy = await merchantClient(s.merchant, 'courierPolicy', origins.courier);
  return claimTurn(s.merchant, { task: 'file_claim', customerMessage, order, courierPolicy });
}
async function review(s: Session, handoffId: string, staffNote?: string) {
  const evaluation = await courierClient<Record<string, any>>(s.courier, 'evaluation', handoffId);
  return claimTurn(s.courier, {
    task: 'review_claim',
    handoffId,
    version: evaluation.version,
    status: 'approved',
    evaluation: { findings: evaluation.findings, allowed: evaluation.allowed, parameters: evaluation.parameters, policyId: evaluation.policyId },
    ...(staffNote ? { staffNote } : {}),
  });
}
/** Real SDK transfer: consent for the version, merchant agent → courier network → bridge popup. */
async function transfer(s: Session, handoffId: string, version: number, popup: 'confirm' | 'none' = 'confirm') {
  const running = s.merchant.evaluate(
    async ([id, v, courierOrigin]) => {
      const w = window as unknown as { __claims: { createPordenClient(o: unknown): Record<string, (...a: unknown[]) => Promise<any>> } };
      const { Engine } = await import('/runtime/engine.js');
      const run = Engine.prototype.runTurn;
      Engine.prototype.runTurn = async function (this: unknown, ...args: unknown[]) {
        (window as unknown as { __transferEngine: unknown }).__transferEngine = this;
        return run.apply(this, args);
      };
      const client = w.__claims.createPordenClient({ model: 'porden-scripted-test' });
      try {
        const draft = await client.createDraft({ recipientOrigin: courierOrigin, caseType: 'delivery_damage', data: { orderReference: 'DEMO-1042', damageDescription: 'Vase damaged in transit' }, governance: { handoffId: id, version: v } });
        const outcome = await client.transfer({ transferId: draft.id, approvedFields: ['orderReference', 'damageDescription'], confirm: async () => true });
        return { draftId: draft.id, outcome };
      } catch (error) {
        return { error: (error as { code?: string }).code ?? String(error) };
      }
    },
    [handoffId, version, origins.courier] as const,
  );
  if (popup === 'none') return running;
  const reviewed = await Promise.race([
    s.merchant.getByRole('heading', { name: 'Review the approved courier transfer', exact: true }).waitFor({ timeout: 20_000 }).then(() => true),
    running.then(() => false),
  ]);
  if (!reviewed) return running;
  await s.merchant.getByRole('button', { name: 'Confirm actions', exact: true }).click();
  const opened = s.merchant.waitForEvent('popup');
  await s.merchant.getByRole('button', { name: 'Open action site', exact: true }).click();
  const bridge = await opened;
  await bridge.getByRole('button', { name: 'Confirm actions', exact: true }).click();
  return running;
}
async function complete(s: Session, handoffId: string, version: number) {
  return claimTurn(s.courier, { task: 'complete_claim', handoffId, version });
}
const handoffOf = (turn: Record<string, any>) => turn.outcome.result.handoff.id as string;
const payload = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

// ---------- default agent scripts ----------
const merchantFiles = (args: Record<string, unknown>): Script => ({
  file_claim: (_input, ref) => action('merchant_file_claim', ref, { damageDescription: 'Vase damaged in transit', ...args }),
  answer_clarification: (input, ref) =>
    action('merchant_answer_clarification', ref, {
      handoffId: input.handoffId,
      version: input.version,
      clarificationId: (input.clarification as { id: string }).id,
      response: 'Customer uploaded a photo of the damage.',
    }),
});
const courierFollowsPolicy: Script = {
  review_claim: (input, ref) => {
    const evaluation = input.evaluation as { allowed: Array<Record<string, any>> };
    const counter = evaluation.allowed.find((item) => item.decision === 'counter' && item.resolution.remedy === 'partial_refund');
    const choice = counter ?? evaluation.allowed[0];
    const args: Record<string, unknown> = { handoffId: input.handoffId, version: input.version, decision: choice.decision, reason: 'Per the courier claims policy.' };
    if (choice.decision === 'clarify') args.missingInformation = choice.missingInformation;
    if (choice.decision === 'counter') args.remedy = choice.resolution.remedy;
    return action('courier_claim_decision', ref, args);
  },
  complete_claim: (input, ref) =>
    action('courier_claim_decision', ref, { handoffId: input.handoffId, version: input.version, decision: 'complete', reason: 'Case created; resolution recorded.' }),
};

async function scenario(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, ms: Date.now() - started });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false, error: error instanceof Error ? error.stack : String(error), ms: Date.now() - started });
    console.error('FAIL', name, error);
  }
  writeFileSync(resolve(proof, 'results.json'), JSON.stringify({ model, results }, null, 2));
}

try {
  await scenario('B1 routine claim: browser agents, SDK transfer via bridge, receipt with resolution, completion', async () => {
    const s = await session({ ...merchantFiles({ photoProvided: true, remedy: 'partial_refund', partialRefundMinor: 3_000 }), ...courierFollowsPolicy });
    try {
      const before = await stack.caseCount();
      const filed = await fileClaim(s, 'Chipped rim, photo attached, $30 back please.');
      assert.equal(filed.outcome.status, 'succeeded');
      assert.match(filed.shown, /merchant_file_claim/);
      const id = handoffOf(filed);
      const inbox = await courierClient<Record<string, any>>(s.courier, 'inbox', { limit: 50 });
      assert.equal(inbox.items.find((item: any) => item.handoff.id === id)?.stage, 'review');
      const decided = await review(s, id);
      assert.equal(decided.outcome.status, 'succeeded');
      assert.equal(decided.turn.arguments.decision, 'accept');
      const sent = (await transfer(s, id, 1)) as Record<string, any>;
      assert.equal(sent.outcome?.status, 'accepted', JSON.stringify(sent));
      assert.equal(await stack.caseCount(), before + 1);
      // Cross-site: the courier network was loaded from the courier origin and its claim actions stay private.
      const trace = await s.merchant.evaluate(() => {
        const engine = (window as unknown as { __transferEngine: any }).__transferEngine;
        return { events: engine.trace.export().events, actions: [...engine.actions.entries.values()].map((entry: any) => `${new URL(entry.base).origin}#${entry.name}`) };
      });
      assert.ok(trace.events.some((event: any) => event.kind === 'remote_call' && event.phase === 'end' && event.status === 'ok'));
      assert.ok(trace.actions.includes(`${origins.courier}#create_damage_case`));
      assert.ok(!trace.actions.some((name: string) => name.endsWith('#courier_claim_decision')), 'courier claim actions must not be exposed cross-site');
      const [row] = await stack.courierSql`SELECT r.signed_jws FROM receipts r ORDER BY r.issued_at DESC LIMIT 1`;
      assert.deepEqual(payload(row.signed_jws).resolution, { remedy: 'partial_refund', amountMinor: 3_000, currency: 'USD' });
      const done = await complete(s, id, 1);
      assert.equal(done.outcome.status, 'succeeded');
      assert.equal((await stack.courierPlatform.getHandoff(id)).status, 'completed');
      assert.deepEqual(s.errors, []);
      await s.merchant.screenshot({ path: resolve(proof, 'b1-merchant.png'), fullPage: true });
    } finally {
      await s.context.close();
    }
  });

  await scenario('B2 counter-offer: v2 approved, stale v1 consent refused, v2 executed through the bridge', async () => {
    const s = await session({ ...merchantFiles({ photoProvided: true, remedy: 'full_refund' }), ...courierFollowsPolicy });
    try {
      const filed = await fileClaim(s, 'Vase shattered, photo uploaded, full refund.');
      const id = handoffOf(filed);
      const countered = await review(s, id);
      assert.equal(countered.turn.arguments.decision, 'counter');
      assert.equal(countered.outcome.status, 'succeeded');
      const view = await merchantClient<Record<string, any>>(s.merchant, 'claim', id);
      assert.deepEqual(view.versions.map((item: any) => item.parameters.resolution.amountMinor), [8_000, 5_000]);
      const state = await stack.courierPlatform.getHandoff(id);
      await stack.approver.decideRevision(id, state.revisions[0].id, { requestId: crypto.randomUUID(), version: 2, decision: 'approved' });
      assert.equal((await review(s, id)).turn.arguments.decision, 'accept');
      const before = await stack.caseCount();
      const stale = (await transfer(s, id, 1, 'none')) as Record<string, any>;
      assert.equal(stale.error, 'REQUEST_CONFLICT', JSON.stringify(stale));
      assert.equal(await stack.caseCount(), before);
      const sent = (await transfer(s, id, 2)) as Record<string, any>;
      assert.equal(sent.outcome?.status, 'accepted', JSON.stringify(sent));
      const [row] = await stack.courierSql`SELECT r.signed_jws FROM receipts r ORDER BY r.issued_at DESC LIMIT 1`;
      assert.deepEqual(payload(row.signed_jws).governance, { handoffId: id, version: 2 });
      assert.equal(payload(row.signed_jws).resolution.amountMinor, 5_000);
      assert.equal((await complete(s, id, 2)).outcome.status, 'succeeded');
    } finally {
      await s.context.close();
    }
  });

  await scenario('B3 clarification answered by the merchant agent in the browser', async () => {
    const s = await session({ ...merchantFiles({ photoProvided: false, remedy: 'partial_refund', partialRefundMinor: 4_000 }), ...courierFollowsPolicy });
    try {
      const id = handoffOf(await fileClaim(s, 'Cracked, refund $40.'));
      const asked = await review(s, id);
      assert.equal(asked.turn.arguments.decision, 'clarify');
      const view = await merchantClient<Record<string, any>>(s.merchant, 'claim', id);
      const clarification = view.handoff.clarifications[0];
      const answered = await claimTurn(s.merchant, { task: 'answer_clarification', customerMessage: 'Uploaded a photo.', handoffId: id, version: 1, clarification: { id: clarification.id, missingInformation: clarification.missingInformation, reason: clarification.reason } });
      assert.equal(answered.outcome.status, 'succeeded');
      assert.equal((await review(s, id)).turn.arguments.decision, 'accept');
    } finally {
      await s.context.close();
    }
  });

  await scenario('B4 adversarial courier model: out-of-policy, wrong handoff and wrong action never take effect', async () => {
    let mode = 'accept-over-cover';
    const s = await session({
      ...merchantFiles({ photoProvided: true, remedy: 'full_refund' }),
      review_claim: (input, ref) => {
        if (mode === 'wrong-handoff') return action('courier_claim_decision', ref, { handoffId: crypto.randomUUID(), version: input.version, decision: 'accept', reason: 'x' });
        if (mode === 'wrong-action') return action('porden_handoff', ref, { operation: 'accept', handoffId: input.handoffId, version: input.version });
        return action('courier_claim_decision', ref, { handoffId: input.handoffId, version: input.version, decision: 'accept', reason: 'Generous' });
      },
    });
    try {
      const id = handoffOf(await fileClaim(s, 'Shattered; full refund.'));
      const before = await stack.courierPlatform.getHandoff(id);
      const refused = await review(s, id);
      assert.equal(refused.outcome.status, 'refused');
      assert.equal(refused.outcome.code, 'POLICY_VIOLATION');
      mode = 'wrong-handoff';
      assert.deepEqual((await review(s, id)).turn.reason, 'WRONG_HANDOFF');
      mode = 'wrong-action';
      assert.equal((await review(s, id)).turn.kind, 'invalid');
      const after = await stack.courierPlatform.getHandoff(id);
      assert.equal(after.status, 'approved');
      assert.equal(after.receipts.length, before.receipts.length);
    } finally {
      await s.context.close();
    }
  });

  await scenario('B5 adversarial merchant model: invented amount refused; unconsented address cancelled at review', async () => {
    let mode = 'overpriced';
    const s = await session({
      file_claim: (_input, ref) =>
        mode === 'overpriced'
          ? action('merchant_file_claim', ref, { damageDescription: 'Vase damaged', photoProvided: true, remedy: 'partial_refund', partialRefundMinor: 9_000 })
          : action('merchant_file_claim', ref, { damageDescription: 'Vase damaged', photoProvided: true, remedy: 'reship', deliveryAddress: '1 Synthetic Street, Test City' }),
    });
    try {
      const before = (await stack.courierPlatform.listHandoffs({ direction: 'received', limit: 100 })).total;
      const overpriced = await fileClaim(s, 'Damaged.');
      assert.equal(overpriced.outcome.status, 'refused');
      assert.equal(overpriced.outcome.code, 'INVALID_INPUT');
      mode = 'address';
      const order = await merchantClient(s.merchant, 'order', 'DEMO-1042');
      const courierPolicy = await merchantClient(s.merchant, 'courierPolicy', origins.courier);
      const cancelled = await claimTurn(s.merchant, { task: 'file_claim', customerMessage: 'Please replace it.', order, courierPolicy }, 'cancel');
      assert.match(cancelled.shown, /Synthetic Street/, 'the review must show the address before sharing');
      assert.equal(cancelled.outcome.status, 'cancelled');
      assert.equal((await stack.courierPlatform.listHandoffs({ direction: 'received', limit: 100 })).total, before);
    } finally {
      await s.context.close();
    }
  });

  await scenario('B6 cross-site boundaries: CORS policy read, no credentialed cross-site reads or writes', async () => {
    const s = await session({});
    try {
      const policy = await merchantClient<Record<string, any>>(s.merchant, 'courierPolicy', origins.courier);
      assert.equal(policy.id, 'courier-claims-2026-11');
      const probes = await s.merchant.evaluate(async (courier) => {
        const attempt = async (path: string, init?: RequestInit) => {
          try {
            const response = await fetch(courier + path, init);
            return `HTTP ${response.status}`;
          } catch {
            return 'blocked';
          }
        };
        return {
          credentialedPolicy: await attempt('/api/v1/claim-policy', { credentials: 'include' }),
          inbox: await attempt('/api/v1/claims', { credentials: 'include' }),
          decision: await attempt(`/api/v1/claims/${crypto.randomUUID()}/decisions`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        };
      }, origins.courier);
      assert.equal(probes.credentialedPolicy, 'blocked');
      assert.equal(probes.inbox, 'blocked');
      assert.equal(probes.decision, 'blocked');
    } finally {
      await s.context.close();
    }
  });

  await scenario('B7 interrupted execution in the browser: lost courier response reconciled without a second write', async () => {
    const s = await session({ ...merchantFiles({ photoProvided: true, remedy: 'partial_refund', partialRefundMinor: 2_000 }), ...courierFollowsPolicy }, async (context) => {
      let dropped = false;
      await context.route(`${origins.courier}/api/v1/cases`, async (route: Route) => {
        const response = await route.fetch();
        if (!dropped && response.status() === 201) {
          dropped = true;
          return route.abort('failed');
        }
        return route.fulfill({ response });
      });
    });
    try {
      const id = handoffOf(await fileClaim(s, 'Small chip, $20 back.'));
      await review(s, id);
      const before = await stack.caseCount();
      const sent = (await transfer(s, id, 1)) as Record<string, any>;
      assert.equal(sent.outcome?.status, 'unknown', JSON.stringify(sent));
      assert.equal(await stack.caseCount(), before + 1);
      const reconciled = await s.merchant.evaluate(async (transferId) => {
        const w = window as unknown as { __claims: { createPordenClient(o: unknown): { reconcile(id: string): Promise<{ status: string }> } } };
        return (await w.__claims.createPordenClient({ model: 'porden-scripted-test' }).reconcile(transferId)).status;
      }, sent.draftId);
      assert.equal(reconciled, 'accepted');
      assert.equal(await stack.caseCount(), before + 1);
      assert.equal((await complete(s, id, 1)).outcome.status, 'succeeded');
    } finally {
      await s.context.close();
    }
  });

  await scenario('B8 receipt verifier: same-origin and cross-origin checks from the browser, tampering detected', async () => {
    const s = await session({});
    try {
      const [row] = await stack.courierSql`SELECT signed_jws FROM receipts ORDER BY issued_at DESC LIMIT 1`;
      const receipt: string = row.signed_jws;
      const [header, body, signature] = receipt.split('.');
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
      const tampered = `${header}.${Buffer.from(JSON.stringify({ ...claims, caseId: 'COU-FORGED' })).toString('base64url')}.${signature}`;
      const checks = await s.merchant.evaluate(
        async ([token, forged, courier]) => {
          const w = window as unknown as { __claims: { verifyReceipt(r: string, o?: string): Promise<any> } };
          const sameOrigin = await w.__claims.verifyReceipt(token);
          const crossOrigin = await w.__claims.verifyReceipt(token, courier);
          const forgedResult = await w.__claims.verifyReceipt(forged);
          return { sameOrigin, crossOrigin, forgedResult };
        },
        [receipt, tampered, origins.courier] as const,
      );
      for (const result of [checks.sameOrigin, checks.crossOrigin]) {
        assert.equal(result.valid, true);
        assert.equal(result.issuer, origins.courier);
        assert.equal(result.receipt.kind, 'delivery_case');
        assert.equal(result.receipt.claims.caseId, claims.caseId);
      }
      assert.deepEqual(checks.forgedResult, { valid: false, reasonCode: 'SIGNATURE_INVALID' });
    } finally {
      await s.context.close();
    }
  });
} finally {
  await browser.close();
  for (const proc of processes)
    if (proc.exitCode === null) {
      const exited = once(proc, 'exit');
      proc.kill();
      await exited;
    }
  for (const server of servers) await server.stop(true);
  await stack.close();
}
const failures = results.filter((item) => !item.passed);
console.log(`${results.length - failures.length} passed; ${failures.length} failed; evidence: ${proof}`);
if (failures.length) process.exitCode = 1;
