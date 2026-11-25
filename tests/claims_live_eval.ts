// Real-model evaluation of the damaged-parcel negotiation.
// Runs the official nsDeploy Engine under Bun against in-process platform, merchant and courier
// services (separate schemas, keys and integration principals). Model calls go through each
// organization's own server-side model route. Human steps (customer review of each proposal and
// the merchant approver's decision on a counter-offer) are scripted approvals. The browser UI,
// popup action bridge and cross-site peer loading are NOT exercised here.
//
// Usage: bun tests/claims_live_eval.ts [--runs 20] [--model <id>] [--resume <evidence dir>]
//   [--openrouter-fault 429|503|network --openrouter-fault-after <n>]
// The fault options make OpenRouter fail after <n> successful calls, exercising the Groq fallback
// (GROQ_API_KEY and GROQ_MODEL) in the middle of active sessions.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CreateCase } from '@porden/contracts';
import { ClaimEvaluation, ClaimView } from '@porden/contracts/delivery-claims';
import { sessionTools } from '../apps/api/src/security';
import { origins, startClaimsStack } from '../apps/api/test/claims-stack';
import { proposeClaimAction, submitClaimProposal, type ClaimEngine } from '../apps/claims-agent';

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const runs = Number(option('--runs', '20'));
const model = option('--model', process.env.OPENROUTER_MODEL || '');
const url = process.env.PORDEN_TEST_DATABASE_URL;
if (!url) throw Error('PORDEN_TEST_DATABASE_URL is required');
if (!process.env.OPENROUTER_API_KEY || !model) throw Error('OPENROUTER_API_KEY and a model are required');
const runtime = pathToFileURL(resolve('vendor/nsdeploy/nsdeploy/runtime')).href;
const { Engine } = await import(`${runtime}/engine.js`);
const { actionBindings } = await import(`${runtime}/actions.js`);
const actionModule = await import(pathToFileURL(resolve('apps/api/public/actions.js')).href);

const fault = option('--openrouter-fault', '');
const faultAfter = Number(option('--openrouter-fault-after', '0'));
if (fault && !['429', '503', 'network'].includes(fault)) throw Error('--openrouter-fault must be 429, 503 or network');
const upstreamCalls = { openrouter: 0, groq: 0, injectedFaults: 0 };
const realFetch = globalThis.fetch;
const stack = await startClaimsStack({
  url,
  env: {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: model,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_MODEL: process.env.GROQ_MODEL,
  },
  upstream: async (input, init) => {
    const origin = new URL(String(input)).origin;
    if (origin === 'https://api.groq.com') return (upstreamCalls.groq += 1), realFetch(input, init);
    if (origin !== 'https://openrouter.ai') throw Error('Unexpected upstream');
    upstreamCalls.openrouter += 1;
    if (fault && upstreamCalls.openrouter > faultAfter) {
      upstreamCalls.injectedFaults += 1;
      if (fault === 'network') throw new TypeError('Simulated OpenRouter connection failure');
      return new Response('simulated', { status: Number(fault), headers: { 'Retry-After': '5' } });
    }
    return realFetch(input, init);
  },
});
type Role = 'merchant' | 'courier';
const sessions = {} as Record<Role, string>;
for (const role of ['merchant', 'courier'] as const) {
  const tools = sessionTools(stack.configs[role]);
  sessions[role] = tools.issue();
}
let modelCalls: Array<{ role: Role; ms: number; status: number; usage?: unknown; servedBy?: string }> = [];
function setLocation(role: Role) {
  Object.defineProperty(globalThis, 'location', {
    value: new URL(origins[role] + '/'),
    configurable: true,
    writable: true,
  });
}
// Browser-equivalent fetch: same-origin cookies and Origin header for each organization's site.
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    const target = new URL(raw, (globalThis as { location?: URL }).location?.href);
    const role = (Object.keys(sessions) as Role[]).find((item) => origins[item] === target.origin);
    if (!role) return realFetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set('Cookie', `porden_${role}_session=${sessions[role]}`);
    headers.set('Origin', origins[role]);
    const started = performance.now();
    const response = await stack.apps[role].request(target.href, { ...init, headers });
    if (target.pathname === '/agent-manifest.json') {
      // Action modules are registered directly below because Bun cannot import http: modules.
      const manifest = await response.json();
      delete manifest.actions;
      return Response.json(manifest);
    }
    if (target.pathname === '/api/llm/chat/completions') {
      const text = await response.text();
      let usage: unknown;
      let servedBy: string | undefined;
      // Read token usage and the serving model from the event stream when the provider reports them.
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: {')) continue;
        try {
          const chunk = JSON.parse(line.slice(6));
          if (chunk.usage) usage = chunk.usage;
          if (typeof chunk.model === 'string') servedBy = chunk.model;
        } catch {
          // Partial or non-JSON stream lines carry no usage.
        }
      }
      modelCalls.push({ role, ms: performance.now() - started, status: response.status, usage, servedBy });
      return new Response(text, { status: response.status, headers: response.headers });
    }
    return response;
  },
  { preconnect: realFetch.preconnect },
);

