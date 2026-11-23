import { afterAll, describe, expect, test, spyOn } from 'bun:test';
import { DrizzleQueryError } from 'drizzle-orm';
import { ErrorResponse, errorMessages } from '@porden/contracts';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config';
import { signer, verifyToken, sessionTools, hash } from '../src/security';
import { createApp } from '../src/app';
import type { store } from '../src/db/store';
import { logger } from '../src/observability/logger';
import { signedReceiptFixture, invalidReceiptFixture } from '@porden/sdk/fixtures';

const directory = resolve(`tmp/unit-${crypto.randomUUID()}`);
mkdirSync(directory, { recursive: true });
const keyPath = resolve(directory, 'key.pem');
writeFileSync(
  keyPath,
  generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }),
);
const env = {
  ORGANIZATION_ROLE: 'merchant',
  PUBLIC_ORIGIN: 'http://localhost:4100',
  PEER_ORIGIN: 'http://localhost:4200',
  DATABASE_URL: 'postgres://localhost/test',
  SESSION_SECRET: 's'.repeat(32),
  PARTNER_SECRET: 'p'.repeat(32),
  DEMO_PASSWORD: 'demo-password',
  SIGNING_KEY_PATH: keyPath,
};
const config = loadConfig(env),
  signing = signer(config);
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const keyFetch = async () => Response.json(signedReceiptFixture.jwks);

