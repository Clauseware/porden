import { afterAll, beforeAll, expect, test } from 'bun:test';
import { CreateCase, type HandoffDetail } from '@porden/contracts';
import {
  ClaimConsentResponse,
  ClaimEvaluation,
  ClaimInbox,
  ClaimView,
  ExecutionRecovery,
  MerchantClaimList,
  type CourierClaimDecision,
  type FileClaim,
} from '@porden/contracts/delivery-claims';
import type { Config } from '../src/config';
import { createApp } from '../src/app';
import { courierClaims } from '../src/services/courier-claims';
import { merchantClaims } from '../src/services/merchant-claims';
import { sessionTools, signer, type Fetcher } from '../src/security';
import { origins, startClaimsStack, type ClaimsStack } from './claims-stack';

// Nine scripted negotiation scenarios across three independently configured services.
// The "agent" is a deterministic script that chooses (or deliberately violates) decisions.
const url = process.env.PORDEN_TEST_DATABASE_URL;
const integration = url ? test : test.skip;
let stack: ClaimsStack;
let merchantStore: ClaimsStack['merchantStore'],
  courierPlatform: ClaimsStack['courierPlatform'],
  approver: ClaimsStack['approver'],
  routeFetch: Fetcher,
  configs: Record<'merchant' | 'courier', Config>;
beforeAll(async () => {
  if (!url) return;
  stack = await startClaimsStack({ url });
  ({ merchantStore, courierPlatform, approver, routeFetch, configs } = stack);
});
afterAll(async () => {
  if (stack) await stack.close();
});
const site = (role: 'merchant' | 'courier', method: string, path: string, body?: unknown) =>
  stack.site(role, method, path, body);
const caseCount = () => stack.caseCount();
async function json<T>(response: Response, status = 200): Promise<T> {
  const body = await response.json();
  if (response.status !== status) throw Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}
const data = {
  orderReference: 'DEMO-1042' as const,
  damageDescription: 'Box crushed; vase cracked',
};
async function fileClaim(requested: FileClaim['requestedResolution'], photoProvided = true) {
  const body: FileClaim = {
    requestId: crypto.randomUUID(),
    data,
    approvedFields: ['orderReference', 'damageDescription'],
    photoProvided,
    requestedResolution: requested,
  };
  return ClaimView.parse(await json(await site('merchant', 'POST', '/api/v1/claims', body), 201));
}
// The demo order is a fragile vase declared at 80.00 USD; courier cover for fragile is 50.00 USD.
const partial = (amountMinor: number) => ({ remedy: 'partial_refund' as const, amountMinor });
const full = { remedy: 'full_refund' as const };
async function evaluation(id: string) {
  return ClaimEvaluation.parse(
    await json(await site('courier', 'GET', `/api/v1/claims/${id}/evaluation`)),
  );
}
type Decision = CourierClaimDecision extends infer D
  ? D extends unknown
    ? Omit<D, 'requestId' | 'version'>
    : never
  : never;
function decide(id: string, version: number, decision: Decision, requestId = crypto.randomUUID()) {
  return site('courier', 'POST', `/api/v1/claims/${id}/decisions`, {
    ...decision,
    requestId,
    version,
  });
}
/** The scripted courier agent: picks the first allowed decision, preferring the given remedy. */
function scriptedAgent(result: ClaimEvaluation, remedy?: 'partial_refund' | 'reship'): Decision {
  const choice =
    result.allowed.find(
      (item) => item.decision === 'counter' && item.resolution.remedy === remedy,
    ) ?? result.allowed[0];
  if (choice.decision === 'clarify')
    return {
      decision: 'clarify',
      missingInformation: choice.missingInformation,
      reason: 'Need a photo',
    };
  if (choice.decision === 'counter' && choice.resolution.remedy !== 'full_refund')
    return { decision: 'counter', remedy: choice.resolution.remedy, reason: 'Above our cover' };
  if (choice.decision === 'reject') return { decision: 'reject', reason: 'Outside policy' };
  return { decision: 'accept', reason: 'Within policy' };
}
/** Customer consent for the exact version, then the courier write governed by that version. */
async function execute(id: string, version: number, caseData = data) {
  const draft = await merchantStore.createDraft({
    recipientOrigin: origins.courier,
    caseType: 'delivery_damage',
    data: caseData,
    governance: { handoffId: id, version },
  });
  const consent = await merchantStore.approve(
    draft.id,
    ['orderReference', 'damageDescription'],
    routeFetch,
  );
  const args = CreateCase.parse({ ...consent.arguments, requestId: `claim:${draft.id}` });
  await json(await site('merchant', 'POST', `/api/v1/transfers/${draft.id}/submit`, {}));
  return { draft, response: await site('courier', 'POST', '/api/v1/cases', args) };
}
async function verifyAtMerchant(transferId: string, response: Response) {
  const result = await json<{ receipt: string; requestId: string }>(response, 201);
  const ack = await site('merchant', 'POST', `/api/v1/transfers/${transferId}/receipts`, {
    receipt: result.receipt,
    requestId: result.requestId,
  });
  return { ack, result };
}
async function complete(id: string, version: number) {
  return json<{ handoff: HandoffDetail }>(
    await decide(id, version, {
      decision: 'complete',
      reason: 'Case created and resolution recorded',
    }),
  );
}
function payload(token: string) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