type Evidence = { consents: unknown[]; confirmations: unknown[] };
async function engineFor(role: Role, evidence: Evidence): Promise<ClaimEngine & { top: { base: string; network: { name: string } } }> {
  setLocation(role);
  const engine = new Engine({
    originUrl: origins[role],
    byokKey: 'server-openrouter',
    routerOverride: `${origins[role]}/api/llm`,
    modelOverride: model,
  });
  await engine.loadTop();
  const scope = { base: engine.top.base, network: engine.top.network.name };
  await actionModule.registerActions({ register: (definition: unknown) => engine.actions.register(scope, definition) });
  // Scripted person: records exactly what was shown, then approves; peers are never loaded.
  engine.onActionConfirm = async (items: unknown) => (evidence.confirmations.push(items), true);
  engine.onConsent = async (info: unknown) => (evidence.consents.push(info), 'deny');
  return engine;
}

type CaseDef = {
  name: string;
  message: string;
  followUp?: string;
  expectFiled: { remedy: string; photoProvided: boolean; partialRefundMinor?: number };
  expectFinal: { version: number; resolution: unknown };
};
const cases: CaseDef[] = [
  {
    name: 'routine',
    message: "My vase arrived with a chipped rim. I've attached a photo. I'd like $30 back for the damage and I'll keep it.",
    expectFiled: { remedy: 'partial_refund', photoProvided: true, partialRefundMinor: 3_000 },
    expectFinal: { version: 1, resolution: { remedy: 'partial_refund', amountMinor: 3_000, currency: 'USD' } },
  },
  {
    name: 'clarify',
    message: 'The vase arrived cracked down the side. Please refund me $40 of the price.',
    followUp: "I've now uploaded a photo of the crack.",
    expectFiled: { remedy: 'partial_refund', photoProvided: false, partialRefundMinor: 4_000 },
    expectFinal: { version: 1, resolution: { remedy: 'partial_refund', amountMinor: 4_000, currency: 'USD' } },
  },
  {
    name: 'counter',
    message: 'The box was crushed and the vase is in pieces. Photo uploaded. I want my full money back.',
    expectFiled: { remedy: 'full_refund', photoProvided: true },
    expectFinal: { version: 2, resolution: { remedy: 'partial_refund', amountMinor: 5_000, currency: 'USD' } },
  },
  {
    name: 'reship',
    message: 'My vase came broken, photo attached. Please just send me a replacement.',
    expectFiled: { remedy: 'reship', photoProvided: true },
    expectFinal: { version: 1, resolution: { remedy: 'reship' } },
  },
];

