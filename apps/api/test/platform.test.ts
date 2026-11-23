import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TaskTerms, HandoffReceiptClaims } from '@porden/contracts';
import { createHandoffClient, HandoffWriteUnknown } from '@porden/sdk';
import { loadPlatformConfig } from '../src/platform-config';
import { platformAuth } from '../src/platform-auth';
import { createPlatformApp } from '../src/platform-app';
import { platformStore } from '../src/db/platform-store';
import { migratePlatform } from '../src/db/platform-migrate';
import { provisionPlatform } from '../src/db/platform-provision';
import { signer, hash, verifyToken } from '../src/security';

const url = process.env.PORDEN_TEST_DATABASE_URL;
const integration = url ? test : test.skip;
const schema = `porden_platform_test_${crypto.randomUUID().replaceAll('-', '')}`;
const directory = resolve('tmp', schema),
  origin = 'http://localhost:4300';
const orgA = crypto.randomUUID(),
  orgB = crypto.randomUUID(),
  orgC = crypto.randomUUID();
const memberId = crypto.randomUUID();
const tokenA = 'a'.repeat(40),
  tokenB = 'b'.repeat(40),
  tokenC = 'c'.repeat(40),
  password = 'platform-test-password';
let admin: SQL, database: SQL, app: ReturnType<typeof createPlatformApp>;
let agentA: ReturnType<typeof createHandoffClient>,
  agentB: ReturnType<typeof createHandoffClient>,
  agentC: ReturnType<typeof createHandoffClient>;
let humanA: ReturnType<typeof createHandoffClient>,
  humanB: ReturnType<typeof createHandoffClient>,
  humanC: ReturnType<typeof createHandoffClient>,
  member: ReturnType<typeof createHandoffClient>;