integration(
  'S1 routine: within-policy claim is accepted as filed, executed and completed',
  async () => {
    const claim = await fileClaim(partial(4_000));
    expect(claim.handoff.status).toBe('approved'); // merchant policy authorizes automatically
    const result = await evaluation(claim.handoff.id);
    expect(result.findings).toEqual(['WITHIN_POLICY']);
    const accepted = await json<{ handoff: HandoffDetail }>(
      await decide(claim.handoff.id, 1, scriptedAgent(result)),
    );
    expect(accepted.handoff.status).toBe('accepted');
    const before = await caseCount();
    const { draft, response } = await execute(claim.handoff.id, 1);
    const { ack, result: created } = await verifyAtMerchant(draft.id, response);
    expect(ack.status).toBe(200);
    expect(payload(created.receipt).resolution).toEqual({
      remedy: 'partial_refund',
      amountMinor: 4_000,
      currency: 'USD',
    });
    expect(await caseCount()).toBe(before + 1);
    const done = await complete(claim.handoff.id, 1);
    expect(done.handoff.status).toBe('completed');
    expect(done.handoff.versions).toHaveLength(1);
  },
);

integration(
  'S2 clarification: missing photo blocks execution until the customer answers',
  async () => {
    const claim = await fileClaim(partial(4_000), false);
    const first = await evaluation(claim.handoff.id);
    expect(first.findings).toEqual(['PHOTO_REQUIRED']);
    expect(first.allowed.map((item) => item.decision)).not.toContain('accept');
    const asked = await json<{ handoff: HandoffDetail }>(
      await decide(claim.handoff.id, 1, scriptedAgent(first)),
    );
    const clarification = asked.handoff.clarifications[0];
    expect(clarification.missingInformation[0]).toStartWith('photo_of_damage');
    expect((await courierPlatform.getAuthorization(claim.handoff.id, 1)).eligible).toBe(false);
    const blocked = await decide(claim.handoff.id, 1, { decision: 'accept', reason: 'Skip photo' });
    expect(blocked.status).toBe(422);
    const resolved = await json<ClaimView>(
      await site('merchant', 'POST', `/api/v1/claims/${claim.handoff.id}/clarifications/resolve`, {
        requestId: crypto.randomUUID(),
        version: 1,
        clarificationId: clarification.id,
        response: 'Photo uploaded: damage-photo-1042.jpg',
      }),
    );
    expect(resolved.handoff.clarifications[0].response).toBeDefined();
    const second = await evaluation(claim.handoff.id);
    expect(second.findings).toEqual(['WITHIN_POLICY']);
    await json(await decide(claim.handoff.id, 1, scriptedAgent(second)));
    const { draft, response } = await execute(claim.handoff.id, 1);
    expect((await verifyAtMerchant(draft.id, response)).ack.status).toBe(200);
    expect((await complete(claim.handoff.id, 1)).handoff.status).toBe('completed');
  },
);

integration(
  'S3 counter-offer: over-cover claim becomes v2 with server terms, approved, executed',
  async () => {
    const claim = await fileClaim(full);
    const result = await evaluation(claim.handoff.id);
    expect(result.findings).toEqual(['REFUND_EXCEEDS_COVER']);
    const countered = await json<{ handoff: HandoffDetail }>(
      await decide(claim.handoff.id, 1, scriptedAgent(result, 'partial_refund')),
    );
    expect(countered.handoff.status).toBe('awaiting_approval');
    const view = ClaimView.parse(
      await json(await site('merchant', 'GET', `/api/v1/claims/${claim.handoff.id}`)),
    );
    expect(view.versions.map((item) => item.parameters.resolution)).toEqual([
      { remedy: 'full_refund', amountMinor: 8_000, currency: 'USD' },
      { remedy: 'partial_refund', amountMinor: 5_000, currency: 'USD' },
    ]);
    // Before human approval, v2 cannot be accepted or executed.
    expect(
      (await decide(claim.handoff.id, 2, { decision: 'accept', reason: 'early' })).status,
    ).toBe(409);
    const revision = countered.handoff.revisions[0];
    await approver.decideRevision(claim.handoff.id, revision.id, {
      requestId: crypto.randomUUID(),
      version: 2,
      decision: 'approved',
    });
    const next = await evaluation(claim.handoff.id);
    expect(next.version).toBe(2);
    expect(next.findings).toEqual(['WITHIN_POLICY']);
    await json(await decide(claim.handoff.id, 2, scriptedAgent(next)));
    const { draft, response } = await execute(claim.handoff.id, 2);
    const { ack, result: created } = await verifyAtMerchant(draft.id, response);
    expect(ack.status).toBe(200);
    expect(payload(created.receipt).resolution).toEqual(view.versions[1].parameters.resolution);
    expect(payload(created.receipt).governance).toEqual({
      handoffId: claim.handoff.id,
      version: 2,
    });
    expect((await complete(claim.handoff.id, 2)).handoff.status).toBe('completed');
  },
);

