import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { fileURLToPath } from 'node:url';
import { loadPlatformConfig } from '../platform-config';
import { reportError } from '../security';

export async function migratePlatform(client: SQL) {
  const connection = await client.reserve();
  try {
    await connection`SELECT pg_advisory_lock(7463822)`;
    const [schema] = await connection`SELECT current_schema() AS name`;
    await migrate(drizzle(connection), {
      migrationsFolder: fileURLToPath(new URL('../../drizzle/platform', import.meta.url)),
      migrationsSchema: String(schema.name),
      migrationsTable: '__porden_platform_migrations',
    });
  } finally {
    try {
      await connection`SELECT pg_advisory_unlock(7463822)`;
    } finally {
      connection.release();
    }
  }
}
if (import.meta.main) {
  let client: SQL | undefined;
  try {
    client = new SQL({ url: loadPlatformConfig().databaseUrl, prepare: false });
    await migratePlatform(client);
    console.log('Applied Porden platform migrations');
  } catch (error) {
    reportError('platform migration', error);
    process.exitCode = 1;
  } finally {
    await client?.close();
  }
}
