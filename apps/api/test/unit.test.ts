import { afterAll, describe, expect, test } from 'bun:test';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config';
import { signer, verifyToken, sessionTools, hash } from '../src/security';
import { createApp } from '../src/app';
import type { store } from '../src/db/store';
import { signedReceiptFixture, invalidReceiptFixture } from '@porden/sdk/fixtures';

const directory = resolve(`tmp/unit-${crypto.randomUUID()}`);
mkdirSync(directory, {recursive: true});
const keyPath = resolve(directory, 'key.pem');
writeFileSync(keyPath, generateKeyPairSync('ec', {namedCurve: 'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}));
const env = {ORGANIZATION_ROLE:'merchant', PUBLIC_ORIGIN:'http://localhost:4100', PEER_ORIGIN:'http://localhost:4200',
  DATABASE_URL:'postgres://localhost/test', SESSION_SECRET:'s'.repeat(32), PARTNER_SECRET:'p'.repeat(32),
  DEMO_PASSWORD:'demo-password', SIGNING_KEY_PATH:keyPath};
const config = loadConfig(env), signing = signer(config);
afterAll(() => rmSync(directory, {recursive:true,force:true}));
const keyFetch = async () => Response.json(signedReceiptFixture.jwks);

test('signed receipt fixture verifies, tampering and algorithm substitution fail', async () => {
  expect(await verifyToken(signedReceiptFixture.token, 'https://courier.example', 'porden-receipt+jwt', keyFetch)).toEqual(signedReceiptFixture.claims);
  await expect(verifyToken(invalidReceiptFixture, 'https://courier.example', 'porden-receipt+jwt', keyFetch)).rejects.toThrow('SIGNATURE_INVALID');
  await expect(verifyToken(signedReceiptFixture.token, 'https://courier.example', 'porden-approval+jwt', keyFetch)).rejects.toThrow();
});
test('sessions expire and cannot be forged; canonical hashes ignore object key order', () => {
  const tools = sessionTools(config), token = tools.issue();
  expect(tools.valid(token)).toBe(true);
  expect(tools.valid(token + 'x')).toBe(false);
  expect(tools.valid('garbage')).toBe(false);
  const expired = Buffer.from(JSON.stringify({user:'demo-user',exp:Date.now()-1000})).toString('base64url');
  const mac = createHmac('sha256',config.sessionSecret).update(expired).digest('base64url');
  expect(tools.valid(`${expired}.${mac}`)).toBe(false);
  expect(hash({b:2,a:1})).toBe(hash({a:1,b:2}));
});
test('configuration rejects shared origins and SQLite', () => {
  expect(() => loadConfig({...env, PEER_ORIGIN:env.PUBLIC_ORIGIN})).toThrow();
  expect(() => loadConfig({...env, DATABASE_URL:'sqlite:test'})).toThrow();
});
describe('HTTP trust boundary', () => {
  const db = {ready: async () => {}} as ReturnType<typeof store>;
  const app = createApp(config, db, signing);
  test('login requires first-party origin and correct password', async () => {
    const input = {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:'demo-password'})};
    expect((await app.request('/api/v1/session', input)).status).toBe(403);
    const response = await app.request('/api/v1/session', {...input, headers:{...input.headers, Origin:config.origin}});
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });
  test('authenticated writes enforce exact origin and CSRF before database calls', async () => {
    const tools = sessionTools(config), token = tools.issue();
    const headers = {Cookie:`porden_merchant_session=${token}`, 'Content-Type':'application/json', Origin:config.origin};
    expect((await app.request('/api/v1/transfers', {method:'POST',headers,body:'{}'})).status).toBe(403);
    expect((await app.request('/api/v1/transfers', {method:'POST',headers:{...headers,'X-CSRF-Token':tools.csrf(token),Origin:'https://evil.example'},body:'{}'})).status).toBe(403);
    expect((await app.request('/api/v1/transfers', {method:'POST',headers:{...headers,'X-CSRF-Token':tools.csrf(token)},body:'{}'})).status).toBe(400);
  });
  test('JWKS is public but session, transfer and partner lookups are protected', async () => {
    expect((await app.request('/.well-known/jwks.json')).status).toBe(200);
    expect((await app.request('/api/v1/session')).status).toBe(401);
    const courier = createApp({...config,role:'courier'}, db, signing);
    expect((await courier.request('/api/v1/cases/by-request/anything')).status).toBe(401);
  });
  test('runtime assets are allowlisted; discovery uses configured business origins', async () => {
    expect((await app.request('/runtime/package.json')).status).toBe(404);
    const manifest = await (await app.request('/agent-manifest.json')).json();
    expect(manifest.allowed_peers).toEqual([config.peerOrigin]);
    expect((await app.request('/runtime/engine.js')).headers.get('content-type')).toContain('javascript');
  });
  test('receiver checks signed consent payload, audience and expiry before attempting a case write', async () => {
    const courierConfig = {...config,role:'courier' as const,origin:config.peerOrigin,peerOrigin:config.origin};
    const courier = createApp(courierConfig,db,signing,async () => Response.json({keys:[signing.jwk]}));
    const tools = sessionTools(courierConfig), token = tools.issue();
    const headers = {Origin:courierConfig.origin,'Content-Type':'application/json',Cookie:`porden_courier_session=${token}`,'X-CSRF-Token':tools.csrf(token)};
    const data = {orderReference:'DEMO-1042',damageDescription:'Damaged parcel'};
    const transferId = crypto.randomUUID();
    const claims = {issuer:config.origin,audience:courierConfig.origin,transferId,subject:'demo-user',caseType:'delivery_damage',
      payloadSha256:hash(data),approvedFields:Object.keys(data),expiresAt:Date.now()+60000};
    for (const changed of [{expiresAt:Date.now()-1},{audience:'https://evil.example'},{payloadSha256:'a'.repeat(64)}]) {
      const approval = signing.sign({...claims,...changed},'porden-approval+jwt');
      const response = await courier.request('/api/v1/cases',{method:'POST',headers,body:JSON.stringify({transferId,caseType:'delivery_damage',data,approval,requestId:'official:1'})});
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('CONSENT_SCOPE_MISMATCH');
    }
  });
});