integration(
  'S4 merchant rejects the counter-offer: v1 stays current and v2 cannot execute',
  async () => {
    const claim = await fileClaim(full);
    const countered = await json<{ handoff: HandoffDetail }>(
      await decide(
        claim.handoff.id,
        1,
        scriptedAgent(await evaluation(claim.handoff.id), 'reship'),
      ),
    );
    const rejected = await approver.decideRevision(
      claim.handoff.id,
      countered.handoff.revisions[0].id,
      {
        requestId: crypto.randomUUID(),
        version: 2,
        decision: 'rejected',
      },
    );
    expect(rejected.handoff.status).toBe('approved');
    expect(rejected.handoff.currentVersion).toBe(1);
    const before = await caseCount();
    const v2 = await execute(claim.handoff.id, 2).catch((error: Error) => error);
    expect(v2).toBeInstanceOf(Error);
    expect(await caseCount()).toBe(before);
    expect((await decide(claim.handoff.id, 2, { decision: 'accept', reason: 'v2' })).status).toBe(
      409,
    );
  },
);

integration(
  'S5 policy compliance: out-of-policy agent decisions are refused with no side effect',
  async () => {
    const claim = await fileClaim(full);
    const before = await courierPlatform.getHandoff(claim.handoff.id);
    const violations: Decision[] = [
      { decision: 'accept', reason: 'Generous' },
      { decision: 'clarify', missingInformation: ['photo_of_damage'], reason: 'Not needed' },
    ];
    for (const decision of violations) {
      const response = await decide(claim.handoff.id, 1, decision);
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe('POLICY_VIOLATION');
    }
    // An agent cannot smuggle its own amount into a counter-offer.
    const forged = await site('courier', 'POST', `/api/v1/claims/${claim.handoff.id}/decisions`, {
      requestId: crypto.randomUUID(),
      version: 1,
      decision: 'counter',
      remedy: 'partial_refund',
      reason: 'x',
      amountMinor: 1,
    });
    expect(forged.status).toBe(400);
    const after = await courierPlatform.getHandoff(claim.handoff.id);
    expect(after.versions).toHaveLength(before.versions.length);
    expect(after.receipts).toHaveLength(before.receipts.length);
  },
);

integration('S6 execution must match the approved terms and accepted version', async () => {
  const claim = await fileClaim(partial(4_000));
  await json(await decide(claim.handoff.id, 1, scriptedAgent(await evaluation(claim.handoff.id))));
  const before = await caseCount();
  const altered = await execute(claim.handoff.id, 1, {
    ...data,
    damageDescription: 'Different damage text',
  }).catch((error: { code?: string }) => error);
  expect(altered).toMatchObject({ code: 'SCOPE_MISMATCH' });
  expect(await caseCount()).toBe(before);
  // A forged receipt claiming a different resolution is refused by the merchant.
  const { draft, response } = await execute(claim.handoff.id, 1);
  const created = await json<{ receipt: string; requestId: string }>(response, 201);
  const forged = signer(configs.courier).sign(
    { ...payload(created.receipt), resolution: { remedy: 'reship' } },
    'porden-receipt+jwt',
  );
  const refused = await site('merchant', 'POST', `/api/v1/transfers/${draft.id}/receipts`, {
    receipt: forged,
    requestId: created.requestId,
  });
  expect(refused.status).toBe(403);
  expect((await refused.json()).error.code).toBe('RECEIPT_INVALID');
  const genuine = await site('merchant', 'POST', `/api/v1/transfers/${draft.id}/receipts`, {
    receipt: created.receipt,
    requestId: created.requestId,
  });
  expect(genuine.status).toBe(200);
});

integration('S7 the courier cannot approve its own counter-offer', async () => {
  const claim = await fileClaim(full);
  const countered = await json<{ handoff: HandoffDetail }>(
    await decide(
      claim.handoff.id,
      1,
      scriptedAgent(await evaluation(claim.handoff.id), 'partial_refund'),
    ),
  );
  const attempt = await courierPlatform
    .decideRevision(claim.handoff.id, countered.handoff.revisions[0].id, {
      requestId: crypto.randomUUID(),
      version: 2,
      decision: 'approved',
    })
    .catch((error: { status?: number; code?: string }) => error);
  expect(attempt).toMatchObject({ status: 403, code: 'UNAUTHORIZED_ACTION' });
  expect((await courierPlatform.getHandoff(claim.handoff.id)).status).toBe('awaiting_approval');
});

