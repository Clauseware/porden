import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config';
import { migrate } from '../src/db/migrate';
import { store } from '../src/db/store';
import { createApp } from '../src/app';
import { hash, signer } from '../src/security';
import type { ActionArguments } from '@porden/contracts';

// Opt-in. The URL must point to a disposable database owned by a role allowed to CREATE SCHEMA.
const url = process.env.PORDEN_TEST_DATABASE_URL;
const integration = url ? test : test.skip;
let admin: SQL, merchantSql: SQL, courierSql: SQL;
let merchant: ReturnType<typeof store>, courier: ReturnType<typeof store>;
let merchantApp: ReturnType<typeof createApp>, courierApp: ReturnType<typeof createApp>;
let merchantSigning: ReturnType<typeof signer>;
const suffix = crypto.randomUUID().replaceAll('-', '');
const merchantSchema = `porden_test_merchant_${suffix}`,
  courierSchema = `porden_test_courier_${suffix}`;
const legacySchema = `porden_test_legacy_${suffix}`;
const directory = resolve(`tmp/postgres-${suffix}`);
const origins = { merchant: 'http://localhost:4100', courier: 'http://localhost:4200' };

beforeAll(async () => {
  if (!url) return;
  admin = new SQL(url);
  await admin
    .unsafe(
      `CREATE SCHEMA ${merchantSchema}; CREATE SCHEMA ${courierSchema}; CREATE SCHEMA ${legacySchema}`,
    )
    .simple();
  function connection(schema: string) {
    return new SQL({ url: url!, prepare: false, connection: { search_path: schema } });
  }
  merchantSql = connection(merchantSchema);
  courierSql = connection(courierSchema);
  mkdirSync(directory, { recursive: true });
  function config(role: 'merchant' | 'courier') {
    const path = resolve(directory, `${role}.pem`);
    writeFileSync(
      path,
      generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
    );
    return loadConfig({
      ORGANIZATION_ROLE: role,
      PUBLIC_ORIGIN: origins[role],
      PEER_ORIGIN: role === 'merchant' ? origins.courier : origins.merchant,
      DATABASE_URL: url,
      SESSION_SECRET: role.repeat(32),
      PARTNER_SECRET: 'p'.repeat(32),
      DEMO_PASSWORD: 'test-password',
      SIGNING_KEY_PATH: path,
    });
  }
  const mc = config('merchant'),
    cc = config('courier');
  merchantSigning = signer(mc);
  const cs = signer(cc);
  await migrate(merchantSql, 'merchant');
  await migrate(merchantSql, 'merchant');
  await migrate(courierSql, 'courier');
  merchant = store(merchantSql, mc, merchantSigning);
  courier = store(courierSql, cc, cs);
  const routeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    return (u.origin === origins.merchant ? merchantApp : courierApp).request(u.href, init);
  }) as typeof fetch;
  merchantApp = createApp(mc, merchant, merchantSigning, routeFetch);
  courierApp = createApp(cc, courier, cs, routeFetch);
});
afterAll(async () => {
  if (!url) return;
  await merchantSql?.close();
  await courierSql?.close();
  if (admin) {
    // These names are fixed prefixes plus a generated hex UUID, never caller input.
    await admin
      .unsafe(
        `DROP SCHEMA IF EXISTS ${merchantSchema} CASCADE; DROP SCHEMA IF EXISTS ${courierSchema} CASCADE; DROP SCHEMA IF EXISTS ${legacySchema} CASCADE`,
      )
      .simple();
    await admin.close();
  }
  rmSync(directory, { recursive: true, force: true });
});

