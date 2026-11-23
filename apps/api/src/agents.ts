import { join } from 'node:path';
import type { Hono } from 'hono';
import type { Config } from './config';

const runtimeFiles = new Set(['engine.js', 'actions.js', 'action-transport.js', 'action-bridge.js',
  'byok.js', 'cruse.js', 'cruse-render.js', 'discovered-actions.js', 'execution-stream.js',
  'form-actions.js', 'hocon.js', 'kernel.js', 'llm.js', 'mcp.js', 'model.js', 'provider-error.js',
  'remote.js', 'runner.js', 'sandbox.js', 'sandbox-worker.js', 'trace.js', 'turn-control.js',
  'turn-status.js', 'web-crypto.js', 'generated/graph.gen.mjs', 'generated/validation.gen.mjs', 'generated/sly_data.gen.mjs']);

export function agentRoutes(app: Hono, config: Config) {
  const {role, origin, peerOrigin} = config;
  const front = `${role}_front`, links = role === 'merchant' ? {courier: `${peerOrigin}/courier`} : {};
  const linking = {protocol: 'nsdeploy-link/v1', site: origin, exports: [{network: role, front_man: front, aliases: [role, front], url: `${origin}/${role}`}],
    imports: role === 'merchant' ? [{network: role, reference: 'courier', callers: [front], status: 'linked', target: links.courier}] : [], link_updates: {mode: 'browser-local'}};
  const mcp = {protocol: 'nsdeploy-agent-mcp/v1', network: role, front_man: front, available: false, reason: 'Browser fetch-and-run deployment; no public MCP facade.'};
  const manifest = {name: `porden-${role}`, brand: `Porden ${role}`, front_man: front,
    networks: [{name: role, front_man: front, hocon: `./${role}.network.json`, description: 'Customer-approved damage case transfer'}],
    llm_router: {base_url: 'https://openrouter.ai/api/v1', byok_router: 'https://openrouter.ai/api/v1', mock: false},
    allowed_peers: role === 'merchant' ? [peerOrigin] : [], deployment: {mode: 'static', self_contained_runtime: true, browser_mock: false, direct_byok: true, public_mcp_facade: false},
    linking, agent_mcp: mcp, ...(role === 'courier' ? {actions: {version: 1, bridge: './action-bridge.html', module: './actions.js'}} : {})};
  const documents: Record<string, unknown> = {'/agent-manifest.json': manifest, '/links.json': {version: 1, networks: {[role]: links}},
    '/.well-known/nsdeploy.json': linking, '/.well-known/nsdeploy-agent.json': mcp, '/agent-mcp.json': mcp};
  for (const [path, body] of Object.entries(documents)) app.get(path, c => {c.header('Access-Control-Allow-Origin', '*'); return c.json(body);});
  app.get('/runtime/*', async c => {
    const file = c.req.path.slice('/runtime/'.length);
    if (!runtimeFiles.has(file)) return c.notFound();
    const asset = Bun.file(join(config.runtimePath, file));
    if (!await asset.exists()) return c.notFound();
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    if (file === 'sandbox-worker.js') c.header('Content-Security-Policy', "default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'");
    return c.body(await asset.text());
  });
  app.get(`/${role}.network.json`, async c => {
    const network = await Bun.file(new URL(`../../../public/${role}/${role}.network.json`, import.meta.url)).json();
    if (role === 'courier') network.tools[0].instructions = network.tools[0].instructions.replace(
      'Only orderReference, damageDescription and an explicitly included deliveryAddress are permitted.',
      'Arguments contain transferId, caseType, data and approval. Copy the entire envelope unchanged. Only approved fields occur inside data.');
    c.header('Access-Control-Allow-Origin', '*');
    return c.json(network);
  });
  if (role === 'courier') {
    app.get('/action-policy.json', c => c.json({callerOrigins: [peerOrigin]}));
    app.get('/actions.js', async c => {
      c.header('Content-Type', 'text/javascript; charset=utf-8');
      return c.body(await Bun.file(new URL('../public/actions.js', import.meta.url)).text());
    });
    app.get('/action-bridge.html', c => c.html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Porden courier approval</title><h1>Courier approval</h1><p>Sign in to the courier site before approving a case. This confirms receipt of your case, not resolution.</p><script type="module" src="/runtime/action-bridge.js"></script></html>`));
  }
}
