import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CreateCase, type CreateDraft, type HandoffDetail } from '@porden/contracts';
import { createHandoffClient } from '@porden/sdk';
import { loadConfig, type Config } from '../src/config';
import { loadPlatformConfig } from '../src/platform-config';
import { createApp } from '../src/app';
import { createPlatformApp } from '../src/platform-app';
import { platformAuth } from '../src/platform-auth';
import { handoffService } from '../src/services/handoffs';
import { migrate } from '../src/db/migrate';
import { migratePlatform } from '../src/db/platform-migrate';
import { provisionPlatform } from '../src/db/platform-provision';
import { store } from '../src/db/store';
import { hash, signer, sessionTools, type Fetcher } from '../src/security';

const url = process.env.PORDEN_TEST_DATABASE_URL;
const integration = url ? test : test.skip;
const suffix = crypto.randomUUID().replaceAll('-', '');
const schemas = ['platform', 'merchant', 'courier'].map(
  (role) => `porden_governed_${role}_${suffix}`,
);
const directory = resolve('tmp', `governed-${suffix}`);
const senderId = crypto.randomUUID(),
  receiverId = crypto.randomUUID(),
  outsiderId = crypto.randomUUID();
const tokenA = 'a'.repeat(40),
  tokenB = 'b'.repeat(40),
  tokenC = 'c'.repeat(40);
const platformOrigin = 'http://localhost:4300';
const origins = { merchant: 'http://localhost:4100', courier: 'http://localhost:4200' };
const data: CreateDraft['data'] = {
  orderReference: 'DEMO-1042',
  damageDescription: 'Synthetic governed delivery damage',
};
const scope = {
  action: 'courier.create_case',
  parametersSha256: hash({ caseType: 'delivery_damage', data }),
};
let admin: SQL, platformSql: SQL, merchantSql: SQL, courierSql: SQL;
let platformApp: ReturnType<typeof createPlatformApp>,
  merchantApp: ReturnType<typeof createApp>,
  courierApp: ReturnType<typeof createApp>;
let merchant: ReturnType<typeof store>, courier: ReturnType<typeof store>;
let merchantSigning: ReturnType<typeof signer>, courierSigning: ReturnType<typeof signer>;
let courierConfig: Config;
let sender: ReturnType<typeof createHandoffClient>,
  receiver: ReturnType<typeof createHandoffClient>;
