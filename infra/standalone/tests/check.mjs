import assert from 'node:assert/strict';
import { SQL } from 'bun';
import { createHandoffClient, hashParameters, HandoffWriteUnknown } from '/app/packages/sdk/src/index.ts';
import { CreateCase, Approval, CaseResponse, Draft } from '/app/packages/contracts/src/index.ts';

const api = 'https://api.porden.test', merchantOrigin = 'https://merchant.porden.test', courierOrigin = 'https://courier.porden.test';
const tests = [];
async function check(name, run) { await run(); tests.push(name); console.log('PASS ' + name); }
const databases = {};
try {
  await check('private PostgreSQL, distinct non-superuser owners and cross-database denial', async () => {
    for (const role of ['platform', 'merchant', 'courier']) {
      const url = process.env[role.toUpperCase() + '_DATABASE_URL'];
      const sql = new SQL({url, prepare: false}); databases[role] = sql;
      const [identity] = await sql`SELECT current_user AS name, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()`;
      assert.equal(identity.name, 'porden_' + role); assert.equal(identity.ssl, false);
      const [privileges] = await sql`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
      assert.ok(Object.values(privileges).every(value => value === false));
      const other = role === 'courier' ? 'merchant' : 'courier';
      const crossed = new URL(url); crossed.pathname = '/porden_' + other;
      const denied = new SQL(crossed.href);
      try { await assert.rejects(async () => denied`SELECT 1`, error => error.errno === '42501'); }
      finally { await denied.close(); }
      await assert.rejects(async () => sql.unsafe('SET ROLE porden_' + other), error => error.errno === '42501');
    }
    const bad = new URL(process.env.PLATFORM_DATABASE_URL); bad.password = 'invalid-release-password';
    const wrongPassword = new SQL(bad.href);
    try { await assert.rejects(async () => wrongPassword`SELECT 1`, error => error.errno === '28P01'); }
    finally { await wrongPassword.close(); }
  });
  const sender = createHandoffClient({baseUrl: api + '/api/v2', token: process.env.MERCHANT_INTEGRATION_TOKEN});
  const receiver = createHandoffClient({baseUrl: api + '/api/v2', token: process.env.COURIER_INTEGRATION_TOKEN});
  let humanCookie = '';
  const human = createHandoffClient({baseUrl: merchantOrigin + '/api/v2', fetch: async (url, init) => {
    const headers = new Headers(init?.headers); headers.set('Origin', merchantOrigin);
    if (humanCookie) headers.set('Cookie', humanCookie);
    const response = await fetch(url, {...init, headers});
    const cookie = response.headers.get('set-cookie');
    if (cookie) {
      assert.match(cookie, /Secure/i); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i);
      assert.ok(!/Domain=/i.test(cookie)); humanCookie = cookie.split(';')[0];
    }
    return response;
  }});
  function business(origin) {
    let cookie = '', csrf = '';
    return async (path, body) => {
      const headers = {Origin: origin, 'Content-Type': 'application/json'};
      if (cookie) headers.Cookie = cookie;
      if (csrf) headers['X-CSRF-Token'] = csrf;
      const response = await fetch(origin + '/api/v1' + path, {method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)});
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        assert.match(setCookie, /Secure/i); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i);
        cookie = setCookie.split(';')[0];
      }
      if (path === '/session' && response.ok) csrf = (await response.clone().json()).csrf;
      return response;
    };
  }
  const merchant = business(merchantOrigin), courier = business(courierOrigin);
  await check('HTTPS certificates are verified and readiness is reachable on all three services', async () => {
    for (const origin of [api, merchantOrigin, courierOrigin]) {
      assert.equal((await fetch(origin + '/health')).status, 200);
      assert.equal((await fetch(origin + '/ready')).status, 200);
    }
    const wrongCA = await Bun.file('/certs/wrong-ca.pem').text();
    await assert.rejects(() => fetch(api + '/health', {tls: {ca: wrongCA}}));
  });
  await check('exact CORS allowlist, credentialed preflight, CSRF and organization boundaries', async () => {
    const preflight = await fetch(api + '/api/v2/handoffs', {method: 'OPTIONS', headers: {Origin: merchantOrigin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-csrf-token'}});
    assert.equal(preflight.headers.get('access-control-allow-origin'), merchantOrigin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    const evil = await fetch(api + '/api/v2/handoffs', {headers: {Origin: 'https://evil.porden.test', Authorization: 'Bearer ' + process.env.MERCHANT_INTEGRATION_TOKEN}});
    assert.equal(evil.status, 403); assert.equal(evil.headers.get('access-control-allow-origin'), null);
    await human.signIn({login: 'release-approver', password: process.env.TEST_HUMAN_PASSWORD});
    assert.equal((await human.session()).principal.organizationId, process.env.MERCHANT_ORGANIZATION_ID);
    const forged = await fetch(api + '/api/v2/handoffs', {method: 'POST', headers: {Origin: merchantOrigin, Cookie: humanCookie, 'Content-Type': 'application/json'}, body: '{}'});
    assert.equal(forged.status, 403);
    assert.equal((await merchant('/session', {password: process.env.MERCHANT_DEMO_PASSWORD})).status, 200);
    assert.equal((await courier('/session', {password: process.env.COURIER_DEMO_PASSWORD})).status, 200);
  });
  const data = {orderReference: 'DEMO-1042', damageDescription: 'Synthetic release TLS inspection'};
  const scope = {action: 'courier.create_case', parametersSha256: await hashParameters({caseType: 'delivery_damage', data})};
  let handoff, transfer, args;
  const caseCount = async () => (await databases.courier`SELECT count(*)::int AS count FROM cases`)[0].count;
  await check('governed HTTPS consumer requests fail before approval/acceptance without database writes', async () => {
    handoff = (await sender.createHandoff({receiverOrganizationId: process.env.COURIER_ORGANIZATION_ID, terms: {goal: 'Inspect release fixture', constraints: ['Use the exact payload'], acceptanceCriteria: ['Persist a signed case receipt'], executionScopes: [scope]}})).handoff;
    assert.equal(handoff.status, 'draft');
    transfer = Draft.parse(await (await merchant('/transfers', {recipientOrigin: courierOrigin, caseType: 'delivery_damage', data, governance: {handoffId: handoff.id, version: 1}})).json());
    const approval = Approval.parse(await (await merchant('/transfers/' + transfer.id + '/approve', {approvedFields: ['orderReference', 'damageDescription']})).json());
    args = CreateCase.parse({...approval.arguments, requestId: 'release:' + crypto.randomUUID()});
    const before = await caseCount();
    assert.equal((await courier('/cases', args)).status, 409);
    await human.approveHandoff(handoff.id, {version: 1});
    assert.equal((await courier('/cases', args)).status, 409);
    assert.equal(await caseCount(), before);
    await assert.rejects(receiver.cancelHandoff(handoff.id, {version: 1}), error => error.status === 403);
  });
  await check('SDK acceptance, TLS peer verification, protected write, replay and signed receipts', async () => {
    await receiver.acceptHandoff(handoff.id, {version: 1});
    assert.equal((await receiver.verifyAuthorization(handoff.id, {version: 1, ...scope})).eligible, true);
    const before = await caseCount();
    const tampered = await courier('/cases', {...args, data: {...data, damageDescription: 'Tampered release inspection'}});
    assert.equal(tampered.status, 403); assert.equal(await caseCount(), before);
    assert.equal((await merchant('/transfers/' + transfer.id + '/submit', {})).status, 200);
    const created = await courier('/cases', args); assert.equal(created.status, 201);
    const receipt = CaseResponse.parse(await created.json());
    const replay = await courier('/cases', args); assert.equal(replay.status, 200);
    assert.equal(CaseResponse.parse(await replay.json()).receipt, receipt.receipt);
    assert.equal(await caseCount(), before + 1);
    const accepted = await merchant('/transfers/' + transfer.id + '/receipts', {requestId: args.requestId, receipt: receipt.receipt});
    assert.equal(accepted.status, 200);
    assert.equal((await databases.merchant`SELECT status FROM transfers WHERE id=${transfer.id}`)[0].status, 'accepted');
    const state = await receiver.getHandoff(handoff.id); assert.equal(state.executions[0].status, 'completed');
    const finished = await receiver.finishHandoff(handoff.id, {version: 1, status: 'completed', note: 'Agent-reported fixture complete', criterionResults: [{criterionIndex: 0, met: true}]});
    assert.equal((await receiver.verifyReceipt(finished.receipt.signedReceipt)).event.type, 'completion');
  });
  await check('uncertain SDK writes reconcile read-only over HTTPS without an automatic retry', async () => {
    let calls = 0, operationId;
    const unknown = createHandoffClient({baseUrl: api + '/api/v2', token: process.env.MERCHANT_INTEGRATION_TOKEN, fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (init?.method === 'POST') { calls++; throw Error('Lost acknowledgement after commit'); }
      return response;
    }});
    try { await unknown.createHandoff({receiverOrganizationId: process.env.COURIER_ORGANIZATION_ID, terms: {goal: 'Reconcile release fixture', constraints: [], acceptanceCriteria: ['Read the persisted operation']}}); assert.fail('Expected unknown outcome'); }
    catch (error) { assert.ok(error instanceof HandoffWriteUnknown); operationId = error.operationId; }
    assert.equal(calls, 1); assert.equal((await sender.reconcileOperation(operationId)).receipt.requestId, operationId);
  });
  await check('nsDeploy HTTPS manifests, exact peer origins, action module and pinned runtime assets', async () => {
    for (const [origin, role] of [[merchantOrigin, 'merchant'], [courierOrigin, 'courier']]) {
      const response = await fetch(origin + '/agent-manifest.json'); assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      const manifest = await response.json(); assert.equal(manifest.linking.site, origin);
      assert.equal(manifest.actions.module, './actions.js');
      for (const path of ['/actions.js', '/runtime/engine.js', '/runtime/action-transport.js', '/runtime/action-bridge.js', '/action-bridge.html', '/' + role + '.network.json']) assert.equal((await fetch(origin + path)).status, 200);
      const policy = await (await fetch(origin + '/action-policy.json')).json();
      assert.ok(policy.callerOrigins.includes(origin)); assert.ok(policy.callerOrigins.every(value => value.startsWith('https://')));
    }
    const manifest = await (await fetch(merchantOrigin + '/agent-manifest.json')).json();
    assert.equal(manifest.linking.imports[0].target, courierOrigin + '/courier');
  });
  console.log(JSON.stringify({passed: tests.length, tests}));
} finally { await Promise.all(Object.values(databases).map(database => database.close())); }
