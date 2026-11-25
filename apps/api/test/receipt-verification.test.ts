import { afterAll, beforeAll, expect, setSystemTime, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { CreateCase, ReceiptVerification } from '@porden/contracts';
import { ClaimView } from '@porden/contracts/delivery-claims';
import { createApp } from '../src/app';
import { errorResponse } from '../src/http/error-handler';
import { rateLimit } from '../src/http/rate-limit';
import { signer, type Fetcher } from '../src/security';
import { origins, startClaimsStack, type ClaimsStack } from './claims-stack';

// Public receipt verification against real receipts issued by the platform and the courier.
const url = process.env.PORDEN_TEST_DATABASE_URL;
const integration = url ? test : test.skip;
let stack: ClaimsStack;
let handoffReceipt: string, caseReceipt: string, approvalToken: string, handoffId: string;

async function json(response: Response, status = 200) {
  const body = await response.json();
  if (response.status !== status) throw Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}
/** Anonymous cross-site caller: no cookie, no CSRF token. */
function verify(role: 'merchant' | 'courier', receipt: unknown, app = stack.apps[role]) {
  return app.request('/api/v1/receipts/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://judge.example' },
    body: JSON.stringify({ receipt }),
  });
}
async function result(response: Response) {
  return ReceiptVerification.parse(await json(response));
}