const routeFetch: Fetcher = async (input, init) => {
  const target = new URL(String(input));
  const app =
    target.origin === platformOrigin
      ? platformApp
      : target.origin === origins.merchant
        ? merchantApp
        : target.origin === origins.courier
          ? courierApp
          : undefined;
  if (!app) throw Error('Unexpected upstream');
  return app.request(target.href, init);
};
beforeAll(async () => {
  if (!url) return;
  admin = new SQL(url);
  for (const schema of schemas) await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const connect = (schema: string) =>
    new SQL({ url, prepare: false, connection: { search_path: schema } });
  platformSql = connect(schemas[0]);
  merchantSql = connect(schemas[1]);
  courierSql = connect(schemas[2]);
  mkdirSync(directory, { recursive: true });
  const key = (name: string) => {
    const path = resolve(directory, name + '.pem');
    writeFileSync(
      path,
      generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
    );
    return path;
  };
  const platformConfig = loadPlatformConfig({
    PORDEN_DATABASE_URL: url,
    PORDEN_PUBLIC_ORIGIN: platformOrigin,
    PORDEN_ALLOWED_ORIGINS: Object.values(origins).join(',') + ',' + platformOrigin,
    PORDEN_SESSION_SECRET: 's'.repeat(40),
    PORDEN_SIGNING_KEY_PATH: key('platform'),
  });
  await migratePlatform(platformSql);
  await provisionPlatform(platformSql, {
    organizations: [
      { id: senderId, name: 'Sender', humanApprovalRequired: false },
      { id: receiverId, name: 'Receiver' },
      { id: outsiderId, name: 'Outsider' },
    ],
    principals: [
      {
        id: crypto.randomUUID(),
        organizationId: senderId,
        name: 'Sender integration',
        login: 'sender',
        kind: 'integration',
        role: 'member',
        secret: tokenA,
      },
      {
        id: crypto.randomUUID(),
        organizationId: receiverId,
        name: 'Receiver integration',
        login: 'receiver',
        kind: 'integration',
        role: 'member',
        secret: tokenB,
      },
      {
        id: crypto.randomUUID(),
        organizationId: outsiderId,
        name: 'Other integration',
        login: 'other',
        kind: 'integration',
        role: 'member',
        secret: tokenC,
      },
      {
        id: crypto.randomUUID(),
        organizationId: senderId,
        name: 'Approver',
        login: 'approver',
        kind: 'human',
        role: 'approver',
        secret: 'governed-test-approver',
      },
    ],
  });
  const platformSigning = signer(platformConfig);
  platformApp = createPlatformApp(
    platformConfig,
    handoffService(platformSql, platformSigning),
    platformAuth(platformSql, platformConfig),
    platformSigning,
  );
  const config = (role: 'merchant' | 'courier') =>
    loadConfig({
      ORGANIZATION_ROLE: role,
      PUBLIC_ORIGIN: origins[role],
      PEER_ORIGIN: role === 'merchant' ? origins.courier : origins.merchant,
      DATABASE_URL: url,
      SESSION_SECRET: role.repeat(32),
      PARTNER_SECRET: 'p'.repeat(32),
      DEMO_PASSWORD: 'governed-test',
      SIGNING_KEY_PATH: key(role),
      PORDEN_API_ORIGIN: platformOrigin,
      PORDEN_INTEGRATION_TOKEN: role === 'merchant' ? tokenA : tokenB,
      PORDEN_ORGANIZATION_ID: role === 'merchant' ? senderId : receiverId,
      PORDEN_PEER_ORGANIZATION_ID: role === 'merchant' ? receiverId : senderId,
    });
  const merchantConfig = config('merchant');
  courierConfig = config('courier');
  merchantSigning = signer(merchantConfig);
  courierSigning = signer(courierConfig);
  await migrate(merchantSql, 'merchant');
  await migrate(courierSql, 'courier');
  merchant = store(merchantSql, merchantConfig, merchantSigning);
  courier = store(courierSql, courierConfig, courierSigning);
  merchantApp = createApp(merchantConfig, merchant, merchantSigning, routeFetch);
  courierApp = createApp(courierConfig, courier, courierSigning, routeFetch);
  sender = createHandoffClient({
    baseUrl: platformOrigin + '/api/v2',
    token: tokenA,
    fetch: routeFetch,
  });
  receiver = createHandoffClient({
    baseUrl: platformOrigin + '/api/v2',
    token: tokenB,
    fetch: routeFetch,
  });
});
afterAll(async () => {
  if (!url) return;
  await Promise.all([platformSql?.close(), merchantSql?.close(), courierSql?.close()]);
  if (admin) {
    for (const schema of schemas) await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
  }
  rmSync(directory, { recursive: true, force: true });
});
async function offered(accept = true, manual = false) {
  await platformSql`UPDATE organizations SET human_approval_required=${manual} WHERE id=${senderId}`;
  const created = await sender.createHandoff({
    receiverOrganizationId: receiverId,
    terms: {
      goal: 'Create one damage case',
      constraints: ['Use the exact authorized payload'],
      acceptanceCriteria: ['Persist a case receipt'],
      executionScopes: [scope],
    },
  });
  if (accept) await receiver.acceptHandoff(created.handoff.id, { version: 1 });
  return created.handoff;
}
async function approved(state: HandoffDetail) {
  const draft = await merchant.createDraft({
    recipientOrigin: origins.courier,
    caseType: 'delivery_damage',
    data,
    governance: { handoffId: state.id, version: 1 },
  });
  const consent = await merchant.approve(
    draft.id,
    ['orderReference', 'damageDescription'],
    routeFetch,
  );
  return CreateCase.parse({ ...consent.arguments, requestId: 'governed:' + draft.id });
}
function post(args: unknown, app = courierApp) {
  const tools = sessionTools(courierConfig),
    token = tools.issue();
  return app.request('/api/v1/cases', {
    method: 'POST',
    headers: {
      Origin: origins.courier,
      Cookie: `porden_courier_session=${token}`,
      'X-CSRF-Token': tools.csrf(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
}
async function count() {
  return (await courierSql`SELECT count(*)::int AS count FROM cases`)[0].count;
}

integration(
  'governed consumer writes require acceptance and human approval; rejection leaves database unchanged',
  async () => {
    for (const manual of [false, true]) {
      const state = await offered(false, manual),
        args = await approved(state),
        before = await count();
      const response = await post(args);
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('ACCEPTANCE_REQUIRED');
      expect(await count()).toBe(before);
      expect((await receiver.getHandoff(state.id)).executions).toHaveLength(0);
    }
  },
);
integration(
  'consumer rejects stale versions, altered parameters, unauthorized organizations and platform failure without writes',
  async () => {
    const state = await offered(),
      args = await approved(state),
      before = await count();
    const changedData = { ...data, damageDescription: 'Different signed action parameters' };
    const changedApproval = merchantSigning.sign(
      {
        issuer: origins.merchant,
        audience: origins.courier,
        transferId: args.transferId,
        subject: 'demo-user',
        caseType: 'delivery_damage',
        payloadSha256: hash(changedData),
        approvedFields: Object.keys(changedData),
        expiresAt: Date.now() + 60000,
        governance: { handoffId: state.id, version: 1 },
      },
      'porden-approval+jwt',
    );
    const changed = await post({ ...args, data: changedData, approval: changedApproval });
    expect(changed.status).toBe(409);
    expect((await changed.json()).error.code).toBe('SCOPE_MISMATCH');
    const forged = await post({ ...args, data: changedData });
    expect(forged.status).toBe(403);
    const integrationConfig = courierConfig.platform;
    if (!integrationConfig) throw Error('Missing test platform config');
    const outsider = createApp(
      { ...courierConfig, platform: { ...integrationConfig, token: tokenC } },
      courier,
      courierSigning,
      routeFetch,
    );
    expect((await post(args, outsider)).status).toBe(403);
    const unavailable = createApp(courierConfig, courier, courierSigning, async (input, init) =>
      String(input).startsWith(platformOrigin)
        ? Response.json({ error: { code: 'DATABASE_UNAVAILABLE' } }, { status: 503 })
        : routeFetch(input, init),
    );
    expect((await post(args, unavailable)).status).toBe(502);
    const revision = await receiver.proposeRevision(state.id, {
      version: 1,
      terms: { ...state.versions[0].terms, goal: 'Revised goal' },
      reason: 'Changed terms',
    });
    const revisionId = revision.handoff.pendingRevisionId;
    if (!revisionId) throw Error('Missing revision');
    // Advance only through a provisioned human approver, preserving the public transition rules.
    let cookie = '';
    const human = createHandoffClient({
      baseUrl: platformOrigin + '/api/v2',
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Origin', platformOrigin);
        if (cookie) headers.set('Cookie', cookie);
        const response = await routeFetch(input, { ...init, headers });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return response;
      },
    });
    await human.signIn({ login: 'approver', password: 'governed-test-approver' });
    await human.decideRevision(state.id, revisionId, { version: 2, decision: 'approved' });
    await receiver.acceptHandoff(state.id, { version: 2 });
    const stale = await post(args);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe('STALE_VERSION');
    expect(await count()).toBe(before);
  },
);
integration(
  'a failed case transaction keeps its reservation pinned until explicit reconciliation and settlement',
  async () => {
    const state = await offered(),
      args = await approved(state),
      before = await count();
    await courierSql
      .unsafe(
        "CREATE FUNCTION fail_governed_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced receipt failure'; END $$; CREATE TRIGGER fail_governed_receipt BEFORE INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION fail_governed_receipt()",
      )
      .simple();
    try {
      expect((await post(args)).status).toBe(500);
    } finally {
      await courierSql
        .unsafe(
          'DROP TRIGGER fail_governed_receipt ON receipts; DROP FUNCTION fail_governed_receipt()',
        )
        .simple();
    }
    expect(await count()).toBe(before);
    const reconciled = await receiver.reconcileOperation(args.transferId);
    const execution = reconciled.handoff.executions[0];
    expect(execution.status).toBe('reserved');
    await expect(sender.cancelHandoff(state.id, { version: 1 })).rejects.toMatchObject({
      code: 'EXECUTION_RESERVED',
    });
    await receiver.settleExecution(state.id, {
      version: 1,
      executionId: execution.id,
      outcome: 'failed',
      resultReference: 'Verified the case transaction rolled back',
    });
    expect((await sender.cancelHandoff(state.id, { version: 1 })).handoff.status).toBe('cancelled');
  },
);

integration(
  'case commit settles authorization once and exact replays return the same durable receipt',
  async () => {
    const state = await offered(),
      args = await approved(state),
      before = await count();
    const response = await post(args);
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(await count()).toBe(before + 1);
    const persisted = await receiver.getHandoff(state.id);
    expect(persisted.executions).toHaveLength(1);
    expect(persisted.executions[0].status).toBe('completed');
    const replay = await post(args);
    expect(replay.status).toBe(200);
    expect((await replay.json()).receipt).toBe(result.receipt);
    expect(await count()).toBe(before + 1);
    expect((await post({ ...args, requestId: 'different-request' })).status).toBe(409);
  },
);
integration(
  'lost settlement acknowledgement leaves a durable case for read-only reconciliation',
  async () => {
    const state = await offered(),
      args = await approved(state),
      before = await count();
    const lost = createApp(courierConfig, courier, courierSigning, async (input, init) => {
      const response = await routeFetch(input, init);
      if (String(input).endsWith('/executions/settle'))
        throw Error('Lost settlement acknowledgement');
      return response;
    });
    const result = await post(args, lost);
    expect(result.status).toBe(502);
    expect((await result.json()).error.code).toBe('OUTCOME_UNKNOWN');
    expect(await count()).toBe(before + 1);
    expect((await courier.findCase('transfer', args.transferId)).transferId).toBe(args.transferId);
    expect((await receiver.getHandoff(state.id)).executions[0].status).toBe('completed');
    expect((await post(args)).status).toBe(200);
    expect(await count()).toBe(before + 1);
  },
);