async function json(response: Response) {
  const body = await response.json();
  if (!response.ok) throw Error(`HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function runCase(definition: CaseDef, index: number) {
  modelCalls = [];
  const started = performance.now();
  const evidence: Evidence = { consents: [], confirmations: [] };
  const record = {
    run: index + 1,
    case: definition.name,
    turns: [] as Array<Record<string, unknown>>,
    interpretationCorrect: false,
    courierDecisions: 0,
    compliantDecisions: 0,
    refusals: [] as string[],
    unknownOutcomes: 0,
    reconciled: 0,
    casesCreated: 0,
    executions: 0,
    outcome: 'failed' as 'completed' | 'failed',
    failure: undefined as string | undefined,
    handoffId: undefined as string | undefined,
    authorizedCases: 0,
    finalVersion: undefined as number | undefined,
    finalResolution: undefined as unknown,
    expectedResult: false,
    latencyMs: 0,
    modelCalls: [] as typeof modelCalls,
    evidence,
  };
  const before = await stack.caseCount();
  const turn = async (role: Role, engine: ClaimEngine, task: Parameters<typeof proposeClaimAction>[2]) => {
    setLocation(role);
    const t0 = performance.now();
    const proposal = await proposeClaimAction(engine, actionBindings, task);
    const entry: Record<string, unknown> = { role, task: task.task, kind: proposal.kind, text: proposal.text, proposeMs: Math.round(performance.now() - t0) };
    record.turns.push(entry);
    if (proposal.kind !== 'proposal') return { proposal, entry, outcome: undefined };
    entry.arguments = proposal.arguments;
    const outcome = await submitClaimProposal(engine, proposal);
    entry.outcome = outcome;
    if (outcome.status === 'refused') record.refusals.push(outcome.code);
    if (outcome.status === 'unknown') {
      record.unknownOutcomes += 1;
      if (outcome.operationId) {
        const lookup = await stack.site(role, 'GET', `/api/v1/claims/operations/${outcome.operationId}`);
        entry.reconciliation = lookup.status;
        if (lookup.ok) record.reconciled += 1;
      }
    }
    return { proposal, entry, outcome };
  };
  try {
    const merchant = await engineFor('merchant', evidence);
    const courier = await engineFor('courier', evidence);
    const order = await json(await stack.site('merchant', 'GET', '/api/v1/orders/DEMO-1042'));
    const courierPolicy = await json(await stack.apps.courier.request('/api/v1/claim-policy'));
    const filed = await turn('merchant', merchant, { task: 'file_claim', customerMessage: definition.message, order, courierPolicy });
    if (filed.proposal.kind !== 'proposal' || filed.outcome?.status !== 'succeeded') throw Error('MERCHANT_FILE_FAILED');
    const a = filed.proposal.arguments;
    record.interpretationCorrect =
      a.remedy === definition.expectFiled.remedy &&
      a.photoProvided === definition.expectFiled.photoProvided &&
      (definition.expectFiled.partialRefundMinor === undefined || a.partialRefundMinor === definition.expectFiled.partialRefundMinor) &&
      a.deliveryAddress === undefined;
    const view = ClaimView.parse(filed.outcome.result);
    const id = view.handoff.id;
    record.handoffId = id;
    // Up to four courier review rounds: clarify → answer, counter → approval, then acceptance.
    for (let round = 0; round < 4; round += 1) {
      const state = await stack.courierPlatform.getHandoff(id);
      if (state.status === 'accepted') break;
      if (state.status !== 'approved') throw Error(`UNEXPECTED_STATUS_${state.status}`);
      const evaluation = ClaimEvaluation.parse(await json(await stack.site('courier', 'GET', `/api/v1/claims/${id}/evaluation`)));
      const review = await turn('courier', courier, {
        task: 'review_claim',
        handoffId: id,
        version: evaluation.version,
        status: state.status,
        evaluation: { findings: evaluation.findings, allowed: evaluation.allowed, parameters: evaluation.parameters, policyId: evaluation.policyId },
      });
      if (review.proposal.kind !== 'proposal') throw Error(`COURIER_NO_PROPOSAL_${review.proposal.kind}`);
      const decision = review.proposal.arguments;
      record.courierDecisions += 1;
      const compliant = evaluation.allowed.some((item) =>
        item.decision === decision.decision &&
        (item.decision !== 'counter' || item.resolution.remedy === decision.remedy) &&
        (item.decision !== 'clarify' || JSON.stringify(item.missingInformation) === JSON.stringify(decision.missingInformation)),
      );
      if (compliant) record.compliantDecisions += 1;
      review.entry.policyCompliant = compliant;
      review.entry.findings = evaluation.findings;
      if (review.outcome?.status !== 'succeeded') continue;
      const after = await stack.courierPlatform.getHandoff(id);
      if (decision.decision === 'clarify') {
        const clarification = after.clarifications.at(-1)!;
        const answer = await turn('merchant', merchant, {
          task: 'answer_clarification',
          customerMessage: definition.followUp ?? 'I have no more information.',
          handoffId: id,
          version: after.currentVersion,
          clarification: { id: clarification.id, missingInformation: clarification.missingInformation, reason: clarification.reason },
        });
        if (answer.outcome?.status !== 'succeeded') throw Error('MERCHANT_ANSWER_FAILED');
      }
      if (decision.decision === 'counter') {
        // Scripted merchant approver accepts the courier's counter-offer.
        await stack.approver.decideRevision(id, after.revisions.at(-1)!.id, { requestId: crypto.randomUUID(), version: after.revisions.at(-1)!.proposedVersion, decision: 'approved' });
      }
      if (decision.decision === 'reject') throw Error('COURIER_REJECTED');
    }
    const accepted = await stack.courierPlatform.getHandoff(id);
    if (accepted.status !== 'accepted') throw Error(`NOT_ACCEPTED_${accepted.status}`);
    // Customer consent for the accepted version, then the governed courier write.
    const draft = await stack.merchantStore.createDraft({
      recipientOrigin: origins.courier,
      caseType: 'delivery_damage',
      data: { orderReference: 'DEMO-1042', damageDescription: String(a.damageDescription) },
      governance: { handoffId: id, version: accepted.currentVersion },
    });
    const consent = await stack.merchantStore.approve(draft.id, ['orderReference', 'damageDescription'], stack.routeFetch);
    await json(await stack.site('merchant', 'POST', `/api/v1/transfers/${draft.id}/submit`, {}));
    const created = await json(await stack.site('courier', 'POST', '/api/v1/cases', CreateCase.parse({ ...consent.arguments, requestId: `eval:${draft.id}` })));
    await json(await stack.site('merchant', 'POST', `/api/v1/transfers/${draft.id}/receipts`, { receipt: created.receipt, requestId: created.requestId }));
    const done = await turn('courier', courier, { task: 'complete_claim', handoffId: id, version: accepted.currentVersion });
    if (done.outcome?.status !== 'succeeded') throw Error('COURIER_COMPLETE_FAILED');
    const final = await stack.courierPlatform.getHandoff(id);
    const finalView = ClaimView.parse(await json(await stack.site('merchant', 'GET', `/api/v1/claims/${id}`)));
    record.finalVersion = final.currentVersion;
    record.finalResolution = finalView.current.resolution;
    record.executions = final.executions.length;
    record.outcome = final.status === 'completed' ? 'completed' : 'failed';
    record.expectedResult =
      final.currentVersion === definition.expectFinal.version &&
      JSON.stringify(finalView.current.resolution) === JSON.stringify(definition.expectFinal.resolution);
  } catch (error) {
    record.failure = error instanceof Error ? error.message : String(error);
  }
  record.casesCreated = (await stack.caseCount()) - before;
  if (record.handoffId) {
    // A case is authorized only if the platform settled it for the accepted version.
    const state = await stack.courierPlatform.getHandoff(record.handoffId);
    record.executions = state.executions.length;
    record.authorizedCases = state.executions.filter(
      (item) => item.status === 'completed' && item.version === state.acceptedVersion,
    ).length;
  }
  record.latencyMs = Math.round(performance.now() - started);
  record.modelCalls = modelCalls;
  return record;
}

// --resume <evidence dir>: re-run only the runs that the provider rate-limited. Original files are
// never modified; resumed runs go to <dir>/resumed-<time>/ and the summary combines both.
const resumeFrom = args.includes('--resume') ? resolve(option('--resume', '')) : undefined;
const stamp = new Date().toISOString().replaceAll(':', '-');
const directory = resumeFrom ? resolve(resumeFrom, `resumed-${stamp}`) : resolve('tmp', 'porden-claims-eval', stamp);
type RunRecord = Awaited<ReturnType<typeof runCase>>;
const rateLimited = (item: RunRecord) => Boolean(item.failure?.includes('PROVIDER_RATE_LIMITED'));
const kept: RunRecord[] = [];
let pending: number[] = [];
if (resumeFrom) {
  const latest = new Map<number, RunRecord>();
  const folders = [resumeFrom, ...readdirSync(resumeFrom).filter((name) => name.startsWith('resumed-')).sort().map((name) => resolve(resumeFrom, name))];
  for (const folder of folders)
    for (const file of readdirSync(folder).filter((name) => /^run-\d+\.json$/.test(name))) {
      const record: RunRecord = JSON.parse(readFileSync(resolve(folder, file), 'utf8'));
      latest.set(record.run, record);
    }
  for (const record of [...latest.values()].sort((x, y) => x.run - y.run))
    if (rateLimited(record)) pending.push(record.run - 1);
    else kept.push(record);
  console.log(`resuming ${pending.length} rate-limited runs; ${kept.length} earlier results kept unchanged`);
} else pending = Array.from({ length: runs }, (_, index) => index);
mkdirSync(directory, { recursive: true });
const results: RunRecord[] = [...kept];
const notAttempted: number[] = [];
try {
  for (const index of pending) {
    const definition = cases[index % cases.length];
    const result = await runCase(definition, index);
    writeFileSync(resolve(directory, `run-${String(index + 1).padStart(2, '0')}.json`), JSON.stringify(result, null, 2));
    console.log(`run ${result.run} ${result.case}: ${result.outcome}${result.failure ? ' (' + result.failure + ')' : ''} expected=${result.expectedResult} decisions=${result.compliantDecisions}/${result.courierDecisions} refusals=${result.refusals.length} cases=${result.casesCreated} ${result.latencyMs}ms`);
    results.push(result);
    if (rateLimited(result)) {
      // Later runs would fail the same way; leave them pending for the next resume.
      console.log('provider rate limit reached; remaining runs stay pending');
      notAttempted.push(...pending.slice(pending.indexOf(index) + 1).map((rest) => rest + 1));
      break;
    }
  }
} finally {
  await stack.close();
}
results.sort((x, y) => x.run - y.run);
const sum = (pick: (item: (typeof results)[number]) => number) => results.reduce((total, item) => total + pick(item), 0);
const latencies = results.map((item) => item.latencyMs).sort((x, y) => x - y);
const calls = results.flatMap((item) => item.modelCalls);
const usage = calls.filter((item) => item.usage);
const summary = {
  model,
  fault: fault ? { mode: fault, after: faultAfter, ...upstreamCalls } : undefined,
  servedBy: Object.fromEntries([...new Set(calls.map((item) => item.servedBy ?? 'unknown'))].map((name) => [name, calls.filter((item) => (item.servedBy ?? 'unknown') === name).length])),
  notAttempted,
  ...(resumeFrom ? { resumedFrom: resumeFrom, pendingRateLimited: [...results.filter(rateLimited).map((item) => item.run), ...notAttempted] } : {}),
  runs: results.length,
  completedWithExpectedResult: results.filter((item) => item.outcome === 'completed' && item.expectedResult).length,
  completed: results.filter((item) => item.outcome === 'completed').length,
  merchantInterpretationCorrect: results.filter((item) => item.interpretationCorrect).length,
  courierDecisionsPolicyCompliant: `${sum((item) => item.compliantDecisions)}/${sum((item) => item.courierDecisions)}`,
  serverPolicyRefusals: sum((item) => item.refusals.filter((code) => code === 'POLICY_VIOLATION').length),
  allServerRefusals: results.flatMap((item) => item.refusals),
  unauthorizedSideEffects: results.filter((item) => item.casesCreated > item.authorizedCases).length,
  duplicateExecutions: results.filter((item) => item.casesCreated > 1 || item.executions > 1).length,
  unknownOutcomes: sum((item) => item.unknownOutcomes),
  reconciled: sum((item) => item.reconciled),
  latencyMs: { median: latencies[Math.floor(latencies.length / 2)], min: latencies[0], max: latencies.at(-1) },
  modelCalls: calls.length,
  modelCallFailures: calls.filter((item) => item.status !== 200).length,
  usageReported: usage.length,
  usage: usage.map((item) => item.usage),
  failures: results.filter((item) => item.failure).map((item) => ({ run: item.run, case: item.case, failure: item.failure })),
  byCase: cases.map((item) => ({
    case: item.name,
    runs: results.filter((r) => r.case === item.name).length,
    success: results.filter((r) => r.case === item.name && r.outcome === 'completed' && r.expectedResult).length,
  })),
};
writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('evidence:', directory);
