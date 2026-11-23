import { SQL } from 'bun';
import { loadConfig } from './config';
import { signer } from './security';
import { reportError } from './observability/logger';
import { store } from './db/store';
import { createApp } from './app';

async function main() {
  let client: SQL | undefined;
  try {
    const config = loadConfig(),
      signing = signer(config);
    // Drizzle serializes JSON itself; prepared Bun JSONB parameters would encode it twice.
    client = new SQL({ url: config.databaseUrl, prepare: false });
    const db = store(client, config, signing);
    await db.ready();
    if (!(await Bun.file(`${config.runtimePath}/engine.js`).exists()))
      throw Error('Pinned official nsDeploy runtime missing');
    const app = createApp(config, db, signing);
    const server = Bun.serve({ hostname: '127.0.0.1', port: config.port, fetch: app.fetch });
    console.log(
      `Porden ${config.role} API on http://127.0.0.1:${server.port}; public origin ${config.origin}`,
    );
    const database = client;
    async function shutdown() {
      await server.stop();
      await database.close();
      process.exit(0);
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.on(signal, () => {
        void shutdown().catch((error) => {
          reportError('shutdown', error);
          process.exit(1);
        });
      });
  } catch (error) {
    reportError('startup', error);
    if (client) await client.close().catch((cause) => reportError('startup cleanup', cause));
    process.exitCode = 1;
  }
}
await main();
