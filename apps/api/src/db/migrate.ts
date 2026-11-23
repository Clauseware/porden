import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate as migrateDrizzle } from 'drizzle-orm/bun-sql/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config';
import { hash, reportError } from '../security';
import { migrationMetadata } from './metadata';

export async function migrate(client: SQL, role: 'merchant' | 'courier') {
  const original = await Bun.file(new URL(`./0001_${role}.sql`, import.meta.url)).text();
  const migrationsFolder = fileURLToPath(new URL(`../../drizzle/${role}`, import.meta.url));
  const migrations = readMigrationFiles({ migrationsFolder });
  const connection = await client.reserve();
  const db = drizzle(connection);
  try {
    // Keep the role check and Drizzle migration on one reserved connection under the same lock.
    await db.execute(sql`SELECT pg_advisory_lock(7463821)`);
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS porden_migrations (version TEXT PRIMARY KEY, role TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    const rows = await db.select().from(migrationMetadata);
    if (rows.some((row) => row.role !== role))
      throw Error('Database belongs to the other organization role');
    const previous = rows.find((row) => row.version === '0001');
    if (previous && previous.checksum !== hash(original))
      throw Error('Applied migration checksum changed');
    await db
      .insert(migrationMetadata)
      .values({ version: 'organization', role, checksum: hash(role) })
      .onConflictDoNothing();
    const [schema] = await db.execute(sql`SELECT current_schema() AS name`);
    const migrationsSchema = String(schema.name);
    const journal = sql`${sql.identifier(migrationsSchema)}.${sql.identifier('__drizzle_migrations')}`;
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS ${journal} (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`,
    );
    const applied = await db.execute(sql`SELECT hash FROM ${journal} ORDER BY created_at LIMIT 1`);
    if (applied.length && applied[0].hash !== migrations[0].hash)
      throw Error('Applied Drizzle migration checksum changed');
    // Adopt the verified initial SQL baseline without recreating its tables or losing its records.
    if (previous && !applied.length) {
      await db.execute(
        sql`INSERT INTO ${journal} (hash,created_at) VALUES (${migrations[0].hash},${migrations[0].folderMillis})`,
      );
    }
    await migrateDrizzle(db, { migrationsFolder, migrationsSchema });
    await db
      .insert(migrationMetadata)
      .values({ version: '0001', role, checksum: hash(original) })
      .onConflictDoNothing();
  } finally {
    try {
      await db.execute(sql`SELECT pg_advisory_unlock(7463821)`);
    } finally {
      connection.release();
    }
  }
}
if (import.meta.main) {
  let client: SQL | undefined;
  try {
    const config = loadConfig();
    client = new SQL({ url: config.databaseUrl, prepare: false });
    await migrate(client, config.role);
    console.log(`Applied ${config.role} Drizzle migrations`);
  } catch (error) {
    reportError('database migration', error);
    process.exitCode = 1;
  } finally {
    if (client)
      await client.close().catch((error) => {
        reportError('migration cleanup', error);
        process.exitCode = 1;
      });
  }
}
