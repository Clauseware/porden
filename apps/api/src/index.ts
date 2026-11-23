import { SQL } from 'bun';
import { loadConfig } from './config';
import { signer } from './security';
import { store } from './db/store';
import { createApp } from './app';

const config = loadConfig(), signing = signer(config), sql = new SQL(config.databaseUrl);
const db = store(sql, config, signing);
await db.ready();
if (!await Bun.file(`${config.runtimePath}/engine.js`).exists()) throw Error('Pinned official nsDeploy runtime missing');
const app = createApp(config, db, signing);
const server = Bun.serve({hostname: '127.0.0.1', port: config.port, fetch: app.fetch});
console.log(`Porden ${config.role} API on http://127.0.0.1:${server.port}; public origin ${config.origin}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => {await server.stop(); await sql.close(); process.exit(0);});