const terms = (): TaskTerms => ({
  goal: 'Purchase replacement supplies',
  constraints: ['Do not exceed authorized budget'],
  acceptanceCriteria: ['Provide a purchase receipt'],
  budget: { amountMinor: 50000, currency: 'USD' },
  completedWork: ['Supplier quote recorded'],
  remainingWork: ['Purchase and inspect supplies'],
  nextStep: 'Confirm stock before purchase',
  evidence: [
    {
      claim: 'Supplier offers replacement supplies',
      source: {
        url: 'https://example.com/supplies?exact=1#stock',
        locator: 'Stock table',
        excerpt: 'Available <script>untrusted</script>',
      },
    },
  ],
});
function client(token?: string) {
  let cookie = '';
  return createHandoffClient({
    baseUrl: origin + '/api/v2',
    token,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Origin', origin);
      if (cookie) headers.set('Cookie', cookie);
      const response = await app.request(input, { ...init, headers });
      if (response.headers.get('set-cookie'))
        cookie = response.headers.get('set-cookie')!.split(';')[0];
      return response;
    },
  });
}
const key = () => ({ requestId: crypto.randomUUID() });
async function offered() {
  const created = await agentA.createHandoff({
    ...key(),
    receiverOrganizationId: orgB,
    terms: terms(),
  });
  return (await humanA.approveHandoff(created.handoff.id, { ...key(), version: 1 })).handoff;
}
async function accepted() {
  const row = await offered();
  return (await agentB.acceptHandoff(row.id, { ...key(), version: 1 })).handoff;
}
beforeAll(async () => {
  if (!url) return;
  admin = new SQL(url);
  await admin.unsafe(`CREATE SCHEMA ${schema}`);
  database = new SQL({ url, prepare: false, connection: { search_path: schema } });
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, 'platform.pem');
  writeFileSync(
    path,
    generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }),
  );
  const config = loadPlatformConfig({
    PORDEN_DATABASE_URL: url,
    PORDEN_PUBLIC_ORIGIN: origin,
    PORDEN_ALLOWED_ORIGINS: origin + ',http://localhost:4100,http://localhost:4200',
    PORDEN_SESSION_SECRET: 's'.repeat(40),
    PORDEN_SIGNING_KEY_PATH: path,
  });
  await migratePlatform(database);
  await migratePlatform(database);
  await provisionPlatform(database, {
    organizations: [
      { id: orgA, name: 'Company A', humanApprovalRequired: true },
      { id: orgB, name: 'Company B', humanApprovalRequired: true },
      { id: orgC, name: 'Company C', humanApprovalRequired: false },
    ],
    principals: [
      {
        id: crypto.randomUUID(),
        organizationId: orgA,
        name: 'A agent',
        login: 'agent-a',
        kind: 'integration',
        role: 'member',
        secret: tokenA,
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgB,
        name: 'B agent',
        login: 'agent-b',
        kind: 'integration',
        role: 'member',
        secret: tokenB,
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgC,
        name: 'C agent',
        login: 'agent-c',
        kind: 'integration',
        role: 'member',
        secret: tokenC,
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgA,
        name: 'A human',
        login: 'a',
        kind: 'human',
        role: 'approver',
        secret: password,
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgB,
        name: 'B human',
        login: 'b',
        kind: 'human',
        role: 'approver',
        secret: password,
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgC,
        name: 'C human',
        login: 'c',
        kind: 'human',
        role: 'approver',
        secret: password,
      },
      {
        id: memberId,
        organizationId: orgA,
        name: 'A member',
        login: 'member',
        kind: 'human',
        role: 'member',
        secret: password,
      },
    ],
  });
  const signing = signer(config),
    store = platformStore(database, signing);
  await store.ready();
  app = createPlatformApp(config, store, platformAuth(database, config), signing);
  agentA = client(tokenA);
  agentB = client(tokenB);
  agentC = client(tokenC);
  humanA = client();
  humanB = client();
  humanC = client();
  member = client();
  await humanA.signIn({ login: 'a', password });
  await humanB.signIn({ login: 'b', password });
  await humanC.signIn({ login: 'c', password });
  await member.signIn({ login: 'member', password });
});
afterAll(async () => {
  if (!url) return;
  await database?.close();
  await admin?.unsafe(`DROP SCHEMA ${schema} CASCADE`);
  await admin?.close();
  rmSync(directory, { recursive: true, force: true });
});
integration(
  'platform route boundary rejects malformed, oversized and forged input before persistence',
  async () => {
    const send = (path: string, body: unknown) =>
      app.request('/api/v2' + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await app.request('/api/v2/handoffs')).status).toBe(401);
    expect(
      (
        await send('/handoffs', {
          ...key(),
          receiverOrganizationId: orgB,
          terms: terms(),
          approvedBy: 'a',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send('/handoffs', {
          ...key(),
          receiverOrganizationId: orgB,
          terms: { ...terms(), remainingWork: ['x'.repeat(1001)] },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send('/handoffs', {
          ...key(),
          receiverOrganizationId: orgB,
          terms: { ...terms(), evidence: [{ sourceUrl: 'javascript:alert(1)' }] },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send('/handoffs', {
          ...key(),
          receiverOrganizationId: orgB,
          terms: {
            ...terms(),
            evidence: [{ claim: 'bad', source: { url: 'javascript:alert(1)' } }],
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send('/handoffs', {
          ...key(),
          receiverOrganizationId: orgB,
          terms: {
            ...terms(),
            evidence: [
              { claim: 'bad', source: { url: 'https://example.com', excerpt: 'a'.repeat(4001) } },
            ],
          },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send('/handoffs', {
          ...key(),
          receiverOrganizationId: orgB,
          terms: { ...terms(), goal: 'a'.repeat(70000) },
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await app.request('/api/v2/handoffs/not-uuid', {
          headers: { Authorization: `Bearer ${tokenA}` },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request('/api/v2/handoffs?limit=0&organizationId=x', {
          headers: { Authorization: `Bearer ${tokenA}` },
        })
      ).status,
    ).toBe(400);
  },
);
integration(
  'platform creates immutable idempotent handoffs and preserves exact source evidence',
  async () => {
    const input = { ...key(), receiverOrganizationId: orgB, terms: terms() };
    const results = await Promise.all(
      Array.from({ length: 12 }, () => agentA.createHandoff(input)),
    );
    expect(new Set(results.map((result) => result.handoff.id)).size).toBe(1);
    expect(new Set(results.map((result) => result.receipt.signedReceipt)).size).toBe(1);
    const row = results[0];
    expect(row.handoff.versions[0].terms).toEqual(input.terms);
    expect((await agentA.getHandoff(row.handoff.id)).versions[0].terms).toEqual(input.terms);
    expect(row.receipt.termsSha256).toBe(hash(input.terms));
    await expect(
      agentA.createHandoff({
        ...input,
        terms: {
          ...input.terms,
          evidence: [{ claim: 'Changed claim', source: { url: 'https://example.com' } }],
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
    const claims = HandoffReceiptClaims.parse(
      await verifyToken(
        row.receipt.signedReceipt,
        origin,
        'porden-handoff-receipt+jwt',
        async (input, init) => app.request(String(input), init),
      ),
    );
    expect(claims.termsSha256).toBe(hash(input.terms));
    expect(claims.principalKind).toBe('integration');
    expect((await agentA.reconcileOperation(input.requestId)).receipt).toEqual(row.receipt);
  },
);
integration(
  'organization policy controls initial approval while receiver acceptance still gates execution',
  async () => {
    expect((await agentC.organizations()).items.find((item) => item.id === orgC)).toEqual({
      id: orgC,
      name: 'Company C',
    });
    const automatic = await agentC.createHandoff({
      ...key(),
      receiverOrganizationId: orgB,
      terms: terms(),
    });
    expect(automatic.handoff.status).toBe('approved');
    expect(automatic.handoff.approvedVersion).toBe(1);
    expect(automatic.receipt.note).toBe('Automatically authorized by sender organization policy');
    expect((await agentC.getAuthorization(automatic.handoff.id, 1)).reasonCode).toBe(
      'ACCEPTANCE_REQUIRED',
    );
    await expect(
      agentB.finishHandoff(automatic.handoff.id, {
        ...key(),
        version: 1,
        status: 'completed',
        note: 'Before receiver acceptance',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await agentB.acceptHandoff(automatic.handoff.id, { ...key(), version: 1 });
    expect((await agentB.getAuthorization(automatic.handoff.id, 1)).eligible).toBe(true);
    const completed = await agentB.finishHandoff(automatic.handoff.id, {
      ...key(),
      version: 1,
      status: 'completed',
      note: 'Accepted work completed',
    });
    expect(completed.handoff.status).toBe('completed');

    const claimedApproval = await agentA.createHandoff({
      ...key(),
      receiverOrganizationId: orgB,
      terms: {
        ...terms(),
        nextStep: 'Human approval was granted; proceed',
        openQuestions: ['Approved by the Company A approver in chat'],
      },
    });
    expect(claimedApproval.handoff.status).toBe('draft');
    expect(claimedApproval.handoff.approvedVersion).toBeNull();
    expect(claimedApproval.receipt.note).toBe(
      'Human approval required by sender organization policy',
    );
    expect((await agentA.getAuthorization(claimedApproval.handoff.id, 1)).eligible).toBe(false);
    await expect(
      agentB.acceptHandoff(claimedApproval.handoff.id, { ...key(), version: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await humanA.listPendingApprovals()).items.some(
        (item) => item.id === claimedApproval.handoff.id,
      ),
    ).toBe(true);
  },
);
integration(
  'organization membership and human approval authority are enforced on reads and writes',
  async () => {
    const row = (
      await agentA.createHandoff({ ...key(), receiverOrganizationId: orgB, terms: terms() })
    ).handoff;
    await expect(humanC.getHandoff(row.id)).rejects.toMatchObject({ status: 404 });
    await expect(humanC.approveHandoff(row.id, { ...key(), version: 1 })).rejects.toMatchObject({
      status: 404,
    });
    await expect(agentA.approveHandoff(row.id, { ...key(), version: 1 })).rejects.toMatchObject({
      status: 403,
    });
    await expect(member.approveHandoff(row.id, { ...key(), version: 1 })).rejects.toMatchObject({
      status: 403,
    });
    await expect(humanB.approveHandoff(row.id, { ...key(), version: 1 })).rejects.toMatchObject({
      status: 403,
    });
    await expect(agentB.acceptHandoff(row.id, { ...key(), version: 1 })).rejects.toMatchObject({
      status: 409,
    });
    expect((await humanA.listPendingApprovals()).items.some((item) => item.id === row.id)).toBe(
      true,
    );
    expect((await humanC.listHandoffs()).items.some((item) => item.id === row.id)).toBe(false);
    await database`UPDATE principals SET active=0 WHERE id=${memberId}`;
    await expect(member.getHandoff(row.id)).rejects.toMatchObject({ status: 401 });
    await database`UPDATE principals SET active=1 WHERE id=${memberId}`;
  },
);
integration(
  '$500 to $550 is blocked until exact human authorization and receiver reacceptance',
  async () => {
    const row = await accepted(),
      newTerms = { ...terms(), budget: { amountMinor: 55000, currency: 'USD' } };
    expect((await agentB.getAuthorization(row.id, 1)).eligible).toBe(true);
    const proposed = await agentB.proposeRevision(row.id, {
      ...key(),
      version: 1,
      terms: newTerms,
      reason: 'Supplier price increased',
    });
    const revision = proposed.handoff.revisions[0];
    expect(proposed.handoff.status).toBe('awaiting_approval');
    expect(proposed.handoff.approvedVersion).toBe(1);
    expect((await agentB.getAuthorization(row.id, 2)).eligible).toBe(false);
    expect((await agentB.getAuthorization(row.id, 1)).eligible).toBe(false);
    await expect(
      agentB.finishHandoff(row.id, {
        ...key(),
        version: 2,
        status: 'completed',
        note: 'Unauthorized',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      agentA.decideRevision(row.id, revision.id, { ...key(), version: 2, decision: 'approved' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      humanB.decideRevision(row.id, revision.id, { ...key(), version: 2, decision: 'approved' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      humanA.decideRevision(row.id, revision.id, { ...key(), version: 1, decision: 'approved' }),
    ).rejects.toMatchObject({ status: 409 });
    const command = { ...key(), version: 2, decision: 'approved' as const };
    const approved = await humanA.decideRevision(row.id, revision.id, command);
    expect(approved.handoff.versions[0].terms.budget?.amountMinor).toBe(50000);
    expect(approved.handoff.currentVersion).toBe(2);
    expect((await agentB.getAuthorization(row.id, 2)).reasonCode).toBe('ACCEPTANCE_REQUIRED');
    await agentB.acceptHandoff(row.id, { ...key(), version: 2 });
    expect((await agentB.getAuthorization(row.id, 1)).reasonCode).toBe('STALE_VERSION');
    expect((await agentB.getAuthorization(row.id, 2)).eligible).toBe(true);
    expect((await humanA.decideRevision(row.id, revision.id, command)).receipt).toEqual(
      approved.receipt,
    );
    const done = await agentB.finishHandoff(row.id, {
      ...key(),
      version: 2,
      status: 'completed',
      note: 'Supplies purchased under updated budget',
    });
    expect(done.handoff.status).toBe('completed');
    expect(done.receipt.termsSha256).toBe(hash(newTerms));
  },
);
integration(
  'rejection preserves original authorization and concurrent decisions have one winner',
  async () => {
    const row = await accepted();
    const proposal = await agentB.proposeRevision(row.id, {
      ...key(),
      version: 1,
      terms: { ...terms(), budget: { amountMinor: 60000, currency: 'USD' } },
      reason: 'Alternative price',
    });
    const revision = proposal.handoff.revisions[0];
    const results = await Promise.allSettled([
      humanA.decideRevision(row.id, revision.id, { ...key(), version: 2, decision: 'rejected' }),
      humanA.decideRevision(row.id, revision.id, { ...key(), version: 2, decision: 'rejected' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await agentB.getAuthorization(row.id, 2)).eligible).toBe(false);
    expect((await agentB.getAuthorization(row.id, 1)).eligible).toBe(true);
    const updated = await agentA.getHandoff(row.id);
    expect(updated.currentVersion).toBe(1);
    expect(updated.approvedVersion).toBe(1);
    expect(updated.versions[0].terms).toEqual(terms());
    expect(updated.revisions[0].status).toBe('rejected');
  },
);
integration(
  'separate reversed handoffs share validated workflow history and independent receipts',
  async () => {
    const firstTerms = {
      ...terms(),
      remainingWork: ['Send return shipping label'],
      nextStep: 'Wait for return label',
      evidence: [
        { sourceUrl: 'https://example.com/return', excerpt: 'Synthetic return reference' },
      ],
    };
    const first = (
      await humanA.approveHandoff(
        (await agentA.createHandoff({ ...key(), receiverOrganizationId: orgB, terms: firstTerms }))
          .handoff.id,
        { ...key(), version: 1 },
      )
    ).handoff;
    await agentB.acceptHandoff(first.id, { ...key(), version: 1 });
    await agentB.finishHandoff(first.id, {
      ...key(),
      version: 1,
      status: 'completed',
      note: 'Original work finished',
    });
    const returnTerms = {
      ...terms(),
      goal: 'Return purchase report',
      remainingWork: firstTerms.remainingWork,
      nextStep: firstTerms.nextStep,
      evidence: firstTerms.evidence,
    };
    const next = await agentB.createHandoff({
      ...key(),
      receiverOrganizationId: orgA,
      previousHandoffId: first.id,
      workflowId: first.workflowId,
      terms: returnTerms,
    });
    expect(next.handoff.senderOrganizationId).toBe(orgB);
    expect(next.handoff.receiverOrganizationId).toBe(orgA);
    await humanB.approveHandoff(next.handoff.id, { ...key(), version: 1 });
    await agentA.acceptHandoff(next.handoff.id, { ...key(), version: 1 });
    const history = await humanA.getWorkflowHistory(first.workflowId);
    expect(history.items.map((item) => item.id)).toEqual([first.id, next.handoff.id]);
    expect(history.items[0].versions[0].terms).toEqual(firstTerms);
    expect(history.items[1].versions[0].terms).toEqual(returnTerms);
    expect(history.items[0].receipts[0].receiptId).not.toBe(history.items[1].receipts[0].receiptId);
    await expect(humanC.getWorkflowHistory(first.workflowId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      agentB.createHandoff({
        ...key(),
        receiverOrganizationId: orgC,
        previousHandoffId: first.id,
        terms: terms(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      agentB.createHandoff({
        ...key(),
        receiverOrganizationId: orgA,
        previousHandoffId: first.id,
        workflowId: crypto.randomUUID(),
        terms: terms(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  },
);
integration('cancellation, refusal and failure are explicit terminal states', async () => {
  const refusal = await offered();
  expect((await agentB.rejectHandoff(refusal.id, { ...key(), version: 1 })).handoff.status).toBe(
    'rejected',
  );
  const cancellation = await accepted();
  await agentA.cancelHandoff(cancellation.id, { ...key(), version: 1 });
  expect((await agentB.getAuthorization(cancellation.id, 1)).reasonCode).toBe('TERMINAL_STATE');
  await expect(
    agentB.finishHandoff(cancellation.id, {
      ...key(),
      version: 1,
      status: 'completed',
      note: 'Too late',
    }),
  ).rejects.toMatchObject({ status: 409 });
  const failure = await accepted();
  expect(
    (
      await agentB.finishHandoff(failure.id, {
        ...key(),
        version: 1,
        status: 'failed',
        note: 'Supplier unavailable',
      })
    ).handoff.status,
  ).toBe('failed');
});
integration(
  'lost write acknowledgement reconciles read-only without a second mutation',
  async () => {
    let writes = 0;
    const unstable = createHandoffClient({
      baseUrl: origin + '/api/v2',
      token: tokenA,
      fetch: async (input, init) => {
        const response = await app.request(input, init);
        if (init?.method === 'POST') {
          writes++;
          throw Error('Acknowledgement lost after commit');
        }
        return response;
      },
    });
    const input = { ...key(), receiverOrganizationId: orgB, terms: terms() };
    await expect(unstable.createHandoff(input)).rejects.toBeInstanceOf(HandoffWriteUnknown);
    const result = await unstable.reconcileOperation(input.requestId);
    expect(result.handoff.versions[0].terms).toEqual(input.terms);
    expect(writes).toBe(1);
  },
);
integration('a failed receipt insert rolls back the state transition atomically', async () => {
  const row = await offered();
  await database
    .unsafe(
      "CREATE FUNCTION fail_platform_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced rollback'; END $$; CREATE TRIGGER fail_platform_receipt BEFORE INSERT ON handoff_receipts FOR EACH ROW EXECUTE FUNCTION fail_platform_receipt()",
    )
    .simple();
  try {
    await expect(agentB.acceptHandoff(row.id, { ...key(), version: 1 })).rejects.toBeInstanceOf(
      HandoffWriteUnknown,
    );
  } finally {
    await database
      .unsafe(
        'DROP TRIGGER fail_platform_receipt ON handoff_receipts; DROP FUNCTION fail_platform_receipt()',
      )
      .simple();
  }
  expect((await agentA.getHandoff(row.id)).status).toBe('approved');
});
integration(
  'workflow grouping validates participants without orchestrating task completion',
  async () => {
    const workflowId = crypto.randomUUID();
    const first = (
      await agentA.createHandoff({
        ...key(),
        receiverOrganizationId: orgB,
        workflowId,
        terms: terms(),
      })
    ).handoff;
    const next = await agentB.createHandoff({
      ...key(),
      receiverOrganizationId: orgA,
      previousHandoffId: first.id,
      workflowId,
      terms: terms(),
    });
    expect(next.handoff.workflowId).toBe(workflowId);
    expect(first.status).toBe('draft');
    const collision = crypto.randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        agentA.createHandoff({
          ...key(),
          receiverOrganizationId: orgB,
          workflowId: collision,
          terms: terms(),
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  },
);
integration(
  'opposing decisions cannot both commit and persistence rejects invalid approval scope',
  async () => {
    const row = await accepted();
    const proposal = await agentB.proposeRevision(row.id, {
      ...key(),
      version: 1,
      terms: { ...terms(), budget: { amountMinor: 70000, currency: 'USD' } },
      reason: 'Conflicting decisions test',
    });
    const revision = proposal.handoff.revisions[0];
    const decisions = await Promise.allSettled([
      humanA.decideRevision(row.id, revision.id, { ...key(), version: 2, decision: 'approved' }),
      humanA.decideRevision(row.id, revision.id, { ...key(), version: 2, decision: 'rejected' }),
    ]);
    expect(decisions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const draft = (
      await agentA.createHandoff({ ...key(), receiverOrganizationId: orgB, terms: terms() })
    ).handoff;
    await expect(
      (async () => {
        await database`UPDATE handoffs SET accepted_version=1 WHERE id=${draft.id}`;
      })(),
    ).rejects.toThrow();
    expect((await agentA.getHandoff(draft.id)).acceptedVersion).toBeNull();
  },
);
integration('sessions enforce origin, CSRF, logout, expiry and CORS', async () => {
  for (const login of ['a', 'missing-user']) {
    const invalid = await app.request('/api/v2/session', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password: 'incorrect-password' }),
    });
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).error.code).toBe('UNAUTHORIZED_ACTION');
  }
  const login = await app.request('/api/v2/session', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'a', password }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  expect(
    (
      await app.request('/api/v2/handoffs', {
        method: 'POST',
        headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request('/api/v2/session', {
        headers: { Origin: 'https://evil.example', Cookie: cookie },
      })
    ).status,
  ).toBe(403);
  const cors = await app.request('/api/v2/handoffs', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  });
  expect(cors.headers.get('access-control-allow-origin')).toBe(origin);
  const evil = await app.request('/api/v2/handoffs', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  const temporary = client();
  await temporary.signIn({ login: 'b', password });
  await temporary.signOut();
  await expect(temporary.session()).rejects.toMatchObject({ status: 401 });
  await database`UPDATE platform_sessions SET expires_at=now()-interval '1 second'`;
  expect((await app.request('/api/v2/session', { headers: { Cookie: cookie } })).status).toBe(401);
});