integration('S8 stale versions are rejected after a counter-offer is approved', async () => {
  const claim = await fileClaim(full);
  const countered = await json<{ handoff: HandoffDetail }>(
    await decide(
      claim.handoff.id,
      1,
      scriptedAgent(await evaluation(claim.handoff.id), 'partial_refund'),
    ),
  );
  await approver.decideRevision(claim.handoff.id, countered.handoff.revisions[0].id, {
    requestId: crypto.randomUUID(),
    version: 2,
    decision: 'approved',
  });
  const stale = await decide(claim.handoff.id, 1, { decision: 'accept', reason: 'Old version' });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error.code).toBe('STALE_VERSION');
  const before = await caseCount();
  await json(await decide(claim.handoff.id, 2, { decision: 'accept', reason: 'Current' }));
  const v1 = await execute(claim.handoff.id, 1).catch((error: { code?: string }) => error);
  expect(v1).toMatchObject({ code: 'REQUEST_CONFLICT' });
  expect(await caseCount()).toBe(before);
});

integration(
  'S9 lost response on accept: outcome unknown, reconciled read-only, no duplicate',
  async () => {
    const claim = await fileClaim(partial(4_000));
    const requestId = crypto.randomUUID();
    let dropped = false;
    const lossy: Fetcher = async (input, init) => {
      const response = await routeFetch(input, init);
      if (!dropped && String(input).endsWith(`/handoffs/${claim.handoff.id}/accept`)) {
        dropped = true;
        throw new TypeError('connection reset after the platform committed');
      }
      return response;
    };
    const lost = await courierClaims(configs.courier, lossy)
      .decide(claim.handoff.id, {
        decision: 'accept',
        reason: 'Within policy',
        requestId,
        version: 1,
      })
      .catch((error: { code?: string; status?: number }) => error);
    expect(lost).toMatchObject({ status: 502 });
    expect(['OUTCOME_UNKNOWN', 'AUTHORIZATION_UNAVAILABLE']).toContain(
      (lost as { code: string }).code,
    );
    const reconciled = await courierPlatform.reconcileOperation(requestId);
    expect(reconciled.handoff.status).toBe('accepted');
    // Replaying the same request ID returns the original receipt instead of a second acceptance.
    const replay = await json<{ receipt: { receiptId: string } }>(
      await decide(claim.handoff.id, 1, { decision: 'accept', reason: 'Within policy' }, requestId),
    );
    expect(replay.receipt.receiptId).toBe(reconciled.receipt.receiptId);
    const state = await courierPlatform.getHandoff(claim.handoff.id);
    expect(state.receipts.filter((item) => item.action === 'accepted')).toHaveLength(1);
  },
);

