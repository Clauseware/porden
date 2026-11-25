// T7′ verification: the published default inference route (spec §4, publisher-funded) runs the
// published merchant and courier networks through reference runtimes with no SDK router
// override, no visitor key and no model override.
//
// Runtimes under test:
//  - the official challenge skill runtime (cognizant-ai-labs/agentic-web,
//    skills/agentify-website/runtime), pinned below and downloaded into tmp/ for this test only;
//  - the vendored upstream nsDeploy runtime (pinned in vendor/README.md).
// The model provider is replaced by a local fake upstream, so no provider is contacted and the
// provider credential the server attaches can be observed.
//
// Usage: bun tests/test_default_router.ts
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { origins, startClaimsStack } from '../apps/api/test/claims-stack';
import { sessionTools } from '../apps/api/src/security';

const url = process.env.PORDEN_TEST_DATABASE_URL;
if (!url) throw Error('PORDEN_TEST_DATABASE_URL is required');
const skillPin = 'b3ae3eb4f62f5bfdc9f01df616298bc499ade8b3';
const skillFiles = ['LICENSE.txt', 'action-bridge.js', 'action-transport.js', 'actions.js', 'byok.js', 'cruse-render.js', 'cruse.js', 'discovered-actions.js', 'engine.js', 'execution-stream.js', 'form-actions.js', 'generated/agent-runner.bundle.js', 'generated/graph.gen.mjs', 'generated/sly_data.gen.mjs', 'generated/validation.gen.mjs', 'hocon.js', 'in-use-line.js', 'index.js', 'kernel.js', 'langchain-runner.mjs', 'llm.js', 'mcp.js', 'model.js', 'openrouter-connect.js', 'otari-connect.js', 'provider-error.js', 'remote.js', 'runner.js', 'sandbox-worker.js', 'sandbox.js', 'trace.js', 'turn-control.js', 'turn-status.js', 'web-crypto.js'];
const skillDir = resolve('tmp', 'skill-runtime', skillPin);
for (const file of skillFiles) {
  const target = resolve(skillDir, file);
  if (existsSync(target)) continue;
  const response = await fetch(`https://raw.githubusercontent.com/cognizant-ai-labs/agentic-web/${skillPin}/skills/agentify-website/runtime/${file}`);
  if (!response.ok) throw Error(`Could not fetch official runtime file ${file}: HTTP ${response.status}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, await response.text());
}

const serverKey = 'server-side-provider-key-not-for-browsers';
const model = 'test/configured-model:free';
const upstreamCalls: Array<{ authorization: string | null; model: string }> = [];
const browserLlmRequests: Array<{ role: string; authorization: string | null }> = [];
const stack = await startClaimsStack({
  url,
  env: { OPENROUTER_API_KEY: serverKey, OPENROUTER_MODEL: model },
  upstream: async (input, init) => {
    assert.equal(String(input), 'https://openrouter.ai/api/v1/chat/completions');
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body));
    upstreamCalls.push({ authorization: headers.get('Authorization'), model: body.model });
    const chunk = { model, choices: [{ index: 0, delta: { content: 'Hello from the default router.' }, finish_reason: 'stop' }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  },
});
type Role = 'merchant' | 'courier';
const cookies = {} as Record<Role, string>;
for (const role of ['merchant', 'courier'] as const) cookies[role] = `porden_${role}_session=${sessionTools(stack.configs[role]).issue()}`;
const realFetch = globalThis.fetch;
const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) },
});
// Browser-equivalent same-origin requests: the site session cookie and Origin header only.
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    const target = new URL(raw, (globalThis as { location?: URL }).location?.href);
    const role = (['merchant', 'courier'] as const).find((item) => origins[item] === target.origin);
    if (!role) throw Error(`Unexpected browser request to ${target.origin}`);
    const headers = new Headers(init?.headers);
    if (target.pathname === '/api/llm/chat/completions') browserLlmRequests.push({ role, authorization: headers.get('Authorization') });
    headers.set('Cookie', cookies[role]);
    headers.set('Origin', origins[role]);
    const response = await stack.apps[role].request(target.href, { ...init, headers });
    if (target.pathname === '/agent-manifest.json') {
      // Bun cannot import http: action modules; actions are not under test here.
      const manifest = await response.json();
      delete manifest.actions;
      return Response.json(manifest);
    }
    return response;
  },
  { preconnect: realFetch.preconnect },
);

const results: Array<{ name: string; passed: boolean; detail?: string }> = [];
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    results.push({ name, passed: true, ...(detail ? { detail } : {}) });
    console.log('PASS', name, detail ?? '');
  } catch (error) {
    results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
    console.error('FAIL', name, error);
  }
}
async function runDefault(runtimeDir: string, role: Role) {
  Object.defineProperty(globalThis, 'location', { value: new URL(origins[role] + '/'), configurable: true, writable: true });
  const { Engine } = await import(pathToFileURL(resolve(runtimeDir, 'engine.js')).href);
  const engine = new Engine({ originUrl: origins[role] }); // no routerOverride, no byokKey, no modelOverride
  const result = await engine.runTurn('Say hello.');
  return result.text as string;
}

try {
  for (const role of ['merchant', 'courier'] as const) {
    await check(`${role}: public manifest publishes the same-origin publisher-funded default router`, async () => {
      const manifest = await (await stack.apps[role].request('/agent-manifest.json')).json();
      assert.deepEqual(manifest.llm_router, { base_url: `${origins[role]}/api/llm`, publisher_funded: true, mock: false });
      assert.equal('direct_byok' in manifest.deployment, false);
      const network = await (await stack.apps[role].request(`/${role}.network.json`)).json();
      assert.deepEqual(network.llm_config, { model_name: model });
      assert.equal(manifest.deployment.mode, 'static', 'no mutable /_nsdeploy endpoints are offered');
      const licence = await stack.apps[role].request('/runtime/LICENSE.txt');
      assert.equal(licence.status, 200);
      assert.match(licence.headers.get('Content-Type') ?? '', /^text\/plain/);
      assert.match(await licence.text(), /Apache License\s+Version 2\.0/);
      for (const path of ['/agent-manifest.json', `/${role}.network.json`, '/links.json', '/api/config'])
        assert.equal((await (await stack.apps[role].request(path)).text()).includes(serverKey), false, `${path} must not expose the provider key`);
    });
    await check(`${role}: official skill runtime runs the published network with no override or key`, async () => {
      const before = upstreamCalls.length;
      const text = await runDefault(skillDir, role);
      assert.match(text, /Hello from the default router/);
      const calls = upstreamCalls.slice(before);
      assert.ok(calls.length >= 1);
      assert.ok(calls.every((call) => call.authorization === `Bearer ${serverKey}` && call.model === model));
      assert.ok(browserLlmRequests.filter((item) => item.role === role).every((item) => item.authorization === null), 'the browser sends no provider credential');
      return `${calls.length} model call(s) through ${origins[role]}/api/llm`;
    });
    await check(`${role}: vendored nsDeploy (upstream pin) without override — recorded behaviour`, async () => {
      const before = upstreamCalls.length;
      const outcome = await runDefault(resolve('vendor/nsdeploy/nsdeploy/runtime'), role).then(
        (text) => `ran: ${text.slice(0, 60)}`,
        (error: Error) => `refused: ${error.message.slice(0, 80)}`,
      );
      assert.equal(upstreamCalls.length, before, 'no provider call without a key in this runtime');
      return outcome;
    });
    await check(`${role}: the default route serves only the configured model and needs the site session`, async () => {
      const before = upstreamCalls.length;
      const post = (cookie: string | undefined, chosen: string) =>
        stack.apps[role].request('/api/llm/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: origins[role], ...(cookie ? { Cookie: cookie } : {}) },
          body: JSON.stringify({ model: chosen, messages: [{ role: 'user', content: 'hi' }] }),
        });
      const paid = await post(cookies[role], 'openai/an-expensive-model');
      assert.equal(paid.status, 400);
      assert.equal((await paid.json()).error.code, 'MODEL_NOT_ALLOWED');
      assert.equal((await post(undefined, model)).status, 401);
      assert.equal(upstreamCalls.length, before);
    });
  }
} finally {
  globalThis.fetch = realFetch;
  await stack.close();
}
const evidence = resolve('tmp', 'porden-default-router', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(evidence, { recursive: true });
writeFileSync(resolve(evidence, 'results.json'), JSON.stringify({ skillPin, results }, null, 2));
const failures = results.filter((item) => !item.passed);
console.log(`${results.length - failures.length} passed; ${failures.length} failed; evidence: ${evidence}`);
if (failures.length) process.exitCode = 1;