async function approved(): Promise<ActionArguments> {
  const draft = await merchant.createDraft({
    recipientOrigin: origins.courier,
    caseType: 'delivery_damage',
    data: {
      orderReference: 'DEMO-1042',
      damageDescription: 'Parcel damaged in transit',
      deliveryAddress: 'Excluded fixture address',
    },
  });
  const result = await merchant.approve(draft.id, ['orderReference', 'damageDescription']);
  expect((await merchant.getDraft(draft.id)).approvedFields).toEqual([
    'orderReference',
    'damageDescription',
  ]);
  const [stored] =
    await merchantSql`SELECT jsonb_typeof(draft_data) AS draft_type, jsonb_typeof(approved_data) AS approved_type FROM transfers WHERE id=${draft.id}`;
  expect(stored).toEqual({ draft_type: 'object', approved_type: 'object' });
  await merchant.transition(draft.id, 'submitted');
  return result.arguments;
}
integration(
  'Drizzle adopts an existing SQL migration without recreating tables or losing data',
  async () => {
    const client = new SQL({
      url: url!,
      prepare: false,
      connection: { search_path: legacySchema },
    });
    try {
      const source = await Bun.file(new URL('../src/db/0001_merchant.sql', import.meta.url)).text();
      await client.unsafe(source).simple();
      await client.unsafe(
        'CREATE TABLE porden_migrations (version TEXT PRIMARY KEY, role TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
      );
      await client`INSERT INTO porden_migrations (version,role,checksum) VALUES ('0001','merchant',${hash(source)})`;
      const id = crypto.randomUUID(),
        data = {
          orderReference: 'DEMO-1042',
          damageDescription: 'Existing synthetic parcel damage',
        };
      await client`INSERT INTO transfers (id,customer_id,sender_org,recipient_origin,case_type,draft_data)
      VALUES (${id},'demo-user',${origins.merchant},${origins.courier},'delivery_damage',${JSON.stringify(data)})`;
      await migrate(client, 'merchant');
      await migrate(client, 'merchant');
      const [row] = await client`SELECT draft_data FROM transfers WHERE id=${id}`;
      expect(row.draft_data).toEqual(data);
      const [journal] = await client`SELECT count(*)::int AS count FROM __drizzle_migrations`;
      expect(journal.count).toBe(1);
      await expect(migrate(client, 'courier')).rejects.toThrow(
        'Database belongs to the other organization role',
      );
    } finally {
      await client.close();
    }
  },
);
integration(
  'concurrent duplicate requests persist one case and the same immutable receipt',
  async () => {
    const args = await approved();
    expect(args.data).not.toHaveProperty('deliveryAddress');
    const request = { ...args, requestId: 'official:duplicate:1' };
    const [a, b, ...duplicates] = await Promise.all(
      Array.from({ length: 20 }, () => courier.createCase(request)),
    );
    expect(a.receipt).toBe(b.receipt);
    expect(a.caseId).toBe(b.caseId);
    expect(duplicates.every((row) => row.receipt === a.receipt && row.caseId === a.caseId)).toBe(
      true,
    );
    const [row] =
      await courierSql`SELECT count(*)::int AS count FROM cases WHERE transfer_id=${args.transferId}`;
    expect(row.count).toBe(1);
    await expect(
      courier.createCase({
        ...request,
        data: { ...args.data, damageDescription: 'Changed approved description' },
      }),
    ).rejects.toThrow('REQUEST_CONFLICT');
    await expect(courier.createCase({ ...request, requestId: 'fresh-runtime-id' })).rejects.toThrow(
      'REQUEST_CONFLICT',
    );
  },
);
integration('invalid state transitions and repeated approvals fail immediately', async () => {
  const draft = await merchant.createDraft({
    recipientOrigin: origins.courier,
    caseType: 'delivery_damage',
    data: { orderReference: 'DEMO-1042', damageDescription: 'Synthetic damaged parcel' },
  });
  await expect(merchant.transition(draft.id, 'submitted')).rejects.toThrow('REQUEST_CONFLICT');
  await expect(merchant.transition(draft.id, 'unknown')).rejects.toThrow('REQUEST_CONFLICT');
  await merchant.approve(draft.id, ['orderReference', 'damageDescription']);
  await expect(merchant.approve(draft.id, ['orderReference', 'damageDescription'])).rejects.toThrow(
    'REQUEST_CONFLICT',
  );
  await merchant.transition(draft.id, 'cancelled');
  await expect(merchant.transition(draft.id, 'submitted')).rejects.toThrow('REQUEST_CONFLICT');
});
integration('case and receipt roll back together if receipt insertion fails', async () => {
  const args = await approved();
  await courierSql
    .unsafe(`CREATE FUNCTION fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test receipt failure'; END $$;
    CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION fail_receipt()`)
    .simple();
  try {
    await expect(courier.createCase({ ...args, requestId: 'rollback:1' })).rejects.toThrow();
  } finally {
    await courierSql
      .unsafe('DROP TRIGGER fail_receipt ON receipts; DROP FUNCTION fail_receipt()')
      .simple();
  }
  const [row] =
    await courierSql`SELECT count(*)::int AS count FROM cases WHERE transfer_id=${args.transferId}`;
  expect(row.count).toBe(0);
});
integration(
  'server verifies receipt scope and reconciles a committed case after lost acknowledgement',
  async () => {
    const args = await approved();
    const result = await courier.createCase({ ...args, requestId: 'lost-ack:1' });
    await merchant.transition(args.transferId, 'unknown');
    const login = await merchantApp.request('/api/v1/session', {
      method: 'POST',
      headers: { Origin: origins.merchant, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    const { csrf } = await login.json();
    const headers = {
      Origin: origins.merchant,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      Cookie: login.headers.get('set-cookie')!.split(';')[0],
    };
    const response = await merchantApp.request(`/api/v1/transfers/${args.transferId}/reconcile`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect((await response.json()).receipt.receiverCaseId).toBe(result.caseId);
    expect((await merchant.getDraft(args.transferId)).status).toBe('accepted');
  },
);
integration(
  'receiver rejects changed fields and expired or mismatched consent before persistence',
  async () => {
    const args = await approved();
    const login = await courierApp.request('/api/v1/session', {
      method: 'POST',
      headers: { Origin: origins.courier, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    const { csrf } = await login.json();
    const headers = {
      Origin: origins.courier,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
      Cookie: login.headers.get('set-cookie')!.split(';')[0],
    };
    const changed = {
      ...args,
      requestId: 'bad-scope:1',
      data: { ...args.data, deliveryAddress: 'Unapproved address' },
    };
    expect(
      (
        await courierApp.request('/api/v1/cases', {
          method: 'POST',
          headers,
          body: JSON.stringify(changed),
        })
      ).status,
    ).toBe(403);
    const expired = merchantSigning.sign(
      {
        issuer: origins.merchant,
        audience: origins.courier,
        transferId: args.transferId,
        subject: 'demo-user',
        caseType: 'delivery_damage',
        payloadSha256: hash(args.data),
        approvedFields: Object.keys(args.data),
        expiresAt: Date.now() - 1000,
      },
      'porden-approval+jwt',
    );
    expect(
      (
        await courierApp.request('/api/v1/cases', {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...args, approval: expired, requestId: 'expired:1' }),
        })
      ).status,
    ).toBe(403);
  },
);
