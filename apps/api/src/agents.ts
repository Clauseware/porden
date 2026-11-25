import { join } from 'node:path';
import type { Hono } from 'hono';
import type { Config } from './config';

const runtimeFiles = new Set([
  'engine.js',
  'actions.js',
  'action-transport.js',
  'action-bridge.js',
  'byok.js',
  'cruse.js',
  'cruse-render.js',
  'discovered-actions.js',
  'execution-stream.js',
  'form-actions.js',
  'hocon.js',
  'kernel.js',
  'llm.js',
  'mcp.js',
  'model.js',
  'provider-error.js',
  'remote.js',
  'runner.js',
  'sandbox.js',
  'sandbox-worker.js',
  'trace.js',
  'turn-control.js',
  'turn-status.js',
  'web-crypto.js',
  'generated/graph.gen.mjs',
  'generated/validation.gen.mjs',
  'generated/sly_data.gen.mjs',
]);

export function agentRoutes(app: Hono, config: Config) {
  const { role, origin, peerOrigin } = config;
  const front = `${role}_front`;
  const links = role === 'merchant' ? { courier: `${peerOrigin}/courier` } : {};
  const linking = {
    protocol: 'nsdeploy-link/v1',
    site: origin,
    exports: [
      { network: role, front_man: front, aliases: [role, front], url: `${origin}/${role}` },
    ],
    imports:
      role === 'merchant'
        ? [
            {
              network: role,
              reference: 'courier',
              callers: [front],
              status: 'linked',
              target: links.courier,
            },
          ]
        : [],
    link_updates: { mode: 'browser-local' },
  };
  const mcp = {
    protocol: 'nsdeploy-agent-mcp/v1',
    network: role,
    front_man: front,
    available: false,
    reason: 'Browser fetch-and-run deployment; no public MCP facade.',
  };
  const manifest = {
    name: `porden-${role}`,
    brand: `Porden ${role}`,
    front_man: front,
    networks: [
      {
        name: role,
        front_man: front,
        hocon: `./${role}.network.json`,
        description: 'Versioned Porden task handoffs',
      },
    ],
    // Spec §4 default inference: this site's same-origin route, paid for by the site and
    // authenticated by the visitor's site session. BYOK is not offered, so no byok_router.
    llm_router: {
      base_url: `${origin}/api/llm`,
      publisher_funded: true,
      mock: false,
    },
    allowed_peers: role === 'merchant' ? [peerOrigin] : [],
    deployment: {
      mode: 'static',
      self_contained_runtime: true,
      browser_mock: false,
      public_mcp_facade: false,
    },
    linking,
    agent_mcp: mcp,
    actions: { version: 1, bridge: './action-bridge.html', module: './actions.js' },
  };
  const documents: Record<string, unknown> = {
    '/agent-manifest.json': manifest,
    '/links.json': { version: 1, networks: { [role]: links } },
    '/.well-known/nsdeploy.json': linking,
    '/.well-known/nsdeploy-agent.json': mcp,
    '/agent-mcp.json': mcp,
  };
  for (const [path, body] of Object.entries(documents))
    app.get(path, (c) => {
      c.header('Access-Control-Allow-Origin', '*');
      return c.json(body);
    });
  // Apache-2.0 §4(a): the redistributed nsDeploy runtime is served with its licence.
  // The upstream checkout keeps LICENSE.txt two levels above nsdeploy/runtime.
  app.get('/runtime/LICENSE.txt', async (c) => {
    const licence = Bun.file(join(config.runtimePath, '..', '..', 'LICENSE.txt'));
    if (!(await licence.exists())) return c.notFound();
    c.header('Content-Type', 'text/plain; charset=utf-8');
    return c.body(await licence.text());
  });
  app.get('/runtime/*', async (c) => {
    const file = c.req.path.slice('/runtime/'.length);
    if (!runtimeFiles.has(file)) return c.notFound();
    const asset = Bun.file(join(config.runtimePath, file));
    if (!(await asset.exists())) return c.notFound();
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    if (file === 'sandbox-worker.js')
      c.header(
        'Content-Security-Policy',
        "default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'",
      );
    return c.body(await asset.text());
  });
  app.get(`/${role}.network.json`, async (c) => {
    const network = await Bun.file(
      new URL(`../../../public/${role}/${role}.network.json`, import.meta.url),
    ).json();
    c.header('Access-Control-Allow-Origin', '*');
    // The default route serves only the operator-configured model; publish it as the network's model.
    return c.json(
      config.model ? { ...network, llm_config: { model_name: config.model } } : network,
    );
  });
  app.get('/action-policy.json', (c) =>
    c.json({ role, callerOrigins: role === 'courier' ? [peerOrigin, origin] : [origin] }),
  );
  app.get('/actions.js', async (c) => {
    c.header('Content-Type', 'text/javascript; charset=utf-8');
    return c.body(await Bun.file(new URL('../public/actions.js', import.meta.url)).text());
  });
  app.get('/action-bridge.html', (c) =>
    c.html(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Porden ${role} action confirmation</title><h1>Porden ${role} action confirmation</h1><p>Sign in before submitting a platform handoff action. Human approvals remain in the dashboard.</p><script type="module" src="/runtime/action-bridge.js"></script></html>`,
    ),
  );
}
