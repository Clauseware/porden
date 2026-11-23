import { SQL } from 'bun';
import { loadPlatformConfig } from './platform-config';
import { signer } from './security';
import { reportError } from './observability/logger';
import { platformStore } from './db/platform-store';
import { platformAuth } from './platform-auth';
import { createPlatformApp } from './platform-app';

async function main() {
  let client: SQL | undefined;
  try {
    const config = loadPlatformConfig(),
      signing = signer(config);
    client = new SQL({ url: config.databaseUrl, prepare: false });
    const db = platformStore(client, signing);
    await db.ready();
    const app = createPlatformApp(config, db, platformAuth(client, config), signing);
    const server = Bun.serve({ hostname: '127.0.0.1', port: config.port, fetch: app.fetch });
    console.log(`Porden platform API on http://127.0.0.1:${server.port}`);
    const database = client;
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.on(signal, () => {
        void (async () => {
          await server.stop();
          await database.close();
          process.exit(0);
        })().catch((error) => {
          reportError('platform shutdown', error);
          process.exit(1);
        });
      });
  } catch (error) {
    reportError('platform startup', error);
    await client?.close().catch((cause) => reportError('platform cleanup', cause));
    process.exitCode = 1;
  }
}
await main();
