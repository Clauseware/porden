import { SQL } from 'bun';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { signer, sessionTools, type Fetcher } from '../src/security';

// Platform, merchant and courier services with separate schemas, signing keys and integration
// principals, wired in-process. Used by the scripted scenarios and the real-model evaluation.
export const origins = {
  platform: 'http://localhost:4300',
  merchant: 'http://localhost:4100',
  courier: 'http://localhost:4200',
} as const;
type Role = 'merchant' | 'courier';

export async function startClaimsStack(options: {
  url: string;
  env?: Record<string, string | undefined>;
  upstream?: Fetcher;
}) {
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const schemas = ['platform', 'merchant', 'courier'].map(
    (role) => `porden_claims_${role}_${suffix}`,
  );
  const directory = resolve('tmp', `claims-${suffix}`);
  const merchantOrg = crypto.randomUUID(),
    courierOrg = crypto.randomUUID();
  const tokens = { merchant: 'm'.repeat(40), courier: 'k'.repeat(40) };
  const approverSecret = `claims-approver-${suffix}`;
  const admin = new SQL(options.url);
  for (const schema of schemas) await admin.unsafe(`CREATE SCHEMA ${schema}`);
  const [platformSql, merchantSql, courierSql] = schemas.map(
    (schema) => new SQL({ url: options.url, prepare: false, connection: { search_path: schema } }),
  );
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
    PORDEN_DATABASE_URL: options.url,
    PORDEN_PUBLIC_ORIGIN: origins.platform,
    PORDEN_ALLOWED_ORIGINS: Object.values(origins).join(','),
    PORDEN_SESSION_SECRET: 's'.repeat(40),
    PORDEN_SIGNING_KEY_PATH: key('platform'),
  });
  await migratePlatform(platformSql);
  // The merchant keeps automatic authorization for new claims; revisions still need a human.
  await provisionPlatform(platformSql, {
    organizations: [
      { id: merchantOrg, name: 'Merchant', humanApprovalRequired: false },
      { id: courierOrg, name: 'Courier' },
    ],
    principals: [
      {
        id: crypto.randomUUID(),
        organizationId: merchantOrg,
        name: 'Merchant claims integration',
        login: 'merchant',
        kind: 'integration',
        role: 'member',
        secret: tokens.merchant,
      },
      {
        id: crypto.randomUUID(),
        organizationId: courierOrg,
        name: 'Courier claims desk',
        login: 'courier',
        kind: 'integration',
        role: 'member',
        secret: tokens.courier,
      },
      {
        id: crypto.randomUUID(),
        organizationId: merchantOrg,
        name: 'Merchant approver',
        login: 'approver',
        kind: 'human',
        role: 'approver',
        secret: approverSecret,
      },
    ],
  });
  const platformSigning = signer(platformConfig);
  const platformApp = createPlatformApp(
    platformConfig,
    handoffService(platformSql, platformSigning),
    platformAuth(platformSql, platformConfig),
    platformSigning,
  );
  const apps = {} as Record<Role, ReturnType<typeof createApp>>;
  const configs = {} as Record<Role, Config>;
  const routeFetch: Fetcher = async (input, init) => {
    const target = new URL(String(input));
    if (target.origin === origins.platform) return platformApp.request(target.href, init);
    if (target.origin === origins.merchant) return apps.merchant.request(target.href, init);
    if (target.origin === origins.courier) return apps.courier.request(target.href, init);
    if (options.upstream) return options.upstream(input, init);
    throw Error('Unexpected upstream');
  };
  for (const role of ['merchant', 'courier'] as const)
    configs[role] = loadConfig({
      GROQ_API_KEY: 'test-groq-key',
      GROQ_MODEL: 'test/groq-model',
      ...options.env,
      ORGANIZATION_ROLE: role,
      PUBLIC_ORIGIN: origins[role],
      PEER_ORIGIN: role === 'merchant' ? origins.courier : origins.merchant,
      DATABASE_URL: options.url,
      SESSION_SECRET: role.repeat(32),
      PARTNER_SECRET: 'p'.repeat(32),
      DEMO_PASSWORD: 'claims-test',
      SIGNING_KEY_PATH: key(role),
      PORDEN_API_ORIGIN: origins.platform,
      PORDEN_INTEGRATION_TOKEN: tokens[role],
      PORDEN_ORGANIZATION_ID: role === 'merchant' ? merchantOrg : courierOrg,
      PORDEN_PEER_ORGANIZATION_ID: role === 'merchant' ? courierOrg : merchantOrg,
    });
  await migrate(merchantSql, 'merchant');
  await migrate(courierSql, 'courier');
  const signing = { merchant: signer(configs.merchant), courier: signer(configs.courier) };
  const merchantStore = store(merchantSql, configs.merchant, signing.merchant);
  apps.merchant = createApp(configs.merchant, merchantStore, signing.merchant, routeFetch);
  const courierStore = store(courierSql, configs.courier, signing.courier);
  apps.courier = createApp(configs.courier, courierStore, signing.courier, routeFetch);
  const courierPlatform = createHandoffClient({
    baseUrl: origins.platform + '/api/v2',
    token: tokens.courier,
    fetch: routeFetch,
  });
  const merchantPlatform = createHandoffClient({
    baseUrl: origins.platform + '/api/v2',
    token: tokens.merchant,
    fetch: routeFetch,
  });
  let cookie = '';
  const approver = createHandoffClient({
    baseUrl: origins.platform + '/api/v2',
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Origin', origins.platform);
      if (cookie) headers.set('Cookie', cookie);
      const response = await platformApp.request(String(input), { ...init, headers });
      const set = response.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return response;
    },
  });
  await approver.signIn({ login: 'approver', password: approverSecret });

  /** Browser-equivalent request from a signed-in user of that organization's own site. */
  function site(role: Role, method: string, path: string, body?: unknown) {
    const tools = sessionTools(configs[role]),
      token = tools.issue();
    return apps[role].request(path, {
      method,
      headers: {
        Origin: origins[role],
        Cookie: `porden_${role}_session=${token}`,
        'X-CSRF-Token': tools.csrf(token),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function caseCount() {
    return (await courierSql`SELECT count(*)::int AS count FROM cases`)[0].count as number;
  }
  async function close() {
    await Promise.all([platformSql.close(), merchantSql.close(), courierSql.close()]);
    for (const schema of schemas) await admin.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
    rmSync(directory, { recursive: true, force: true });
  }
  return {
    apps,
    configs,
    signing,
    merchantStore,
    courierStore,
    courierSql,
    merchantSql,
    courierPlatform,
    merchantPlatform,
    approver,
    routeFetch,
    site,
    caseCount,
    close,
  };
}
export type ClaimsStack = Awaited<ReturnType<typeof startClaimsStack>>;