beforeAll(async () => {
  if (!url) return;
  stack = await startClaimsStack({ url });
  const data = {
    orderReference: 'DEMO-1042' as const,
    damageDescription: 'Box crushed; vase cracked',
  };
  const view = ClaimView.parse(
    await json(
      await stack.site('merchant', 'POST', '/api/v1/claims', {
        requestId: crypto.randomUUID(),
        data,
        approvedFields: ['orderReference', 'damageDescription'],
        photoProvided: true,
        requestedResolution: { remedy: 'partial_refund', amountMinor: 3_000 },
      }),
      201,
    ),
  );
  handoffId = view.handoff.id;
  handoffReceipt = view.handoff.receipts[0].signedReceipt;
  await json(
    await stack.site('courier', 'POST', `/api/v1/claims/${handoffId}/decisions`, {
      requestId: crypto.randomUUID(),
      version: 1,
      decision: 'accept',
      reason: 'Within policy',
    }),
  );
  const draft = await stack.merchantStore.createDraft({
    recipientOrigin: origins.courier,
    caseType: 'delivery_damage',
    data,
    governance: { handoffId, version: 1 },
  });
  const consent = await stack.merchantStore.approve(
    draft.id,
    ['orderReference', 'damageDescription'],
    stack.routeFetch,
  );
  approvalToken = consent.arguments.approval;
  const created = await json(
    await stack.site(
      'courier',
      'POST',
      '/api/v1/cases',
      CreateCase.parse({ ...consent.arguments, requestId: `verify:${draft.id}` }),
    ),
    201,
  );
  caseReceipt = created.receipt;
});
const keys = resolve('tmp', `verifier-keys-${crypto.randomUUID()}`);
mkdirSync(keys, { recursive: true });
function newKey(name: string) {
  const path = resolve(keys, `${name}.pem`);
  writeFileSync(
    path,
    generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }),
  );
  return path;
}
function retiredFile(name: string, value: unknown) {
  const path = resolve(keys, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
afterAll(async () => {
  setSystemTime();
  if (stack) await stack.close();
  rmSync(keys, { recursive: true, force: true });
});

integration('platform handoff receipts verify on both sites without a session', async () => {
  for (const role of ['merchant', 'courier'] as const) {
    const response = await verify(role, handoffReceipt);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const checked = await result(response);
    if (!checked.valid || checked.receipt.kind !== 'handoff')
      throw Error('Expected a valid handoff receipt');
    expect(checked.issuer).toBe(origins.platform);
    expect(checked.receipt.claims.handoffId).toBe(handoffId);
    expect(checked.receipt.claims.action).toBe('created');
  }
});

integration(
  'courier case receipts verify with the agreed resolution and governing version',
  async () => {
    for (const role of ['merchant', 'courier'] as const) {
      const checked = await result(await verify(role, caseReceipt));
      if (!checked.valid || checked.receipt.kind !== 'delivery_case')
        throw Error('Expected a valid case receipt');
      expect(checked.issuer).toBe(origins.courier);
      expect(checked.receipt.claims.resolution).toEqual({
        remedy: 'partial_refund',
        amountMinor: 3_000,
        currency: 'USD',
      });
      expect(checked.receipt.claims.governance).toEqual({ handoffId, version: 1 });
    }
  },
);

integration(
  'tampered, malformed, foreign-key and unsupported tokens are reported as invalid',
  async () => {
    const [header, payload, signature] = caseReceipt.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const altered = Buffer.from(
      JSON.stringify({ ...claims, resolution: { remedy: 'reship' } }),
    ).toString('base64url');
    expect(await result(await verify('merchant', `${header}.${altered}.${signature}`))).toEqual({
      valid: false,
      reasonCode: 'SIGNATURE_INVALID',
    });
    // Correct issuer field, but signed with the merchant's key instead of the courier's. A verifier
    // with no cached keys fetches the courier's set, finds no such key ID and gives a definite verdict.
    const foreign = stack.signing.merchant.sign(claims, 'porden-receipt+jwt');
    const fresh: Fetcher = (input, init) => stack.routeFetch(input, init);
    const coldVerifier = createApp(
      stack.configs.merchant,
      stack.merchantStore,
      stack.signing.merchant,
      fresh,
    );
    expect(await result(await verify('merchant', foreign, coldVerifier))).toEqual({
      valid: false,
      reasonCode: 'SIGNATURE_INVALID',
    });
    expect(await result(await verify('merchant', 'not-a-receipt'))).toEqual({
      valid: false,
      reasonCode: 'MALFORMED',
    });
    expect(await result(await verify('courier', approvalToken))).toEqual({
      valid: false,
      reasonCode: 'UNSUPPORTED_TYPE',
    });
  },
);

integration('an untrusted issuer is refused without fetching its keys', async () => {
  const fetched: string[] = [];
  const watching: Fetcher = async (input, init) => {
    fetched.push(String(input));
    return stack.routeFetch(input, init);
  };
  const app = createApp(
    stack.configs.merchant,
    stack.merchantStore,
    stack.signing.merchant,
    watching,
  );
  const claims = JSON.parse(Buffer.from(caseReceipt.split('.')[1], 'base64url').toString());
  const evil = stack.signing.courier.sign(
    { ...claims, issuer: 'https://evil.example' },
    'porden-receipt+jwt',
  );
  expect(await result(await verify('merchant', evil, app))).toEqual({
    valid: false,
    reasonCode: 'UNTRUSTED_ISSUER',
  });
  expect(fetched).toEqual([]);
});

integration('unreachable issuer keys are an error, never an invalid verdict', async () => {
  const down: Fetcher = async (input, init) =>
    String(input).endsWith('/.well-known/jwks.json')
      ? new Response('unavailable', { status: 503 })
      : stack.routeFetch(input, init);
  const app = createApp(stack.configs.merchant, stack.merchantStore, stack.signing.merchant, down);
  const response = await verify('merchant', caseReceipt, app);
  expect(response.status).toBe(502);
  expect((await response.json()).error.code).toBe('VERIFICATION_UNAVAILABLE');
});

integration('the endpoint is public, read-only and validates its input', async () => {
  const preflight = await stack.apps.courier.request('/api/v1/receipts/verify', {
    method: 'OPTIONS',
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  expect((await verify('courier', 42)).status).toBe(400);
  expect((await verify('courier', 'x'.repeat(16_385))).status).toBe(400);
  const before = await stack.caseCount();
  await verify('courier', caseReceipt);
  expect(await stack.caseCount()).toBe(before);
});

test('rate limit: per-client and global ceilings with Retry-After and a fresh window', async () => {
  let clock = 1_000_000;
  const app = new Hono();
  app.onError((error, c) => {
    const result = errorResponse(error, crypto.randomUUID());
    return c.json(result.body, result.status);
  });
  app.post('/', rateLimit({ windowMs: 60_000, perClient: 2, total: 3, now: () => clock }), (c) =>
    c.json({ ok: true }),
  );
  const hit = (client: string) =>
    app.request('/', { method: 'POST', headers: { 'X-Forwarded-For': `203.0.113.9, ${client}` } });
  expect((await hit('198.51.100.1')).status).toBe(200);
  expect((await hit('198.51.100.1')).status).toBe(200);
  const limited = await hit('198.51.100.1');
  expect(limited.status).toBe(429);
  expect((await limited.json()).error.code).toBe('RATE_LIMITED');
  expect(limited.headers.get('Retry-After')).toBe('60');
  // The right-most address decides: a forged left-most entry does not bypass the limit.
  expect((await hit('198.51.100.2')).status).toBe(200);
  expect((await hit('198.51.100.3')).status).toBe(429); // global ceiling of 3 per window
  clock += 60_000;
  expect((await hit('198.51.100.1')).status).toBe(200);
});

integration('the public verifier enforces its rate limit', async () => {
  const app = createApp(
    stack.configs.courier,
    stack.courierStore,
    stack.signing.courier,
    stack.routeFetch,
  );
  const send = (client: string) =>
    app.request('/api/v1/receipts/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client },
      body: JSON.stringify({ receipt: 'not-a-receipt' }),
    });
  for (let index = 0; index < 30; index += 1) expect((await send('192.0.2.7')).status).toBe(200);
  const limited = await send('192.0.2.7');
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect((await send('192.0.2.8')).status).toBe(200);
});

integration(
  'issuer keys are cached; an unknown key ID refreshes at most every 30 seconds',
  async () => {
    const fetched: string[] = [];
    const counting: Fetcher = async (input, init) => {
      if (String(input).endsWith('/.well-known/jwks.json')) fetched.push(String(input));
      return stack.routeFetch(input, init);
    };
    const app = createApp(
      stack.configs.merchant,
      stack.merchantStore,
      stack.signing.merchant,
      counting,
    );
    setSystemTime(new Date('2026-12-01T00:00:00Z'));
    for (let index = 0; index < 5; index += 1)
      expect((await result(await verify('merchant', caseReceipt, app))).valid).toBe(true);
    expect(fetched).toHaveLength(1);
    // A token with an unknown key ID cannot force a key fetch on every request.
    const claims = JSON.parse(Buffer.from(caseReceipt.split('.')[1], 'base64url').toString());
    const unknownKid = signer({ keyPath: newKey('unknown'), keyId: 'porden-courier-unknown' }).sign(
      claims,
      'porden-receipt+jwt',
    );
    setSystemTime(new Date('2026-12-01T00:00:10Z'));
    // Within the refresh throttle the key may simply be new (rotation): "not checked", never "invalid".
    for (let index = 0; index < 5; index += 1) {
      const throttled = await verify('merchant', unknownKid, app);
      expect(throttled.status).toBe(502);
      expect((await throttled.json()).error.code).toBe('VERIFICATION_UNAVAILABLE');
    }
    expect(fetched).toHaveLength(1);
    setSystemTime(new Date('2026-12-01T00:00:45Z'));
    // After a fresh fetch the key ID is still unknown: now it is a definite verdict.
    expect(await result(await verify('merchant', unknownKid, app))).toEqual({
      valid: false,
      reasonCode: 'SIGNATURE_INVALID',
    });
    expect(fetched).toHaveLength(2);
    setSystemTime();
  },
);

integration(
  'key rotation: receipts signed before rotation verify through retired public keys',
  async () => {
    const retired = retiredFile('courier-retired', { keys: [stack.signing.courier.jwk] });
    const rotated = {
      ...stack.configs.courier,
      keyPath: newKey('courier-v2'),
      keyId: 'porden-courier-v2',
    };
    const withRetired = signer({ ...rotated, retiredKeysPath: retired });
    const withoutRetired = signer(rotated);
    expect(withRetired.jwks.keys.map((key) => key.kid)).toEqual([
      'porden-courier-v2',
      'porden-courier-v1',
    ]);
    const verifierFor = (courierSigning: ReturnType<typeof signer>) => {
      const courierApp = createApp(rotated, stack.courierStore, courierSigning, stack.routeFetch);
      const fetcher: Fetcher = (input, init) =>
        new URL(String(input)).origin === origins.courier
          ? Promise.resolve(courierApp.request(String(input), init))
          : stack.routeFetch(input, init);
      return createApp(
        stack.configs.merchant,
        stack.merchantStore,
        stack.signing.merchant,
        fetcher,
      );
    };
    // caseReceipt was signed with the original v1 key before the rotation.
    const before = await result(await verify('merchant', caseReceipt, verifierFor(withRetired)));
    expect(before.valid).toBe(true);
    const claims = JSON.parse(Buffer.from(caseReceipt.split('.')[1], 'base64url').toString());
    const after = withRetired.sign(claims, 'porden-receipt+jwt');
    expect((await result(await verify('merchant', after, verifierFor(withRetired)))).valid).toBe(
      true,
    );
    // Without the retired key, old receipts can no longer be checked; this is why it stays published.
    expect(
      await result(await verify('merchant', caseReceipt, verifierFor(withoutRetired))),
    ).toEqual({
      valid: false,
      reasonCode: 'SIGNATURE_INVALID',
    });
  },
);

test('retired key files fail fast on private material, duplicates or malformed keys', () => {
  const keyPath = newKey('startup');
  const current = signer({ keyPath, keyId: 'current' });
  const privateJwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
    format: 'jwk',
  });
  const withPrivate = retiredFile('private', {
    keys: [{ ...privateJwk, kid: 'old', alg: 'ES256', use: 'sig' }],
  });
  expect(() => signer({ keyPath, keyId: 'current', retiredKeysPath: withPrivate })).toThrow(
    'no private fields',
  );
  const duplicate = retiredFile('duplicate', { keys: [current.jwk] });
  expect(() => signer({ keyPath, keyId: 'current', retiredKeysPath: duplicate })).toThrow(
    'Duplicate',
  );
  const broken = retiredFile('broken', { keys: [{ ...current.jwk, kid: 'old', x: 'AAAA' }] });
  expect(() => signer({ keyPath, keyId: 'current', retiredKeysPath: broken })).toThrow();
  expect(current.jwks.keys).toHaveLength(1);
});

integration(
  'unreadable or mixed issuer key sets: "not checked" or skip unusable keys, never a false verdict',
  async () => {
    const keySet =
      (body: BodyInit, type = 'application/json'): Fetcher =>
      async (input, init) =>
        String(input).endsWith('/.well-known/jwks.json')
          ? new Response(body, { headers: { 'Content-Type': type } })
          : stack.routeFetch(input, init);
    const html = createApp(
      stack.configs.merchant,
      stack.merchantStore,
      stack.signing.merchant,
      keySet('<html>maintenance</html>', 'text/html'),
    );
    const broken = await verify('merchant', caseReceipt, html);
    expect(broken.status).toBe(502);
    expect((await broken.json()).error.code).toBe('VERIFICATION_UNAVAILABLE');
    const mixed = createApp(
      stack.configs.merchant,
      stack.merchantStore,
      stack.signing.merchant,
      keySet(
        JSON.stringify({
          keys: [
            { kid: 'rsa-1', kty: 'RSA', alg: 'RS256', n: 'x', e: 'AQAB' },
            stack.signing.courier.jwk,
          ],
        }),
      ),
    );
    expect((await result(await verify('merchant', caseReceipt, mixed))).valid).toBe(true);
  },
);

integration('cross-origin callers can read rate-limit responses', async () => {
  const app = createApp(
    stack.configs.courier,
    stack.courierStore,
    stack.signing.courier,
    stack.routeFetch,
  );
  const send = () =>
    app.request('/api/v1/receipts/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://judge.example',
        'X-Forwarded-For': '192.0.2.99',
      },
      body: JSON.stringify({ receipt: 'not-a-receipt' }),
    });
  for (let index = 0; index < 30; index += 1) await send();
  const limited = await send();
  expect(limited.status).toBe(429);
  expect(limited.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(limited.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After');
  const tooLarge = await app.request('/api/v1/receipts/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.100' },
    body: JSON.stringify({ receipt: 'x'.repeat(70_000) }),
  });
  expect(tooLarge.status).toBe(413);
  expect(tooLarge.headers.get('Access-Control-Allow-Origin')).toBe('*');
});

integration('sign-in attempts are rate limited per client', async () => {
  const app = createApp(
    stack.configs.merchant,
    stack.merchantStore,
    stack.signing.merchant,
    stack.routeFetch,
  );
  const attempt = (client: string) =>
    app.request('/api/v1/session', {
      method: 'POST',
      headers: {
        Origin: origins.merchant,
        'Content-Type': 'application/json',
        'X-Forwarded-For': client,
      },
      body: JSON.stringify({ password: 'wrong-password' }),
    });
  for (let index = 0; index < 20; index += 1)
    expect((await attempt('198.51.100.20')).status).toBe(401);
  const limited = await attempt('198.51.100.20');
  expect(limited.status).toBe(429);
  expect((await limited.json()).error.code).toBe('RATE_LIMITED');
  expect((await attempt('198.51.100.21')).status).toBe(401);
});