integration(
  'customer consent and merchant pricing: unconsented fields and invented amounts are refused',
  async () => {
    const response = await site('merchant', 'POST', '/api/v1/claims', {
      requestId: crypto.randomUUID(),
      data: { ...data, deliveryAddress: '1 Synthetic Street' },
      approvedFields: ['orderReference', 'damageDescription'],
      photoProvided: true,
      requestedResolution: full,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('CONSENT_SCOPE_MISMATCH');
    const overpriced = await site('merchant', 'POST', '/api/v1/claims', {
      requestId: crypto.randomUUID(),
      data,
      approvedFields: ['orderReference', 'damageDescription'],
      photoProvided: true,
      requestedResolution: partial(9_000),
    });
    expect(overpriced.status).toBe(400);
    const policy = await stack.apps.courier.request('/api/v1/claim-policy');
    expect(policy.status).toBe(200);
    expect(policy.headers.get('Access-Control-Allow-Origin')).toBe('*');
  },
);

integration(
  'R1 interrupted settle: case committed, settle lost, recovered without a second write',
  async () => {
    const claim = await fileClaim(partial(4_000));
    await json(
      await decide(claim.handoff.id, 1, scriptedAgent(await evaluation(claim.handoff.id))),
    );
    let dropped = false;
    // The settle request never reaches the platform: the case commits, the reservation stays open.
    const interrupted: Fetcher = async (input, init) => {
      if (!dropped && String(input).endsWith(`/handoffs/${claim.handoff.id}/executions/settle`)) {
        dropped = true;
        throw new TypeError('connection reset before settle');
      }
      return routeFetch(input, init);
    };
    const courierApp = createApp(
      configs.courier,
      stack.courierStore,
      stack.signing.courier,
      interrupted,
    );
    const before = await caseCount();
    const draft = await merchantStore.createDraft({
      recipientOrigin: origins.courier,
      caseType: 'delivery_damage',
      data,
      governance: { handoffId: claim.handoff.id, version: 1 },
    });
    const consent = await merchantStore.approve(
      draft.id,
      ['orderReference', 'damageDescription'],
      routeFetch,
    );
    await json(await site('merchant', 'POST', `/api/v1/transfers/${draft.id}/submit`, {}));
    const tools = sessionTools(configs.courier),
      token = tools.issue();
    const response = await courierApp.request('/api/v1/cases', {
      method: 'POST',
      headers: {
        Origin: origins.courier,
        Cookie: `porden_courier_session=${token}`,
        'X-CSRF-Token': tools.csrf(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        CreateCase.parse({ ...consent.arguments, requestId: `claim:${draft.id}` }),
      ),
    });
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('OUTCOME_UNKNOWN');
    expect(await caseCount()).toBe(before + 1);
    const stuck = await courierPlatform.getHandoff(claim.handoff.id);
    expect(stuck.executions.map((item) => item.status)).toEqual(['reserved']);
    expect((await courierPlatform.getAuthorization(claim.handoff.id, 1)).reasonCode).toBe(
      'EXECUTION_RESERVED',
    );
    expect(
      (await decide(claim.handoff.id, 1, { decision: 'complete', reason: 'done' })).status,
    ).toBe(409);
    const inbox = ClaimInbox.parse(await json(await site('courier', 'GET', '/api/v1/claims')));
    expect(inbox.items.find((item) => item.handoff.id === claim.handoff.id)?.stage).toBe(
      'execution_unresolved',
    );
    const recover = () =>
      site('courier', 'POST', `/api/v1/claims/${claim.handoff.id}/executions/recover`, {});
    const recovered = ExecutionRecovery.parse(await json(await recover()));
    expect(recovered.recovered).toHaveLength(1);
    expect(recovered.recovered[0].outcome).toBe('completed');
    // Recovery is idempotent and never writes a second case.
    expect(ExecutionRecovery.parse(await json(await recover())).recovered).toEqual([]);
    expect(await caseCount()).toBe(before + 1);
    // The merchant reconciles its uncertain transfer read-only and verifies the receipt resolution.
    const reconciled = await json<{ status: string }>(
      await site('merchant', 'POST', `/api/v1/transfers/${draft.id}/reconcile`, {}),
    );
    expect(reconciled.status).toBe('accepted');
    expect((await complete(claim.handoff.id, 1)).handoff.status).toBe('completed');
  },
);

integration(
  'R2 interrupted before commit: an orphaned reservation settles failed and can be retried',
  async () => {
    const claim = await fileClaim(partial(4_000));
    await json(
      await decide(claim.handoff.id, 1, scriptedAgent(await evaluation(claim.handoff.id))),
    );
    const scope = claim.handoff.versions[0].terms.executionScopes?.[0];
    if (!scope) throw Error('Missing execution scope');
    await courierPlatform.reserveExecution(claim.handoff.id, {
      requestId: crypto.randomUUID(),
      version: 1,
      action: scope.action,
      parametersSha256: scope.parametersSha256,
      operationReference: 'interrupted-before-commit',
    });
    const blocked = (await execute(claim.handoff.id, 1)).response;
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe('EXECUTION_RESERVED');
    const before = await caseCount();
    const recovered = ExecutionRecovery.parse(
      await json(
        await site('courier', 'POST', `/api/v1/claims/${claim.handoff.id}/executions/recover`, {}),
      ),
    );
    expect(recovered.recovered.map((item) => item.outcome)).toEqual(['failed']);
    expect(await caseCount()).toBe(before);
    const { draft, response } = await execute(claim.handoff.id, 1);
    expect((await verifyAtMerchant(draft.id, response)).ack.status).toBe(200);
    expect(await caseCount()).toBe(before + 1);
    expect((await complete(claim.handoff.id, 1)).handoff.status).toBe('completed');
  },
);

integration('courier inbox lists claims with a server-derived next step', async () => {
  const countered = await fileClaim(full);
  await json(
    await decide(
      countered.handoff.id,
      1,
      scriptedAgent(await evaluation(countered.handoff.id), 'reship'),
    ),
  );
  const fresh = await fileClaim(partial(1_000));
  const inbox = ClaimInbox.parse(
    await json(await site('courier', 'GET', '/api/v1/claims?limit=50')),
  );
  const stage = (id: string) => inbox.items.find((item) => item.handoff.id === id)?.stage;
  expect(stage(fresh.handoff.id)).toBe('review');
  expect(stage(countered.handoff.id)).toBe('waiting_for_merchant_approval');
  expect(inbox.items.every((item) => item.current.claim.orderReference === 'DEMO-1042')).toBe(true);
  expect((await site('courier', 'GET', '/api/v1/claims?limit=500')).status).toBe(400);
  expect((await stack.apps.courier.request('/api/v1/claims')).status).toBe(401);
});

integration(
  'R3 recovery racing an in-flight write: no case is written after a failed settle',
  async () => {
    const claim = await fileClaim(partial(4_000));
    await json(
      await decide(claim.handoff.id, 1, scriptedAgent(await evaluation(claim.handoff.id))),
    );
    let raced: unknown;
    // Recovery runs in the gap between the platform reservation and the courier case write.
    const racing: Fetcher = async (input, init) => {
      const response = await routeFetch(input, init);
      if (!raced && String(input).endsWith(`/handoffs/${claim.handoff.id}/executions`)) {
        raced = await json(
          await site(
            'courier',
            'POST',
            `/api/v1/claims/${claim.handoff.id}/executions/recover`,
            {},
          ),
        );
      }
      return response;
    };
    const courierApp = createApp(
      configs.courier,
      stack.courierStore,
      stack.signing.courier,
      racing,
    );
    const before = await caseCount();
    const draft = await merchantStore.createDraft({
      recipientOrigin: origins.courier,
      caseType: 'delivery_damage',
      data,
      governance: { handoffId: claim.handoff.id, version: 1 },
    });
    const consent = await merchantStore.approve(
      draft.id,
      ['orderReference', 'damageDescription'],
      routeFetch,
    );
    const tools = sessionTools(configs.courier),
      token = tools.issue();
    const response = await courierApp.request('/api/v1/cases', {
      method: 'POST',
      headers: {
        Origin: origins.courier,
        Cookie: `porden_courier_session=${token}`,
        'X-CSRF-Token': tools.csrf(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        CreateCase.parse({ ...consent.arguments, requestId: `race:${draft.id}` }),
      ),
    });
    expect(ExecutionRecovery.parse(raced).recovered.map((item) => item.outcome)).toEqual([
      'failed',
    ]);
    expect(response.status).toBe(409);
    expect(await caseCount()).toBe(before);
    const state = await courierPlatform.getHandoff(claim.handoff.id);
    expect(state.executions.map((item) => item.status)).toEqual(['failed']);
    // A fresh consented transfer then creates exactly one case for the claim.
    const { draft: retry, response: retried } = await execute(claim.handoff.id, 1);
    expect((await verifyAtMerchant(retry.id, retried)).ack.status).toBe(200);
    expect(await caseCount()).toBe(before + 1);
  },
);

integration('courier inbox skips malformed or foreign handoffs instead of failing', async () => {
  const valid = await fileClaim(partial(1_000));
  await stack.merchantPlatform.createHandoff({
    receiverOrganizationId: configs.courier.platform?.organizationId ?? '',
    terms: {
      goal: 'Not a real claim',
      constraints: ['Claim parameters (canonical): {not json'],
      acceptanceCriteria: ['None'],
    },
  });
  const inbox = ClaimInbox.parse(
    await json(await site('courier', 'GET', '/api/v1/claims?limit=50')),
  );
  expect(inbox.items.some((item) => item.handoff.id === valid.handoff.id)).toBe(true);
});

integration(
  'claim reconciliation only returns operations on claims between the configured pair',
  async () => {
    const requestId = crypto.randomUUID();
    await stack.merchantPlatform.createHandoff({
      requestId,
      receiverOrganizationId: configs.courier.platform?.organizationId ?? '',
      terms: { goal: 'Generic task', constraints: [], acceptanceCriteria: ['Done'] },
    });
    const hidden = await site('merchant', 'GET', `/api/v1/claims/operations/${requestId}`);
    expect(hidden.status).toBe(404);
    const claim = await fileClaim(partial(1_000));
    const accept = crypto.randomUUID();
    await json(
      await decide(claim.handoff.id, 1, { decision: 'accept', reason: 'Within policy' }, accept),
    );
    expect((await site('courier', 'GET', `/api/v1/claims/operations/${accept}`)).status).toBe(200);
  },
);

integration(
  'the publisher-funded model route refuses provider routing and billing fields',
  async () => {
    const upstream: string[] = [];
    const fetcher: Fetcher = async (input, init) => {
      if (String(input).startsWith('https://openrouter.ai/')) {
        upstream.push(String(init?.body));
        return new Response('data: [DONE]\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return routeFetch(input, init);
    };
    const config = { ...configs.merchant, openrouterKey: 'server-key', model: 'test/free:free' };
    const app = createApp(config, merchantStore, stack.signing.merchant, fetcher);
    const tools = sessionTools(config),
      token = tools.issue();
    const call = (body: unknown) =>
      app.request('/api/llm/chat/completions', {
        method: 'POST',
        headers: {
          Origin: origins.merchant,
          Cookie: `porden_merchant_session=${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const base = { model: 'test/free:free', messages: [{ role: 'user', content: 'hi' }] };
    for (const extra of [
      { models: ['openai/expensive'] },
      { provider: { only: ['x'] } },
      { plugins: [{ id: 'web' }] },
      { n: 4 },
    ]) {
      const refused = await call({ ...base, ...extra });
      expect(refused.status).toBe(400);
    }
    expect(upstream).toEqual([]);
    const allowed = await call({ ...base, stream: true, tools: [], tool_choice: 'auto' });
    expect(allowed.status).toBe(200);
    expect(JSON.parse(upstream[0])).toEqual({
      ...base,
      stream: true,
      tools: [],
      tool_choice: 'auto',
    });
  },
);

const consentOf = async (id: string) =>
  ClaimConsentResponse.parse(
    await json(await site('merchant', 'GET', `/api/v1/claims/${id}/consent`)),
  ).consent;

integration(
  'Consent: the merchant keeps the consented details until the case is sent, and lists claims',
  async () => {
    const claim = await fileClaim(partial(4_000));
    const id = claim.handoff.id;
    const list = MerchantClaimList.parse(
      await json(await site('merchant', 'GET', '/api/v1/claims')),
    );
    expect(list.items[0]).toMatchObject({ handoffId: id, orderReference: 'DEMO-1042' });
    expect(await consentOf(id)).toEqual({
      data,
      approvedFields: ['orderReference', 'damageDescription'],
    });
    // A claim this customer did not file here is not readable through the consent route.
    expect(
      (await site('merchant', 'GET', `/api/v1/claims/${crypto.randomUUID()}/consent`)).status,
    ).toBe(404);
    const result = await evaluation(id);
    await json(await decide(id, 1, scriptedAgent(result)));
    const { draft, response } = await execute(id, 1);
    expect((await verifyAtMerchant(draft.id, response)).ack.status).toBe(200);
    // The verified receipt for the governed transfer clears the details; the record remains.
    expect(await consentOf(id)).toBeNull();
    const after = MerchantClaimList.parse(
      await json(await site('merchant', 'GET', '/api/v1/claims')),
    );
    expect(after.items.map((item) => item.handoffId)).toContain(id);
  },
);

integration('Consent: cancelling a claim clears the consented details', async () => {
  const claim = await fileClaim(partial(4_000));
  const id = claim.handoff.id;
  expect(await consentOf(id)).not.toBeNull();
  const cancelled = await json<ClaimView>(
    await site('merchant', 'POST', `/api/v1/claims/${id}/cancel`, {
      requestId: crypto.randomUUID(),
      version: 1,
    }),
  );
  expect(cancelled.handoff.status).toBe('cancelled');
  expect(await consentOf(id)).toBeNull();
});

integration(
  'Consent: a filing whose answer was lost keeps its consent once it is reconciled',
  async () => {
    const body: FileClaim = {
      requestId: crypto.randomUUID(),
      data,
      approvedFields: ['orderReference', 'damageDescription'],
      photoProvided: true,
      requestedResolution: partial(4_000),
    };
    let dropped = false;
    const lossy: Fetcher = async (input, init) => {
      const response = await routeFetch(input, init);
      if (
        !dropped &&
        init?.method === 'POST' &&
        new URL(String(input)).pathname.endsWith('/handoffs')
      ) {
        dropped = true;
        throw new TypeError('connection reset after the platform committed');
      }
      return response;
    };
    const lost = await merchantClaims(configs.merchant, lossy, merchantStore)
      .file(body)
      .catch((error: { status?: number }) => error);
    expect(lost).toMatchObject({ status: 502 });
    // The claim exists on the platform but is not linked yet, so it is not listed.
    const before = MerchantClaimList.parse(
      await json(await site('merchant', 'GET', '/api/v1/claims')),
    );
    const reconciled = await json<{ handoff: HandoffDetail }>(
      await site('merchant', 'GET', `/api/v1/claims/operations/${body.requestId}`),
    );
    const id = reconciled.handoff.id;
    expect(before.items.map((item) => item.handoffId)).not.toContain(id);
    expect(await consentOf(id)).toEqual({
      data,
      approvedFields: ['orderReference', 'damageDescription'],
    });
    const after = MerchantClaimList.parse(
      await json(await site('merchant', 'GET', '/api/v1/claims')),
    );
    expect(after.items.map((item) => item.handoffId)).toContain(id);
    // Replaying the same request ID with different content is refused before the platform call.
    const changed = await site('merchant', 'POST', '/api/v1/claims', {
      ...body,
      requestedResolution: partial(3_000),
    });
    expect(changed.status).toBe(409);
    expect((await changed.json()).error.code).toBe('REQUEST_CONFLICT');
    // An exact replay returns the same claim.
    const replay = ClaimView.parse(
      await json(await site('merchant', 'POST', '/api/v1/claims', body), 201),
    );
    expect(replay.handoff.id).toBe(id);
  },
);

function filing(): FileClaim {
  return {
    requestId: crypto.randomUUID(),
    data,
    approvedFields: ['orderReference', 'damageDescription'],
    photoProvided: true,
    requestedResolution: partial(4_000),
  };
}
const isFiling = (input: Parameters<Fetcher>[0], init: Parameters<Fetcher>[1]) =>
  init?.method === 'POST' && new URL(String(input)).pathname.endsWith('/handoffs');
const pendingRows = async (requestId: string) =>
  (
    await stack.merchantSql`SELECT handoff_id FROM merchant_claims WHERE request_id = ${requestId}`
  ).map((row: { handoff_id: string | null }) => row.handoff_id);
const backdate = (requestId: string) =>
  stack.merchantSql`UPDATE merchant_claims SET filed_at = now() - interval '11 minutes' WHERE request_id = ${requestId}`;

integration(
  'Consent: a failed link after the platform call is repaired by checking the request',
  async () => {
    const body = filing();
    const failingLink = {
      ...merchantStore,
      bindClaim: async () => {
        throw Error('merchant database unavailable');
      },
    };
    await expect(
      merchantClaims(configs.merchant, routeFetch, failingLink).file(body),
    ).rejects.toThrow('merchant database unavailable');
    expect(await pendingRows(body.requestId)).toEqual([null]);
    const reconciled = await json<{ handoff: HandoffDetail }>(
      await site('merchant', 'GET', `/api/v1/claims/operations/${body.requestId}`),
    );
    expect(await consentOf(reconciled.handoff.id)).not.toBeNull();
  },
);

integration('Consent sweep: a lost filing nobody checked is linked from the platform', async () => {
  const body = filing();
  const lossy: Fetcher = async (input, init) => {
    const response = await routeFetch(input, init);
    if (isFiling(input, init)) throw new TypeError('connection reset after the platform committed');
    return response;
  };
  await merchantClaims(configs.merchant, lossy, merchantStore)
    .file(body)
    .catch(() => undefined);
  // A recent filing is left alone: its answer may still be on the way.
  await json(await site('merchant', 'GET', '/api/v1/claims'));
  expect(await pendingRows(body.requestId)).toEqual([null]);
  await backdate(body.requestId);
  const list = MerchantClaimList.parse(await json(await site('merchant', 'GET', '/api/v1/claims')));
  const [handoffId] = await pendingRows(body.requestId);
  if (!handoffId) throw Error('The sweep did not link the filing');
  expect(list.items.map((item) => item.handoffId)).toContain(handoffId);
  expect(await consentOf(handoffId)).not.toBeNull();
});

integration('Consent sweep: a filing the platform never received is deleted', async () => {
  const body = filing();
  const unreachable: Fetcher = async (input, init) => {
    if (isFiling(input, init)) throw new TypeError('connection refused');
    return routeFetch(input, init);
  };
  await merchantClaims(configs.merchant, unreachable, merchantStore)
    .file(body)
    .catch(() => undefined);
  expect(await pendingRows(body.requestId)).toEqual([null]);
  await backdate(body.requestId);
  // While the platform can't be reached, the filing is kept for a later sweep.
  const offline: Fetcher = async (input, init) => {
    if (new URL(String(input)).origin === origins.platform) throw new TypeError('platform down');
    return routeFetch(input, init);
  };
  await merchantClaims(configs.merchant, offline, merchantStore).list();
  expect(await pendingRows(body.requestId)).toEqual([null]);
  await json(await site('merchant', 'GET', '/api/v1/claims'));
  expect(await pendingRows(body.requestId)).toEqual([]);
});

integration(
  'Consent sweep: an exact replay in flight is not removed by a concurrent sweep',
  async () => {
    const body = filing();
    const unreachable: Fetcher = async (input, init) => {
      if (isFiling(input, init)) throw new TypeError('connection refused');
      return routeFetch(input, init);
    };
    await merchantClaims(configs.merchant, unreachable, merchantStore)
      .file(body)
      .catch(() => undefined);
    await backdate(body.requestId);
    // The sweep picked the filing as stale, and the platform has no record of it yet...
    const cutoff = new Date(Date.now() - 10 * 60_000);
    const [{ request_sha256: sha }] =
      await stack.merchantSql`SELECT request_sha256 FROM merchant_claims WHERE request_id = ${body.requestId}`;
    // ...when an exact replay stores the same filing again before calling the platform.
    await merchantStore.reserveClaim(body.requestId, sha, {
      data,
      approvedFields: body.approvedFields,
    });
    await merchantStore.discardPendingClaim(body.requestId, cutoff);
    expect(await pendingRows(body.requestId)).toEqual([null]);
    // A replay with different content does not restart the clock, so the sweep still removes it.
    await backdate(body.requestId);
    await merchantStore.reserveClaim(body.requestId, 'f'.repeat(64), {
      data,
      approvedFields: body.approvedFields,
    });
    await merchantStore.discardPendingClaim(body.requestId, cutoff);
    expect(await pendingRows(body.requestId)).toEqual([]);
  },
);

integration(
  'Consent: a refused or uncertain filing keeps its consent until the sweep settles it',
  async () => {
    const body = filing();
    const refused: Fetcher = async (input, init) =>
      isFiling(input, init)
        ? new Response(
            JSON.stringify({
              error: { code: 'INVALID_INPUT', message: 'x', requestId: crypto.randomUUID() },
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        : routeFetch(input, init);
    await expect(
      merchantClaims(configs.merchant, refused, merchantStore).file(body),
    ).rejects.toThrow();
    expect(await pendingRows(body.requestId)).toEqual([null]);
  },
);