test('signed receipt fixture verifies, tampering and algorithm substitution fail', async () => {
  expect(
    await verifyToken(
      signedReceiptFixture.token,
      'https://courier.example',
      'porden-receipt+jwt',
      keyFetch,
    ),
  ).toEqual(signedReceiptFixture.claims);
  await expect(
    verifyToken(invalidReceiptFixture, 'https://courier.example', 'porden-receipt+jwt', keyFetch),
  ).rejects.toThrow('SIGNATURE_INVALID');
  await expect(
    verifyToken(
      signedReceiptFixture.token,
      'https://courier.example',
      'porden-approval+jwt',
      keyFetch,
    ),
  ).rejects.toThrow();
});
test('sessions expire and cannot be forged; canonical hashes ignore object key order', () => {
  const tools = sessionTools(config),
    token = tools.issue();
  expect(tools.valid(token)).toBe(true);
  expect(tools.valid(token + 'x')).toBe(false);
  expect(tools.valid('garbage')).toBe(false);
  const expired = Buffer.from(
    JSON.stringify({ user: 'demo-user', exp: Date.now() - 1000 }),
  ).toString('base64url');
  const mac = createHmac('sha256', config.sessionSecret).update(expired).digest('base64url');
  expect(tools.valid(`${expired}.${mac}`)).toBe(false);
  expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 }));
});
test('configuration rejects shared origins and SQLite', () => {
  expect(() => loadConfig({ ...env, PEER_ORIGIN: env.PUBLIC_ORIGIN })).toThrow();
  expect(() => loadConfig({ ...env, DATABASE_URL: 'sqlite:test' })).toThrow();
});
describe('HTTP trust boundary', () => {
  const db = { ready: async () => {} } as ReturnType<typeof store>;
  const app = createApp(config, db, signing);
  test('login requires first-party origin and correct password', async () => {
    const input = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'demo-password' }),
    };
    expect((await app.request('/api/v1/session', input)).status).toBe(403);
    const response = await app.request('/api/v1/session', {
      ...input,
      headers: { ...input.headers, Origin: config.origin },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });
  test('authenticated writes enforce exact origin and CSRF before database calls', async () => {
    const tools = sessionTools(config),
      token = tools.issue();
    const headers = {
      Cookie: `porden_merchant_session=${token}`,
      'Content-Type': 'application/json',
      Origin: config.origin,
    };
    expect(
      (await app.request('/api/v1/transfers', { method: 'POST', headers, body: '{}' })).status,
    ).toBe(403);
    expect(
      (
        await app.request('/api/v1/transfers', {
          method: 'POST',
          headers: {
            ...headers,
            'X-CSRF-Token': tools.csrf(token),
            Origin: 'https://evil.example',
          },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request('/api/v1/transfers', {
          method: 'POST',
          headers: { ...headers, 'X-CSRF-Token': tools.csrf(token) },
          body: '{}',
        })
      ).status,
    ).toBe(400);
  });
  test('JWKS is public but session, transfer and partner lookups are protected', async () => {
    expect((await app.request('/.well-known/jwks.json')).status).toBe(200);
    expect((await app.request('/api/v1/session')).status).toBe(401);
    const courier = createApp({ ...config, role: 'courier' }, db, signing);
    expect((await courier.request('/api/v1/cases/by-request/anything')).status).toBe(401);
  });
  test('runtime assets are allowlisted; discovery uses configured business origins', async () => {
    expect((await app.request('/runtime/package.json')).status).toBe(404);
    const manifest = await (await app.request('/agent-manifest.json')).json();
    expect(manifest.allowed_peers).toEqual([config.peerOrigin]);
    expect((await app.request('/runtime/engine.js')).headers.get('content-type')).toContain(
      'javascript',
    );
  });
  test('provider network failures return a stable 502 response without leaking credentials', async () => {
    const configured = { ...config, openrouterKey: 'unit-test-private-key' };
    const unavailable = createApp(configured, db, signing, async () => {
      throw new TypeError('Connection refused');
    });
    const tools = sessionTools(configured),
      token = tools.issue();
    const response = await unavailable.request('/api/llm/chat/completions', {
      method: 'POST',
      headers: {
        Origin: config.origin,
        Cookie: `porden_merchant_session=${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'test', messages: [] }),
    });
    expect(response.status).toBe(502);
    const payload = ErrorResponse.parse(await response.json());
    expect(payload.error).toMatchObject({
      code: 'PROVIDER_CONNECTION_FAILED',
      message: errorMessages.PROVIDER_CONNECTION_FAILED,
    });
    expect(payload.error.requestId).toBe(response.headers.get('X-Request-Id') || undefined);
  });
  test('receiver checks signed consent payload, audience and expiry before attempting a case write', async () => {
    const courierConfig = {
      ...config,
      role: 'courier' as const,
      origin: config.peerOrigin,
      peerOrigin: config.origin,
    };
    const courier = createApp(courierConfig, db, signing, async () =>
      Response.json({ keys: [signing.jwk] }),
    );
    const tools = sessionTools(courierConfig),
      token = tools.issue();
    const headers = {
      Origin: courierConfig.origin,
      'Content-Type': 'application/json',
      Cookie: `porden_courier_session=${token}`,
      'X-CSRF-Token': tools.csrf(token),
    };
    const data = { orderReference: 'DEMO-1042', damageDescription: 'Damaged parcel' };
    const transferId = crypto.randomUUID();
    const claims = {
      issuer: config.origin,
      audience: courierConfig.origin,
      transferId,
      subject: 'demo-user',
      caseType: 'delivery_damage',
      payloadSha256: hash(data),
      approvedFields: Object.keys(data),
      expiresAt: Date.now() + 60000,
    };
    for (const changed of [
      { expiresAt: Date.now() - 1 },
      { audience: 'https://evil.example' },
      { payloadSha256: 'a'.repeat(64) },
    ]) {
      const approval = signing.sign({ ...claims, ...changed }, 'porden-approval+jwt');
      const response = await courier.request('/api/v1/cases', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transferId,
          caseType: 'delivery_damage',
          data,
          approval,
          requestId: 'official:1',
        }),
      });
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('CONSENT_SCOPE_MISMATCH');
    }
  });
});

describe('consistent failure boundaries', () => {
  const db = { ready: async () => {} } as ReturnType<typeof store>;
  const tools = sessionTools(config),
    token = tools.issue();
  const headers = {
    Origin: config.origin,
    Cookie: `porden_merchant_session=${token}`,
    'Content-Type': 'application/json',
    'X-CSRF-Token': tools.csrf(token),
  };
  async function check(response: Response, code: string, status: number) {
    expect(response.status).toBe(status);
    const payload = ErrorResponse.parse(await response.json());
    expect(payload.error.code).toBe(code);
    expect(payload.error.message).toBe(errorMessages[code]);
    expect(payload.error.requestId).toBe(response.headers.get('X-Request-Id') || undefined);
    expect(JSON.stringify(payload)).not.toContain('private-secret');
    return payload;
  }
  async function provider(fetcher: Parameters<typeof createApp>[3]) {
    return createApp({ ...config, openrouterKey: 'private-secret' }, db, signing, fetcher).request(
      '/api/llm/chat/completions',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'test', messages: [] }),
      },
    );
  }
  test('malformed JSON, validation, missing route, body limit and readiness use the same envelope', async () => {
    const app = createApp(config, db, signing);
    await check(
      await app.request('/api/v1/session', { method: 'POST', headers, body: '{' }),
      'INVALID_INPUT',
      400,
    );
    await check(
      await app.request('/api/v1/session', { method: 'POST', headers, body: '{}' }),
      'INVALID_INPUT',
      400,
    );
    await check(await app.request('/missing'), 'NOT_FOUND', 404);
    await check(
      await app.request('/api/v1/session', { method: 'POST', headers, body: 'x'.repeat(65537) }),
      'PAYLOAD_TOO_LARGE',
      413,
    );
    const notReady = createApp(
      config,
      {
        ...db,
        ready: async () => {
          throw Error('private-secret');
        },
      },
      signing,
    );
    await check(await notReady.request('/readyz'), 'NOT_READY', 503);
  });
  test('nested system codes are recorded without secrets or query bodies', async () => {
    const logs = spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const cause = Object.assign(new Error('private-secret'), { code: 'EACCES' });
      await check(
        await provider(async () => {
          throw new TypeError('private-secret', { cause });
        }),
        'PROVIDER_CONNECTION_FAILED',
        502,
      );
      expect(logs.mock.calls.some((call) => JSON.stringify(call).includes('EACCES'))).toBe(true);
      expect(JSON.stringify(logs.mock.calls)).not.toContain('private-secret');
    } finally {
      logs.mockRestore();
    }
  });
  test('provider timeout and HTTP failures are classified without returning upstream bodies', async () => {
    await check(
      await provider(async () => {
        throw new DOMException('private-secret', 'TimeoutError');
      }),
      'PROVIDER_TIMEOUT',
      504,
    );
    for (const [upstream, code, status] of [
      [400, 'PROVIDER_REQUEST_REJECTED', 502],
      [401, 'PROVIDER_AUTHENTICATION_FAILED', 502],
      [402, 'PROVIDER_CREDITS_EXHAUSTED', 503],
      [403, 'PROVIDER_AUTHENTICATION_FAILED', 502],
      [404, 'PROVIDER_MODEL_UNAVAILABLE', 502],
      [429, 'PROVIDER_RATE_LIMITED', 429],
      [500, 'PROVIDER_UNAVAILABLE', 502],
    ] as const)
      await check(
        await provider(async () => new Response('private-secret', { status: upstream })),
        code,
        status,
      );
  });
  test('unexpected exceptions, non-Error throws, database failures and conflicts are contained', async () => {
    const id = crypto.randomUUID();
    for (const [cause, code, status] of [
      [new Error('private-secret'), 'INTERNAL_ERROR', 500],
      ['private-secret', 'INTERNAL_ERROR', 500],
      [
        new DrizzleQueryError(
          'private-secret',
          [],
          Object.assign(new Error('private-secret'), { errno: '08006' }),
        ),
        'DATABASE_UNAVAILABLE',
        503,
      ],
      [
        new DrizzleQueryError(
          'private-secret',
          [],
          Object.assign(new Error('private-secret'), { errno: '23505' }),
        ),
        'REQUEST_CONFLICT',
        409,
      ],
    ] as const) {
      const failing = {
        ...db,
        getDraft: async () => {
          throw cause;
        },
      };
      const app = createApp(config, failing, signing);
      await check(await app.request(`/api/v1/transfers/${id}`, { headers }), code, status);
    }
  });
  test('courier lookup transport and invalid-response errors remain explicit', async () => {
    const id = crypto.randomUUID();
    const unknown = {
      id,
      recipientOrigin: config.peerOrigin,
      caseType: 'delivery_damage' as const,
      data: { orderReference: 'DEMO-1042' as const, damageDescription: 'Synthetic parcel damage' },
      status: 'unknown' as const,
      approvedFields: [],
      receipt: null,
      createdAt: new Date().toISOString(),
    };
    for (const fetcher of [
      async () => {
        throw Error('private-secret');
      },
      async () => new Response('<html>private-secret</html>'),
    ]) {
      const app = createApp(config, { ...db, getDraft: async () => unknown }, signing, fetcher);
      await check(
        await app.request(`/api/v1/transfers/${id}/reconcile`, {
          method: 'POST',
          headers,
          body: '{}',
        }),
        'RECIPIENT_UNAVAILABLE',
        502,
      );
    }
  });
  test('an interrupted provider stream rejects with a safe message rather than returning truncated success', async () => {
    const response = await provider(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(Error('private-secret'));
            },
          }),
        ),
    );
    await expect(response.text()).rejects.toThrow(errorMessages.PROVIDER_UNAVAILABLE);
  });
});
